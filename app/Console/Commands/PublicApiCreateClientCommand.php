<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Models\User;
use App\Services\ApiClientKeyService;
use App\Services\PublicApiKeyIssuanceGuard;
use App\Support\PublicApiScope;
use Illuminate\Console\Command;
use Illuminate\Support\Str;
use InvalidArgumentException;

/**
 * أداة تشغيل (لا سطح HTTP في PR-2): تنشئ عميل Public API لمستأجر وتُصدر مفتاحًا
 * أوّل، وتطبع النصّ الصريح **مرّة واحدة فقط**. لا تُعرض أي تجزئة مخزّنة.
 *
 * **AIA-0.4 / D-08 — سياسة A:** `--issuer` إلزامي (مستخدم نشط من المستأجر نفسه) ويُطبَّق عليه
 * سقف الصلاحيات ذاته المطبَّق في واجهة المطوّر؛ scope واحد غير مصرَّح به يُفشل الأمر كاملاً قبل
 * إنشاء أي عميل أو مفتاح. لا استثناء إداري غير مقيَّد (B مؤجَّل بقرار المالك إلى حين وجود سجل
 * تدقيق مناسب) ولا مسار قديم بلا `--issuer` (C مرفوض).
 *
 * الإدارة عبر CLI (خادمية، موثوقة) بدل endpoint إدارة عام؛ سطح الإدارة الكامل
 * مؤجَّل صراحةً (Developer Portal / إدارة داخلية) خارج نطاق PR-2.
 */
class PublicApiCreateClientCommand extends Command
{
    protected $signature = 'public-api:create-client
        {tenant : معرّف المستأجر (UUID) أو الـ slug}
        {name : اسم عميل الـ API}
        {--issuer= : (إلزامي) بريد أو UUID مستخدم نشط من المستأجر نفسه؛ يُطبَّق سقف صلاحياته}
        {--scopes= : scopes مفصولة بفواصل، مثل partners:read,products:read}
        {--expires-days= : أيام صلاحية المفتاح (اختياري؛ بلا قيمة = بلا انتهاء)}';

    protected $description = 'إنشاء عميل Public API (M2M) وإصدار مفتاح أول (يُعرض النصّ الصريح مرّة واحدة).';

    public function handle(ApiClientKeyService $service, PublicApiKeyIssuanceGuard $guard): int
    {
        $arg = (string) $this->argument('tenant');
        // لا نستعلم بقيمة ليست UUID على عمود UUID (PostgreSQL يرفضها) — نميّز أولًا.
        $tenant = Str::isUuid($arg)
            ? Tenant::find($arg)
            : Tenant::where('slug', $arg)->first();

        if ($tenant === null) {
            $this->error('المستأجر غير موجود.');

            return self::FAILURE;
        }

        $requested = array_filter(array_map('trim', explode(',', (string) $this->option('scopes'))));

        try {
            $scopes = PublicApiScope::sanitize($requested);
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage().' المتاح: '.implode(', ', PublicApiScope::all()));

            return self::FAILURE;
        }

        if ($scopes === []) {
            $this->error('حدّد scope واحدًا على الأقل عبر --scopes. المتاح: '.implode(', ', PublicApiScope::all()));

            return self::FAILURE;
        }

        // سياسة A: المُصدِر إلزامي ومقيَّد بسقف صلاحياته — قبل أي كتابة.
        $issuerArg = trim((string) $this->option('issuer'));
        if ($issuerArg === '') {
            $this->error('الخيار --issuer إلزامي: حدّد بريد أو UUID مستخدمٍ نشط من هذا المستأجر. الإصدار غير المقيَّد غير متاح.');

            return self::FAILURE;
        }

        $issuer = User::query()
            ->where('tenant_id', $tenant->id)
            ->where(static function ($q) use ($issuerArg): void {
                $q->whereRaw('lower(email) = ?', [mb_strtolower($issuerArg)]);
                if (Str::isUuid($issuerArg)) {
                    $q->orWhere('id', $issuerArg);
                }
            })
            ->first();

        if ($issuer === null || ! $issuer->is_active) {
            $this->error('المُصدِر غير موجود في هذا المستأجر أو غير نشط.');

            return self::FAILURE;
        }

        $denied = $guard->denied($issuer, $scopes);
        if ($denied !== []) {
            $this->error('رُفض الإصدار: scopes تتجاوز صلاحيات المُصدِر ('.implode(', ', $denied).'). لم يُنشأ عميل ولا مفتاح.');

            return self::FAILURE;
        }

        $expiresDays = $this->option('expires-days');
        $expiresAt = $expiresDays !== null && $expiresDays !== ''
            ? now()->addDays((int) $expiresDays)
            : null;

        $client = $service->createClient($tenant, (string) $this->argument('name'));
        $key = $service->issueKey($client, 'default', $scopes, $expiresAt);

        $this->info('تم إنشاء عميل الـ API:');
        $this->line('  client_id : '.$client->id);
        $this->line('  tenant    : '.$tenant->id.' ('.$tenant->slug.')');
        $this->line('  issuer    : '.$issuer->email.' ('.$issuer->role.')');
        $this->line('  scopes    : '.implode(', ', $scopes));
        $this->line('  expires   : '.($expiresAt?->toDateTimeString() ?? 'بلا انتهاء'));
        $this->newLine();
        $this->warn('المفتاح — يُعرض مرّة واحدة فقط، احفظه الآن (لا يمكن استرجاعه):');
        $this->line('  '.$key->plainTextToken);

        return self::SUCCESS;
    }
}
