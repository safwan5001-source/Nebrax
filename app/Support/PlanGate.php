<?php

namespace App\Support;

use App\Models\Tenant;

/**
 * بوابة الاشتراك: حدود الخطة وحالة الاشتراك لكل مستأجر.
 */
class PlanGate
{
    /**
     * حدّ خطة المستأجر لمفتاح معيّن: تجاوز المستأجر (plan_limits) ثم افتراضي الخطة.
     * يُعيد null = بلا حد.
     */
    public static function limit(Tenant $tenant, string $key): ?int
    {
        $overrides = $tenant->plan_limits ?? [];
        if (array_key_exists($key, $overrides)) {
            return $overrides[$key] === null ? null : (int) $overrides[$key];
        }

        $value = Plans::defaults($tenant->plan)[$key] ?? null;

        return $value === null ? null : (int) $value;
    }

    /**
     * هل اشتراك المستأجر نشط؟
     * نشط إذا كان مفعّلاً و(لا تواريخ انتهاء، أو الاشتراك/التجربة ما زالا ساريين).
     */
    public static function subscriptionActive(Tenant $tenant): bool
    {
        if (! $tenant->is_active) {
            return false;
        }
        if ($tenant->subscription_ends_at && $tenant->subscription_ends_at->isFuture()) {
            return true;
        }
        if ($tenant->trial_ends_at && $tenant->trial_ends_at->isFuture()) {
            return true;
        }

        // لا تواريخ انتهاء محدّدة = نشط (مثل المؤسسة المُنشأة حديثاً)
        return ! $tenant->subscription_ends_at && ! $tenant->trial_ends_at;
    }
}
