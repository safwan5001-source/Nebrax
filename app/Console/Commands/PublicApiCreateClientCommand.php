<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Support\PublicApiScope;
use Illuminate\Console\Command;
use Illuminate\Support\Str;
use InvalidArgumentException;

/**
 * أداة تشغيل (لا سطح HTTP في PR-2): تنشئ عميل Public API لمستأجر وتُصدر مفتاحًا
 * أوّل، وتطبع النصّ الصريح **مرّة واحدة فقط**. لا تُعرض أي تجزئة مخزّنة.
 *
 * الإدارة عبر CLI (خادمية، موثوقة) بدل endpoint إدارة عام؛ سطح الإدارة الكامل
 * مؤجَّل صراحةً (Developer Portal / إدارة داخلية) خارج نطاق PR-2.
 */
class PublicApiCreateClientCommand extends Command
{
    protected $signature = 'public-api:create-client
        {tenant : معرّف المستأجر (UUID) أو الـ slug}
        {name : اسم عميل الـ API}
        {--scopes= : scopes مفصولة بفواصل، مثل partners:read,products:read}
        {--expires-days= : أيام صلاحية المفتاح (اختياري؛ بلا قيمة = بلا انتهاء)}';

    protected $description = 'إنشاء عميل Public API (M2M) وإصدار مفتاح أول (يُعرض النصّ الصريح مرّة واحدة).';

    public function handle(ApiClientKeyService $service): int
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

        $expiresDays = $this->option('expires-days');
        $expiresAt = $expiresDays !== null && $expiresDays !== ''
            ? now()->addDays((int) $expiresDays)
            : null;

        $client = $service->createClient($tenant, (string) $this->argument('name'));
        $key = $service->issueKey($client, 'default', $scopes, $expiresAt);

        $this->info('تم إنشاء عميل الـ API:');
        $this->line('  client_id : '.$client->id);
        $this->line('  tenant    : '.$tenant->id.' ('.$tenant->slug.')');
        $this->line('  scopes    : '.implode(', ', $scopes));
        $this->line('  expires   : '.($expiresAt?->toDateTimeString() ?? 'بلا انتهاء'));
        $this->newLine();
        $this->warn('المفتاح — يُعرض مرّة واحدة فقط، احفظه الآن (لا يمكن استرجاعه):');
        $this->line('  '.$key->plainTextToken);

        return self::SUCCESS;
    }
}
