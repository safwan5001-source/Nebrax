<?php

namespace App\Support;

use App\Models\PlatformSubscription;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;

/**
 * يبني مؤشرات تشغيل منصة Nebrax من مصادرها التشغيلية الداخلية.
 *
 * لا يعيد صفوف مستأجرين أو أسماء مستخدمين؛ كل مخرجاته أرقام أو تجميعات حسب الخطة.
 */
class PlatformMetrics
{
    public function overview(): array
    {
        $today = CarbonImmutable::today();
        // النظام أحادي العملة (SAR) اليوم؛ استبعاد أي عملة أخرى يمنع خلطها في مؤشرات نقدية واحدة.
        $activeSubscriptions = PlatformSubscription::query()
            ->activeOn($today)
            ->where('currency', PlatformSubscription::CURRENCY_SAR);
        $monthlyRecurringRevenueMinor = (int) (clone $activeSubscriptions)->sum('monthly_amount');
        $renewalDeadline = $today->addDays(30);
        $renewals = (clone $activeSubscriptions)
            ->whereNotNull('ends_on')
            ->whereBetween('ends_on', [$today->toDateString(), $renewalDeadline->toDateString()]);
        $renewalValueMinor = (int) (clone $renewals)->sum('monthly_amount');
        $activeSubscriptionCount = (clone $activeSubscriptions)->count();
        $averageActiveSubscriptionMinor = $activeSubscriptionCount === 0
            ? 0
            : intdiv($monthlyRecurringRevenueMinor, $activeSubscriptionCount);

        return [
            'tenants' => [
                'total'    => Tenant::count(),
                'active'   => Tenant::where('is_active', true)->count(),
                'inactive' => Tenant::where('is_active', false)->count(),
            ],
            'users' => [
                'total'    => User::count(),
                'active'   => User::where('is_active', true)->count(),
                'inactive' => User::where('is_active', false)->count(),
            ],
            'subscriptions' => [
                'active'                           => $activeSubscriptionCount,
                'trials'                           => $this->trialsAt($today),
                'renewals_next_30_days'            => (clone $renewals)->count(),
                'renewal_value_at_risk_minor'      => $renewalValueMinor,
                'renewal_value_at_risk'            => Money::toRiyal($renewalValueMinor),
                'monthly_recurring_revenue_minor'  => $monthlyRecurringRevenueMinor,
                'monthly_recurring_revenue'        => Money::toRiyal($monthlyRecurringRevenueMinor),
                'average_active_subscription_minor' => $averageActiveSubscriptionMinor,
                'average_active_subscription' => Money::toRiyal($averageActiveSubscriptionMinor),
                'by_plan' => $this->activeByPlan($today),
            ],
        ];
    }

    /** @return array<int, array{plan: string, active: int, monthly_recurring_revenue_minor: int, monthly_recurring_revenue: string}> */
    private function activeByPlan(CarbonImmutable $today): array
    {
        return PlatformSubscription::query()
            ->activeOn($today)
            ->where('currency', PlatformSubscription::CURRENCY_SAR)
            ->selectRaw('plan, COUNT(*) as active, COALESCE(SUM(monthly_amount), 0) as monthly_recurring_revenue_minor')
            ->groupBy('plan')
            ->orderBy('plan')
            ->get()
            ->map(fn (PlatformSubscription $subscription): array => [
                'plan'                             => $subscription->plan,
                'active'                           => (int) $subscription->active,
                'monthly_recurring_revenue_minor'  => (int) $subscription->monthly_recurring_revenue_minor,
                'monthly_recurring_revenue'        => Money::toRiyal((int) $subscription->monthly_recurring_revenue_minor),
            ])
            ->all();
    }

    private function trialsAt(CarbonImmutable $today): int
    {
        return PlatformSubscription::query()
            ->where('status', PlatformSubscription::STATUS_TRIAL)
            ->whereDate('starts_on', '<=', $today)
            ->where(function ($query) use ($today): void {
                $query->whereNull('ends_on')->orWhereDate('ends_on', '>=', $today);
            })
            ->count();
    }
}
