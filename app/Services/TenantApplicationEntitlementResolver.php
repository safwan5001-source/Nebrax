<?php

namespace App\Services;

use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Support\ApplicationCatalog;
use App\Support\EntitlementAccessMode;
use App\Support\TenantApplicationEntitlementDecision;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Throwable;

class TenantApplicationEntitlementResolver
{
    public function resolve(Tenant $tenant, string $capabilityKey, DateTimeInterface $evaluationTime): TenantApplicationEntitlementDecision
    {
        if (! ApplicationCatalog::isActivatable($capabilityKey)) return TenantApplicationEntitlementDecision::DENIED;

        try {
            $at = CarbonImmutable::instance($evaluationTime)->utc();
            $modes = TenantApplicationEntitlement::query()
                ->where('tenant_id', $tenant->getKey())
                ->where('capability_key', $capabilityKey)
                ->where('starts_at', '<=', $at)
                ->where(fn ($query) => $query->whereNull('ends_at')->orWhere('ends_at', '>', $at))
                ->where(fn ($query) => $query->whereNull('revoked_at')->orWhere('revoked_at', '>', $at))
                ->pluck('access_mode');

            if ($modes->contains(EntitlementAccessMode::FULL->value)) return TenantApplicationEntitlementDecision::FULL;
            if ($modes->contains(EntitlementAccessMode::READ_ONLY->value)) return TenantApplicationEntitlementDecision::READ_ONLY;
        } catch (Throwable) {
            return TenantApplicationEntitlementDecision::DENIED;
        }

        return TenantApplicationEntitlementDecision::DENIED;
    }
}
