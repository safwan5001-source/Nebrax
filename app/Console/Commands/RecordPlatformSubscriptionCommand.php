<?php

namespace App\Console\Commands;

use App\Models\PlatformSubscription;
use App\Models\Tenant;
use App\Support\Plans;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * يسجل عقد اشتراك للمنصة من مسار تشغيلي داخلي فقط.
 *
 * لا يغيّر خطة المستأجر أو تواريخ وصوله في جدول tenants؛ تلك سياسة وصول مستقلة.
 * الهدف هنا إعطاء لوحة المنصة مصدراً قابلاً للتدقيق للإيراد الشهري المتعاقد عليه.
 */
class RecordPlatformSubscriptionCommand extends Command
{
    protected $signature = 'platform:subscription:record
        {tenant : معرّف UUID أو slug للمستأجر}
        {--plan= : الخطة المتعاقد عليها: free أو basic أو pro أو enterprise}
        {--monthly-minor= : المبلغ الشهري المتعاقد عليه بالهللات}
        {--status=active : حالة العقد: trial أو active أو cancelled أو expired}
        {--starts-on= : تاريخ البدء YYYY-MM-DD، والافتراض اليوم}
        {--ends-on= : تاريخ الانتهاء YYYY-MM-DD (اختياري)}
        {--reference= : مرجع خارجي فريد للعقد أو الفاتورة}';

    protected $description = 'تسجيل عقد اشتراك منصة لمؤشرات الإيراد الشهري المتعاقد عليه';

    public function handle(): int
    {
        $tenantKey = (string) $this->argument('tenant');
        $tenant = Tenant::query()
            ->where('id', $tenantKey)
            ->orWhere('slug', $tenantKey)
            ->first();

        if (! $tenant) {
            $this->error('المستأجر غير موجود.');

            return self::FAILURE;
        }

        $plan = (string) $this->option('plan');
        $status = (string) $this->option('status');
        $monthlyMinor = $this->option('monthly-minor');
        $reference = trim((string) ($this->option('reference') ?? '')) ?: null;

        if (! array_key_exists($plan, Plans::PLANS)) {
            $this->error('الخطة غير معروفة. استخدم: ' . implode('، ', array_keys(Plans::PLANS)) . '.');

            return self::FAILURE;
        }

        if (! in_array($status, PlatformSubscription::STATUSES, true)) {
            $this->error('حالة العقد غير صالحة. استخدم: ' . implode('، ', PlatformSubscription::STATUSES) . '.');

            return self::FAILURE;
        }

        if ($monthlyMinor === null || ! ctype_digit((string) $monthlyMinor)) {
            $this->error('مرّر --monthly-minor كمبلغ صحيح بالهللات، مثل 99000 لمبلغ 990.00 ر.س.');

            return self::FAILURE;
        }

        $monthlyMinor = (int) $monthlyMinor;
        if ($status === PlatformSubscription::STATUS_ACTIVE && $monthlyMinor < 1) {
            $this->error('العقد النشط يحتاج مبلغاً شهرياً متعاقداً عليه أكبر من صفر.');

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

        if ($endsOn && $endsOn->lessThan($startsOn)) {
            $this->error('تاريخ الانتهاء لا يمكن أن يسبق تاريخ البدء.');

            return self::FAILURE;
        }

        if ($reference && PlatformSubscription::where('tenant_id', $tenant->id)->where('external_reference', $reference)->exists()) {
            $this->error('مرجع العقد مستخدم سابقاً لهذا المستأجر.');

            return self::FAILURE;
        }

        if ($status === PlatformSubscription::STATUS_ACTIVE && $this->hasOverlappingActiveSubscription($tenant->id, $startsOn, $endsOn)) {
            $this->error('يوجد عقد نشط متداخل لهذا المستأجر؛ أغلِق العقد السابق أو استخدم تاريخ بدء لاحقاً.');

            return self::FAILURE;
        }

        PlatformSubscription::create([
            'tenant_id'          => $tenant->id,
            'plan'               => $plan,
            'status'             => $status,
            'monthly_amount'     => $monthlyMinor,
            'starts_on'          => $startsOn->toDateString(),
            'ends_on'            => $endsOn?->toDateString(),
            'cancelled_at'       => $status === PlatformSubscription::STATUS_CANCELLED ? now() : null,
            'external_reference' => $reference,
        ]);

        $this->info('تم تسجيل عقد الاشتراك لمؤشرات منصة Nebrax.');

        return self::SUCCESS;
    }

    private function hasOverlappingActiveSubscription(string $tenantId, CarbonImmutable $startsOn, ?CarbonImmutable $endsOn): bool
    {
        return PlatformSubscription::query()
            ->where('tenant_id', $tenantId)
            ->where('status', PlatformSubscription::STATUS_ACTIVE)
            ->whereDate('starts_on', '<=', $endsOn?->toDateString() ?? '9999-12-31')
            ->where(function ($query) use ($startsOn): void {
                $query->whereNull('ends_on')->orWhereDate('ends_on', '>=', $startsOn->toDateString());
            })
            ->exists();
    }
}
