<?php

namespace App\Services;

use App\Models\CommercialProductVersionCapability;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Support\ApplicationCatalog;
use App\Support\EntitlementSourceType;
use App\Support\TenantApplicationEntitlementDecision;
use Carbon\CarbonImmutable;

class CommercialApplicationStatusService
{
    public function __construct(private TenantApplicationEntitlementResolver $resolver) {}

    /**
     * Read-only projection for Settings → Applications. It is deliberately not
     * an authority for navigation, enforcement, or TenantApplicationState.
     *
     * @return array<string, array{commercial:array{availability:string,source_count:int},effective_access:string,dependency_status:string}>
     */
    public function forTenant(Tenant $tenant): array
    {
        $at = CarbonImmutable::now('UTC');
        $activeGrants = TenantApplicationEntitlement::query()
            ->where('tenant_id', $tenant->id)
            ->where('starts_at', '<=', $at)
            ->where(fn ($query) => $query->whereNull('ends_at')->orWhere('ends_at', '>', $at))
            ->where(fn ($query) => $query->whereNull('revoked_at')->orWhere('revoked_at', '>', $at))
            ->get(['capability_key', 'source_type']);
        $sourcesByCapability = $activeGrants->groupBy('capability_key')
            ->map(fn ($grants) => $grants->pluck('source_type')->unique()->values()->all());
        $offeredCapabilities = CommercialProductVersionCapability::query()
            ->whereHas('productVersion', fn ($query) => $query->whereNotNull('published_at')->whereNull('retired_at'))
            ->pluck('capability_key')
            ->flip();

        $result = [];
        foreach (ApplicationCatalog::all() as $key => $application) {
            $sources = $sourcesByCapability->get($key, []);
            $availability = $this->availability($application, $sources, $offeredCapabilities->has($key));
            $dependencyStatus = $application['dependencies'] === []
                ? 'not_applicable'
                : ($this->dependenciesSatisfied($tenant, $application['dependencies'], $at) ? 'satisfied' : 'missing');

            $result[$key] = [
                'commercial' => [
                    'availability' => $availability,
                    'source_count' => count($sources),
                ],
                'effective_access' => $this->resolver->resolve($tenant, $key, $at)->value,
                'dependency_status' => $dependencyStatus,
            ];
        }

        return $result;
    }

    /** @param array{mandatory:bool,maturity:string} $application @param list<string> $sources */
    private function availability(array $application, array $sources, bool $hasPublishedProduct): string
    {
        if ($application['maturity'] !== ApplicationCatalog::MATURITY_BUILT) return 'not_available';
        if ($application['mandatory'] || in_array(EntitlementSourceType::PLAN->value, $sources, true)) return 'included';
        if (in_array(EntitlementSourceType::TRIAL->value, $sources, true)) return 'trial';
        if (in_array(EntitlementSourceType::ADDON->value, $sources, true) || $hasPublishedProduct) return 'addon';

        return 'not_available';
    }

    /** @param list<string> $dependencies */
    private function dependenciesSatisfied(Tenant $tenant, array $dependencies, CarbonImmutable $at): bool
    {
        foreach ($dependencies as $dependency) {
            $definition = ApplicationCatalog::find($dependency);
            if ($definition !== null && $definition['mandatory']) continue;
            if ($this->resolver->resolve($tenant, $dependency, $at) === TenantApplicationEntitlementDecision::DENIED) return false;
        }

        return true;
    }
}
