<?php

namespace App\Console\Commands;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Support\HostnameNormalizer;
use App\Support\InvalidHostnameException;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * COM-7-PREVIEW-FIX-1 — تسجيل نطاق Preview/إنتاج واحد كـ `StorefrontDomain`
 * نشط وموثَّق، بعد أن يزوّد المشغِّل صراحةً هوية المستأجر — لا تخمين، ولا
 * إنشاء مستأجر جديد، ولا لمس أي مستأجر آخر.
 *
 * **مثالي التكرار (idempotent)**: إعادة تشغيله بنفس المدخلات بعد نجاحه لا
 * تُنشئ صفاً مكرراً ولا تفشل — تتحقق من الحالة القائمة وتُقرّها إن كانت
 * مطابقة، أو تفشل بوضوح إن تعارضت (نطاق يخصّ مستأجراً آخر مثلاً).
 *
 * **لا يُنشئ SalesChannel جديدة أبداً** — عمداً: اختراع قناة بيع نشطة لمستأجر
 * فعل حقيقي على بياناته التجارية يستحق قراراً صريحاً من فريق ذلك المستأجر، لا
 * أثراً جانبياً لأمر تسجيل نطاق. يفشل بوضوح إن لم توجد قناة `web` نشطة واحدة،
 * ويطلب من المشغّل تحديدها بـ`--channel` إن وُجد أكثر من واحدة.
 *
 * ينشئ `Storefront` فقط إن لم توجد أي واحدة على تلك القناة بعد (`firstOrCreate`)
 * — وهذا وحده امتداد آمن: صف تشغيلي فارغ لا أثر محاسبي له، بخلاف `SalesChannel`.
 */
class RegisterStorefrontDomainCommand extends Command
{
    protected $signature = 'storefront:register-domain
        {tenant : معرّف المستأجر (UUID) أو الـ slug — يزوّده المشغّل صراحةً، لا تخمين}
        {hostname : اسم النطاق الفعلي المطلوب تسجيله (مثال: storefront-one-xi.vercel.app)}
        {--channel= : معرّف/slug قناة البيع (web) المطلوبة — إلزامي فقط إن وُجد أكثر من قناة web نشطة واحدة لهذا المستأجر}
        {--make-primary : اجعل هذا النطاق النطاق الأساسي لمتجره (لا يُفعَّل افتراضياً كي لا يزيح نطاقاً أساسياً قائماً بصمت)}
        {--yes : تنفيذ مباشر بلا تأكيد تفاعلي (للتشغيل غير التفاعلي)}';

    protected $description = 'تسجيل نطاق (hostname) كـ StorefrontDomain نشط وموثَّق لمستأجر محدَّد صراحةً — مثالي التكرار، لا يخمّن المستأجر ولا ينشئ قناة بيع';

    public function handle(): int
    {
        $tenantRef = (string) $this->argument('tenant');
        $rawHostname = (string) $this->argument('hostname');

        $tenant = Tenant::where('id', $tenantRef)->orWhere('slug', $tenantRef)->first();
        if ($tenant === null) {
            $this->error("المستأجر «{$tenantRef}» غير موجود. لم يُغيَّر شيء — زوّد معرّفاً أو slug صحيحاً لمستأجر قائم فعلاً.");

            return self::FAILURE;
        }

        try {
            $hostname = HostnameNormalizer::normalize($rawHostname);
        } catch (InvalidHostnameException $e) {
            $this->error("اسم النطاق «{$rawHostname}» غير صالح: {$e->getMessage()}. لم يُغيَّر شيء.");

            return self::FAILURE;
        }

        // فحصٌ عالمي (بلا سياق مستأجر بعد) — يطابق تماماً بحث ResolveStorefrontDomain
        // نفسه: الفريد هنا هو hostname عالمياً لا لكل مستأجر.
        $existingDomain = StorefrontDomain::withoutGlobalScope(TenantScope::class)
            ->where('hostname', $hostname)->first();

        if ($existingDomain !== null && $existingDomain->tenant_id !== $tenant->id) {
            $this->error(
                "اسم النطاق «{$hostname}» مسجَّل بالفعل لمستأجر آخر (معرّف {$existingDomain->tenant_id}). ".
                'لم يُغيَّر شيء — هذا الأمر لا ينقل نطاقاً بين المستأجرين أبداً.',
            );

            return self::FAILURE;
        }

        app(TenantContext::class)->set($tenant->id);

        try {
            $channelOption = $this->option('channel');
            $channelsQuery = SalesChannel::where('type', SalesChannel::TYPE_WEB)->where('is_active', true);

            if ($channelOption !== null) {
                $channelsQuery->where(function ($q) use ($channelOption) {
                    $q->where('id', $channelOption)->orWhere('slug', $channelOption);
                });
            }

            $channels = $channelsQuery->get();

            if ($channels->isEmpty()) {
                $this->error(
                    "لا توجد قناة بيع (SalesChannel) من نوع web نشطة لهذا المستأجر".
                    ($channelOption !== null ? " مطابقة لـ «{$channelOption}»" : '').
                    '. هذا الأمر لا ينشئ قناة بيع جديدة — أنشئها أولاً عبر المسار المعتمد، ثم أعد التشغيل. لم يُغيَّر شيء.',
                );

                return self::FAILURE;
            }

            if ($channels->count() > 1) {
                $ids = $channels->pluck('id')->implode(', ');
                $this->error(
                    "يوجد أكثر من قناة بيع web نشطة لهذا المستأجر ({$ids}). ".
                    'مرّر --channel=<id-أو-slug> لتحديد القناة المقصودة صراحةً. لم يُغيَّر شيء.',
                );

                return self::FAILURE;
            }

            $channel = $channels->first();

            $this->line("المستأجر: {$tenant->name} ({$tenant->id})");
            $this->line("قناة البيع: {$channel->name} ({$channel->id})");
            $this->line("النطاق المطلوب تسجيله: {$hostname}");

            if (! $this->option('yes') && ! $this->confirm('تأكيد تسجيل هذا النطاق لهذا المستأجر/القناة؟', false)) {
                $this->warn('أُلغي — لم يُغيَّر شيء.');

                return self::FAILURE;
            }

            $result = DB::transaction(function () use ($channel, $hostname, $existingDomain) {
                $storefront = Storefront::firstOrCreate(
                    ['sales_channel_id' => $channel->id],
                    ['slug' => 'main', 'name' => $channel->name, 'is_active' => true, 'default_locale' => 'ar'],
                );

                if (! $storefront->is_active) {
                    $storefront->update(['is_active' => true]);
                }

                if ($existingDomain !== null) {
                    // نفس المستأجر (تحقّقنا أعلاه) — مثالي التكرار: أقرّ الحالة المطلوبة فقط.
                    if ($existingDomain->storefront_id !== $storefront->id) {
                        throw new RuntimeException(
                            "اسم النطاق «{$hostname}» مسجَّل بالفعل لمتجر آخر لنفس المستأجر (معرّف {$existingDomain->storefront_id}). ".
                            'لم يُغيَّر شيء — راجع الحالة القائمة يدوياً بدل الكتابة فوقها.',
                        );
                    }

                    $existingDomain->update([
                        'is_active' => true,
                        'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
                    ]);
                    $domain = $existingDomain;
                } else {
                    $domain = StorefrontDomain::create([
                        'storefront_id' => $storefront->id,
                        'hostname' => $hostname,
                        'type' => StorefrontDomain::TYPE_CUSTOM,
                        'is_active' => true,
                        'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
                    ]);
                }

                return compact('storefront', 'domain');
            });

            if ($this->option('make-primary')) {
                $result['domain']->makePrimary();
            }

            $this->info("تم: النطاق «{$hostname}» نشطٌ وموثَّقٌ لمتجر «{$result['storefront']->name}» (معرّف {$result['storefront']->id}).");

            return self::SUCCESS;
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        } finally {
            app(TenantContext::class)->forget();
        }
    }
}
