<?php

namespace App\Support;

use App\Models\PlatformAdministrator;
use App\Models\PlatformPriceVersion;
use App\Models\PlatformSubscription;
use App\Models\PlatformSubscriptionEvent;
use App\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * دورة العقد التجارية لمنصة Nebrax.
 *
 * هذه الطبقة تسجل التعاقد (MRR) فقط: لا تحدّث tenants.plan أو is_active أو
 * تواريخ وصول المستأجر، ولا تنشئ فاتورة أو دفعة أو أثراً في دفتر ERP.
 */
class PlatformSubscriptionLifecycle
{
    public function createPriceVersion(
        PlatformAdministrator $administrator,
        string $plan,
        string $currency,
        int $monthlyAmount,
        \DateTimeInterface $effectiveOn,
    ): PlatformPriceVersion {
        $this->assertKnownPlan($plan);
        $this->assertSupportedCurrency($currency);

        if ($monthlyAmount < 0) {
            throw new RuntimeException('السعر الشهري لا يمكن أن يكون سالباً.');
        }

        return PlatformPriceVersion::create([
            'plan'           => $plan,
            'currency'       => $currency,
            'monthly_amount' => $monthlyAmount,
            'effective_on'   => CarbonImmutable::instance($effectiveOn)->toDateString(),
            'created_by'     => $administrator->id,
        ]);
    }

    public function createContract(
        Tenant $tenant,
        ?PlatformAdministrator $administrator,
        string $plan,
        string $currency,
        \DateTimeInterface $startsOn,
        ?\DateTimeInterface $endsOn = null,
        ?string $externalReference = null,
        ?string $reason = null,
        string $status = PlatformSubscription::STATUS_ACTIVE,
    ): PlatformSubscription {
        $this->assertKnownPlan($plan);
        $this->assertSupportedCurrency($currency);
        $this->assertInitialStatus($status);

        $start = CarbonImmutable::instance($startsOn)->startOfDay();
        $end = $endsOn ? CarbonImmutable::instance($endsOn)->startOfDay() : null;
        $this->assertDateRange($start, $end);
        $this->assertFreePlanPricing($plan, $this->priceFor($plan, $currency, $start)->monthly_amount);
        $this->assertExternalReferenceAvailable($tenant->id, $externalReference);
        $this->assertNoLiveOverlap($tenant->id, $start, $end);

        return DB::transaction(function () use ($tenant, $administrator, $plan, $currency, $start, $end, $externalReference, $reason, $status): PlatformSubscription {
            $price = $this->priceFor($plan, $currency, $start);
            $subscription = PlatformSubscription::create([
                'tenant_id'                 => $tenant->id,
                'platform_price_version_id' => $price->id,
                'plan'                      => $plan,
                'status'                    => $status,
                'monthly_amount'            => $price->monthly_amount,
                'currency'                  => $currency,
                'starts_on'                 => $start->toDateString(),
                'ends_on'                   => $end?->toDateString(),
                'external_reference'        => $this->normalizedReference($externalReference),
            ]);

            $this->recordEvent(
                subscription: $subscription,
                administrator: $administrator,
                action: PlatformSubscriptionEvent::ACTION_CREATED,
                effectiveOn: $start,
                reason: $reason,
                fromPlan: null,
                fromMonthlyAmount: null,
                metadata: ['price_version_id' => $price->id, 'status' => $status],
            );

            return $subscription->load('priceVersion');
        });
    }

    /**
     * ينهي العقد السابق في اليوم السابق للسريان وينشئ عقداً جديداً بسعره المؤرخ.
     * ليس هناك احتساب نسبي أو فاتورة في هذه المرحلة.
     */
    public function transition(
        PlatformSubscription $subscription,
        ?PlatformAdministrator $administrator,
        string $toPlan,
        string $currency,
        \DateTimeInterface $effectiveOn,
        ?string $reason = null,
        ?string $externalReference = null,
    ): PlatformSubscription {
        $this->assertTransitionable($subscription);
        $this->assertKnownPlan($toPlan);
        $this->assertSupportedCurrency($currency);

        $effective = CarbonImmutable::instance($effectiveOn)->startOfDay();
        $this->assertTransitionDate($subscription, $effective);
        $this->assertExternalReferenceAvailable($subscription->tenant_id, $externalReference);

        $price = $this->priceFor($toPlan, $currency, $effective);
        $this->assertFreePlanPricing($toPlan, $price->monthly_amount);
        $this->assertNoLiveOverlap($subscription->tenant_id, $effective, null, $subscription->id);

        return DB::transaction(function () use ($subscription, $administrator, $toPlan, $currency, $effective, $reason, $externalReference, $price): PlatformSubscription {
            $previousUpdates = ['ends_on' => $effective->subDay()->toDateString()];
            if (! $effective->isFuture()) {
                $previousUpdates['status'] = PlatformSubscription::STATUS_EXPIRED;
            }
            $subscription->update($previousUpdates);

            $next = PlatformSubscription::create([
                'tenant_id'                 => $subscription->tenant_id,
                'platform_price_version_id' => $price->id,
                'plan'                      => $toPlan,
                'status'                    => PlatformSubscription::STATUS_ACTIVE,
                'monthly_amount'            => $price->monthly_amount,
                'currency'                  => $currency,
                'starts_on'                 => $effective->toDateString(),
                'external_reference'        => $this->normalizedReference($externalReference),
            ]);

            $action = $price->monthly_amount > $subscription->monthly_amount
                ? PlatformSubscriptionEvent::ACTION_UPGRADED
                : PlatformSubscriptionEvent::ACTION_DOWNGRADED;

            $this->recordEvent(
                subscription: $next,
                administrator: $administrator,
                action: $action,
                effectiveOn: $effective,
                reason: $reason,
                fromPlan: $subscription->plan,
                fromMonthlyAmount: $subscription->monthly_amount,
                metadata: [
                    'previous_subscription_id' => $subscription->id,
                    'price_version_id'          => $price->id,
                ],
            );

            return $next->load('priceVersion');
        });
    }

    /** يسجل إلغاءً مؤرخاً؛ لا يوقف وصول المستأجر ولا ينشئ تحصيلاً. */
    public function cancel(
        PlatformSubscription $subscription,
        ?PlatformAdministrator $administrator,
        \DateTimeInterface $effectiveOn,
        ?string $reason = null,
    ): PlatformSubscription {
        $this->assertTransitionable($subscription);
        $effective = CarbonImmutable::instance($effectiveOn)->startOfDay();
        $start = CarbonImmutable::instance($subscription->starts_on)->startOfDay();

        if ($effective->lessThan($start)) {
            throw new RuntimeException('تاريخ الإلغاء لا يمكن أن يسبق بدء العقد.');
        }

        return DB::transaction(function () use ($subscription, $administrator, $effective, $reason, $start): PlatformSubscription {
            $updates = ['ends_on' => $effective->subDay()->toDateString()];
            if (! $effective->isFuture()) {
                $updates['status'] = PlatformSubscription::STATUS_CANCELLED;
                $updates['cancelled_at'] = now();
            }

            $subscription->update($updates);
            $this->recordEvent(
                subscription: $subscription,
                administrator: $administrator,
                action: PlatformSubscriptionEvent::ACTION_CANCELLED,
                effectiveOn: $effective,
                reason: $reason,
                fromPlan: $subscription->plan,
                fromMonthlyAmount: $subscription->monthly_amount,
            );

            return $subscription->refresh()->load('priceVersion');
        });
    }

    /** يسجل انتهاء عقد بلغ تاريخ السريان ولا يغيّر وصول المستأجر أو خطته. */
    public function expire(
        PlatformSubscription $subscription,
        ?PlatformAdministrator $administrator,
        \DateTimeInterface $effectiveOn,
        ?string $reason = null,
    ): PlatformSubscription {
        $this->assertTransitionable($subscription);
        $effective = CarbonImmutable::instance($effectiveOn)->startOfDay();
        $start = CarbonImmutable::instance($subscription->starts_on)->startOfDay();

        if ($effective->lessThan($start)) {
            throw new RuntimeException('تاريخ الانتهاء لا يمكن أن يسبق بدء العقد.');
        }
        if ($effective->isFuture()) {
            throw new RuntimeException('انتهاء العقد المستقبلي يُسجل كتاريخ نهاية؛ التنفيذ الدوري خارج هذه المرحلة.');
        }

        return DB::transaction(function () use ($subscription, $administrator, $effective, $reason, $start): PlatformSubscription {
            $subscription->update([
                'status'  => PlatformSubscription::STATUS_EXPIRED,
                'ends_on' => $effective->equalTo($start) ? $start->toDateString() : $effective->subDay()->toDateString(),
            ]);
            $this->recordEvent(
                subscription: $subscription,
                administrator: $administrator,
                action: PlatformSubscriptionEvent::ACTION_EXPIRED,
                effectiveOn: $effective,
                reason: $reason,
                fromPlan: $subscription->plan,
                fromMonthlyAmount: $subscription->monthly_amount,
            );

            return $subscription->refresh()->load('priceVersion');
        });
    }

    public function priceFor(string $plan, string $currency, \DateTimeInterface $effectiveOn): PlatformPriceVersion
    {
        $price = PlatformPriceVersion::query()
            ->effectiveOn($plan, $currency, $effectiveOn)
            ->first();

        if (! $price) {
            throw new RuntimeException('لا توجد نسخة سعر نافذة للخطة والعملة وتاريخ السريان المحددة.');
        }

        return $price;
    }

    private function assertNoLiveOverlap(string $tenantId, CarbonImmutable $startsOn, ?CarbonImmutable $endsOn, ?string $exceptSubscriptionId = null): void
    {
        $overlap = PlatformSubscription::query()
            ->where('tenant_id', $tenantId)
            ->whereIn('status', [PlatformSubscription::STATUS_ACTIVE, PlatformSubscription::STATUS_TRIAL])
            ->when($exceptSubscriptionId, fn ($query) => $query->where('id', '!=', $exceptSubscriptionId))
            ->whereDate('starts_on', '<=', $endsOn?->toDateString() ?? '9999-12-31')
            ->where(function ($query) use ($startsOn): void {
                $query->whereNull('ends_on')->orWhereDate('ends_on', '>=', $startsOn->toDateString());
            })
            ->exists();

        if ($overlap) {
            throw new RuntimeException('يوجد عقد نافذ متداخل لهذا المستأجر في فترة السريان المحددة.');
        }
    }

    private function assertExternalReferenceAvailable(string $tenantId, ?string $reference): void
    {
        $normalized = $this->normalizedReference($reference);
        if ($normalized && PlatformSubscription::withTrashed()->where('tenant_id', $tenantId)->where('external_reference', $normalized)->exists()) {
            throw new RuntimeException('مرجع العقد مستخدم سابقاً لهذا المستأجر.');
        }
    }

    private function recordEvent(
        PlatformSubscription $subscription,
        ?PlatformAdministrator $administrator,
        string $action,
        CarbonImmutable $effectiveOn,
        ?string $reason,
        ?string $fromPlan = null,
        ?int $fromMonthlyAmount = null,
        array $metadata = [],
    ): void {
        PlatformSubscriptionEvent::create([
            'platform_subscription_id'  => $subscription->id,
            'tenant_id'                 => $subscription->tenant_id,
            'platform_administrator_id' => $administrator?->id,
            'action'                    => $action,
            'from_plan'                 => $fromPlan,
            'to_plan'                   => $subscription->plan,
            'from_monthly_amount'       => $fromMonthlyAmount,
            'to_monthly_amount'         => $subscription->monthly_amount,
            'effective_on'              => $effectiveOn->toDateString(),
            'reason'                    => $this->normalizedReason($reason),
            'metadata'                  => $metadata ?: null,
            'created_at'                => now(),
        ]);
    }

    private function assertKnownPlan(string $plan): void
    {
        if (! array_key_exists($plan, Plans::PLANS)) {
            throw new RuntimeException('الخطة غير معروفة.');
        }
    }

    private function assertSupportedCurrency(string $currency): void
    {
        if ($currency !== PlatformSubscription::CURRENCY_SAR) {
            throw new RuntimeException('عملة منصة Nebrax المدعومة في هذه المرحلة هي SAR فقط.');
        }
    }

    private function assertInitialStatus(string $status): void
    {
        if (! in_array($status, [PlatformSubscription::STATUS_ACTIVE, PlatformSubscription::STATUS_TRIAL], true)) {
            throw new RuntimeException('لا يمكن إنشاء عقد جديد إلا بحالة active أو trial.');
        }
    }

    private function assertTransitionable(PlatformSubscription $subscription): void
    {
        if (! in_array($subscription->status, [PlatformSubscription::STATUS_ACTIVE, PlatformSubscription::STATUS_TRIAL], true)) {
            throw new RuntimeException('العقد غير نافذ ولا يمكن تغيير دورة حياته.');
        }
    }

    private function assertTransitionDate(PlatformSubscription $subscription, CarbonImmutable $effectiveOn): void
    {
        $start = CarbonImmutable::instance($subscription->starts_on)->startOfDay();
        if ($effectiveOn->lessThanOrEqualTo($start)) {
            throw new RuntimeException('تاريخ سريان تغيير العقد يجب أن يأتي بعد تاريخ بدء العقد الحالي.');
        }
    }

    private function assertDateRange(CarbonImmutable $startsOn, ?CarbonImmutable $endsOn): void
    {
        if ($endsOn && $endsOn->lessThan($startsOn)) {
            throw new RuntimeException('تاريخ الانتهاء لا يمكن أن يسبق تاريخ البدء.');
        }
    }

    private function assertFreePlanPricing(string $plan, int $monthlyAmount): void
    {
        if ($plan !== 'free' && $monthlyAmount < 1) {
            throw new RuntimeException('العقد النشط لخطة مدفوعة يحتاج سعراً شهرياً أكبر من صفر.');
        }
    }

    private function normalizedReference(?string $reference): ?string
    {
        return trim((string) $reference) ?: null;
    }

    private function normalizedReason(?string $reason): ?string
    {
        return trim((string) $reason) ?: null;
    }
}
