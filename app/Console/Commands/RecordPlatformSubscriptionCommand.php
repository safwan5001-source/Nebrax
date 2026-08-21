<?php

namespace App\Console\Commands;

use App\Models\PlatformSubscription;
use App\Models\Tenant;
use App\Support\PlatformSubscriptionLifecycle;
use App\Support\Plans;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * يسجل عقد اشتراك منصة من المسار التشغيلي الداخلي الموحد.
 *
 * السعر لا يدخل يدوياً: يُلتقط من كتالوج منصة مؤرخ وتكتب الخدمة حدثاً ثابتاً.
 * لا يغير الأمر خطة وصول المستأجر ولا ينشئ فاتورة أو تحصيلاً.
 */
class RecordPlatformSubscriptionCommand extends Command
{
    protected $signature = 'platform:subscription:record
        {tenant : معرّف UUID أو slug للمستأجر}
        {--plan= : الخطة المتعاقد عليها: free أو basic أو pro أو enterprise}
        {--status=active : حالة العقد: trial أو active}
        {--starts-on= : تاريخ البدء YYYY-MM-DD، والافتراض اليوم}
        {--ends-on= : تاريخ الانتهاء YYYY-MM-DD (اختياري)}
        {--reference= : مرجع خارجي فريد للعقد أو الفاتورة}
        {--reason= : سبب تسجيل العقد}';

    protected $description = 'تسجيل عقد منصة من كتالوج الأسعار لمؤشرات الإيراد الشهري المتعاقد عليه';

    public function handle(PlatformSubscriptionLifecycle $lifecycle): int
    {
        $tenantKey = (string) $this->argument('tenant');
        $tenant = Tenant::query()
            ->when(
                Str::isUuid($tenantKey),
                fn ($query) => $query->where('id', $tenantKey)->orWhere('slug', $tenantKey),
                fn ($query) => $query->where('slug', $tenantKey),
            )
            ->first();

        if (! $tenant) {
            $this->error('المستأجر غير موجود.');

            return self::FAILURE;
        }

        $plan = (string) $this->option('plan');
        $status = (string) $this->option('status');
        $reference = trim((string) ($this->option('reference') ?? '')) ?: null;

        if (! array_key_exists($plan, Plans::PLANS)) {
            $this->error('الخطة غير معروفة. استخدم: ' . implode('، ', array_keys(Plans::PLANS)) . '.');

            return self::FAILURE;
        }

        if (! in_array($status, [PlatformSubscription::STATUS_ACTIVE, PlatformSubscription::STATUS_TRIAL], true)) {
            $this->error('حالة العقد غير صالحة. استخدم: trial أو active.');

            return self::FAILURE;
        }

        try {
            $startsOn = CarbonImmutable::parse((string) ($this->option('starts-on') ?: now()->toDateString()))->startOfDay();
            $endsOn = $this->option('ends-on')
                ? CarbonImmutable::parse((string) $this->option('ends-on'))->startOfDay()
                : null;
        } catch (\Throwable) {
            $this->error('تاريخ البدء أو الانتهاء غير صالح. استخدم YYYY-MM-DD.');

            return self::FAILURE;
        }

        try {
            $lifecycle->createContract(
                tenant: $tenant,
                administrator: null,
                plan: $plan,
                currency: PlatformSubscription::CURRENCY_SAR,
                startsOn: $startsOn,
                endsOn: $endsOn,
                externalReference: $reference,
                reason: $this->option('reason'),
                status: $status,
            );
        } catch (RuntimeException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->info('تم تسجيل عقد الاشتراك من كتالوج أسعار منصة Nebrax.');

        return self::SUCCESS;
    }
}
