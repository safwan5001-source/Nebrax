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

            $effectiveModes = $grants->map(
                fn (TenantApplicationEntitlement $grant): string => $this->effectiveModeFor($tenant, $grant, $at),
            );

            if ($effectiveModes->contains(EntitlementAccessMode::FULL->value)) return TenantApplicationEntitlementDecision::FULL;
            if ($effectiveModes->contains(EntitlementAccessMode::READ_ONLY->value)) return TenantApplicationEntitlementDecision::READ_ONLY;
        } catch (Throwable) {
            return TenantApplicationEntitlementDecision::DENIED;
        }

        return TenantApplicationEntitlementDecision::DENIED;
    }

    /**
     * نفس عقد `resolve()` لعدّة قدرات باستعلام منحٍ واحد — يخدم الظهور الملاحي
     * الذي يقيّم كل القدرات المحروسة تجارياً في طلب واحد بدل استعلام لكل مفتاح.
     *
     * @param  list<string>  $capabilityKeys
     * @return array<string, TenantApplicationEntitlementDecision>
     */
    public function resolveMany(Tenant $tenant, array $capabilityKeys, DateTimeInterface $evaluationTime): array
    {
        $result = [];
        $resolvable = [];

        foreach ($capabilityKeys as $capabilityKey) {
            if (ApplicationCatalog::isActivatable($capabilityKey)) {
                $resolvable[] = $capabilityKey;
            }
            $result[$capabilityKey] = TenantApplicationEntitlementDecision::DENIED;
        }

        if ($resolvable === []) {
            return $result;
        }

        try {
            $at = CarbonImmutable::instance($evaluationTime)->utc();
            $grants = TenantApplicationEntitlement::query()
                ->where('tenant_id', $tenant->getKey())
                ->whereIn('capability_key', $resolvable)
                ->where('starts_at', '<=', $at)
                ->where(fn ($query) => $query->whereNull('ends_at')->orWhere('ends_at', '>', $at))
                ->where(fn ($query) => $query->whereNull('revoked_at')->orWhere('revoked_at', '>', $at))
                ->get(['capability_key', 'access_mode', 'grant_group_id', 'metadata']);

            foreach ($grants->groupBy('capability_key') as $capabilityKey => $capabilityGrants) {
                $modes = $capabilityGrants->map(
                    fn (TenantApplicationEntitlement $grant): string => $this->effectiveModeFor($tenant, $grant, $at),
                );

                $result[$capabilityKey] = match (true) {
                    $modes->contains(EntitlementAccessMode::FULL->value) => TenantApplicationEntitlementDecision::FULL,
                    $modes->contains(EntitlementAccessMode::READ_ONLY->value) => TenantApplicationEntitlementDecision::READ_ONLY,
                    default => TenantApplicationEntitlementDecision::DENIED,
                };
            }
        } catch (Throwable) {
            return array_map(fn (): TenantApplicationEntitlementDecision => TenantApplicationEntitlementDecision::DENIED, $result);
        }

        return $result;
    }

    private function effectiveModeFor(Tenant $tenant, TenantApplicationEntitlement $grant, DateTimeInterface $at): string
    {
        $lifecycle = $this->commercialLifecycle->accessForGrant($tenant, $grant->grant_group_id, $at);
        if (is_array($grant->metadata) && array_key_exists('commercial_assignment_id', $grant->metadata) && $lifecycle === null) {
            return TenantApplicationEntitlementDecision::DENIED->value;
        }
        if ($lifecycle === TenantApplicationEntitlementDecision::DENIED) return TenantApplicationEntitlementDecision::DENIED->value;
        if ($lifecycle === TenantApplicationEntitlementDecision::READ_ONLY) return EntitlementAccessMode::READ_ONLY->value;

        return $grant->access_mode;
    }
}
