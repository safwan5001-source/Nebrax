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
    public function __construct(private CommercialAssignmentLifecycleService $commercialLifecycle) {}

    public function resolve(Tenant $tenant, string $capabilityKey, DateTimeInterface $evaluationTime): TenantApplicationEntitlementDecision
    {
        if (! ApplicationCatalog::isActivatable($capabilityKey)) return TenantApplicationEntitlementDecision::DENIED;

        try {
            $at = CarbonImmutable::instance($evaluationTime)->utc();
            $grants = TenantApplicationEntitlement::query()
                ->where('tenant_id', $tenant->getKey())
                ->where('capability_key', $capabilityKey)
                ->where('starts_at', '<=', $at)
                ->where(fn ($query) => $query->whereNull('ends_at')->orWhere('ends_at', '>', $at))
                ->where(fn ($query) => $query->whereNull('revoked_at')->orWhere('revoked_at', '>', $at))
                ->get(['access_mode', 'grant_group_id', 'metadata']);

            $effectiveModes = $grants->map(function (TenantApplicationEntitlement $grant) use ($tenant, $at): string {
                $lifecycle = $this->commercialLifecycle->accessForGrant($tenant, $grant->grant_group_id, $at);
                if (is_array($grant->metadata) && array_key_exists('commercial_assignment_id', $grant->metadata) && $lifecycle === null) {
                    return TenantApplicationEntitlementDecision::DENIED->value;
                }
                if ($lifecycle === TenantApplicationEntitlementDecision::DENIED) return TenantApplicationEntitlementDecision::DENIED->value;
                if ($lifecycle === TenantApplicationEntitlementDecision::READ_ONLY) return EntitlementAccessMode::READ_ONLY->value;

                return $grant->access_mode;
            });

            if ($effectiveModes->contains(EntitlementAccessMode::FULL->value)) return TenantApplicationEntitlementDecision::FULL;
            if ($effectiveModes->contains(EntitlementAccessMode::READ_ONLY->value)) return TenantApplicationEntitlementDecision::READ_ONLY;
        } catch (Throwable) {
            return TenantApplicationEntitlementDecision::DENIED;
        }

        return TenantApplicationEntitlementDecision::DENIED;
    }
}
