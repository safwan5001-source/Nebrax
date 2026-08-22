<?php

namespace App\Services;

use App\Tenancy\TenantContext;
use Illuminate\Support\Str;

/**
 * سياسة نشر Entitlement الخاضعة لإعدادات المنصة فقط. لا تقرأ feature_flags
 * ولا أي هوية مستأجر واردة من HTTP.
 */
final class EntitlementRolloutPolicy
{
    public const MODE_OFF = 'off';
    public const MODE_SHADOW = 'shadow';
    public const MODE_ENFORCE_COHORT = 'enforce_cohort';

    public function __construct(private TenantContext $tenantContext) {}

    public function mode(): string
    {
        $mode = config('entitlements.mode', self::MODE_OFF);

        return in_array($mode, [self::MODE_OFF, self::MODE_SHADOW, self::MODE_ENFORCE_COHORT], true)
            ? $mode
            : self::MODE_OFF;
    }

    public function isShadow(): bool
    {
        return $this->mode() === self::MODE_SHADOW;
    }

    public function isAuthoritativeForCurrentTenant(): bool
    {
        $tenantId = $this->tenantContext->id();

        return $this->mode() === self::MODE_ENFORCE_COHORT
            && $tenantId !== null
            && in_array($tenantId, $this->cohortTenantIds(), true);
    }

    /** @return list<string> */
    public function cohortTenantIds(): array
    {
        $configured = config('entitlements.enforce_tenants', '');
        if (! is_string($configured)) {
            return [];
        }

        $ids = array_map('trim', explode(',', $configured));
        $ids = array_filter($ids, fn (string $id): bool => $id !== '' && Str::isUuid($id));

        return array_values(array_unique($ids));
    }
}
