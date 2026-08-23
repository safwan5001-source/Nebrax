<?php

namespace App\Services;

use App\Models\CommercialPlanVersion;
use App\Models\CommercialProductVersion;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use DateTimeInterface;
use Illuminate\Validation\ValidationException;

class CommercialEntitlementMaterializationService
{
    public function __construct(private EntitlementGrantService $grants) {}

    /** @return list<TenantApplicationEntitlement> */
    public function materializePlan(
        Tenant $tenant,
        CommercialPlanVersion $planVersion,
        DateTimeInterface $startsAt,
        ?DateTimeInterface $endsAt = null,
    ): array {
        $this->assertAvailablePlan($planVersion);

        $capabilityKeys = [];
        foreach ($planVersion->products()->get() as $planProduct) {
            $productVersion = CommercialProductVersion::query()->findOrFail($planProduct->commercial_product_version_id);
            $this->assertAvailableProduct($productVersion);
            foreach ($productVersion->capabilities()->orderBy('capability_key')->pluck('capability_key') as $capabilityKey) {
                $capabilityKeys[$capabilityKey] = true;
            }
        }

        return $this->grantCapabilities(
            $tenant,
            array_keys($capabilityKeys),
            EntitlementSourceType::PLAN,
            'commercial-plan-version',
            $planVersion->id,
            $planVersion->id,
            $startsAt,
            $endsAt,
            'COMMERCIAL_PLAN_VERSION',
            'Commercial plan version',
            ['commercial_plan_version_id' => $planVersion->id],
        );
    }

    /** @return list<TenantApplicationEntitlement> */
    public function materializeAddon(
        Tenant $tenant,
        CommercialProductVersion $productVersion,
        DateTimeInterface $startsAt,
        ?DateTimeInterface $endsAt = null,
    ): array {
        $this->assertAvailableProduct($productVersion);

        return $this->grantCapabilities(
            $tenant,
            $productVersion->capabilities()->orderBy('capability_key')->pluck('capability_key')->all(),
            EntitlementSourceType::ADDON,
            'commercial-product-version',
            $productVersion->id,
            $productVersion->id,
            $startsAt,
            $endsAt,
            'COMMERCIAL_PRODUCT_VERSION',
            'Commercial product version',
            ['commercial_product_version_id' => $productVersion->id],
        );
    }

    private function assertAvailablePlan(CommercialPlanVersion $planVersion): void
    {
        if ($planVersion->published_at === null) {
            throw ValidationException::withMessages(['plan_version' => 'Only published plan versions may be materialized.']);
        }
        if ($planVersion->retired_at !== null) {
            throw ValidationException::withMessages(['plan_version' => 'Retired plan versions may not receive new commercial allocations.']);
        }
    }

    private function assertAvailableProduct(CommercialProductVersion $productVersion): void
    {
        if ($productVersion->published_at === null) {
            throw ValidationException::withMessages(['product_version' => 'Only published product versions may be materialized.']);
        }
        if ($productVersion->retired_at !== null) {
            throw ValidationException::withMessages(['product_version' => 'Retired product versions may not receive new commercial allocations.']);
        }
    }

    /**
     * @param list<string> $capabilityKeys
     * @param array<string, string> $metadata
     * @return list<TenantApplicationEntitlement>
     */
    private function grantCapabilities(
        Tenant $tenant,
        array $capabilityKeys,
        EntitlementSourceType $sourceType,
        string $sourceReferenceType,
        string $sourceReferenceId,
        string $grantGroupId,
        DateTimeInterface $startsAt,
        ?DateTimeInterface $endsAt,
        string $grantReasonCode,
        string $reason,
        array $metadata,
    ): array {
        $grants = [];
        foreach ($capabilityKeys as $capabilityKey) {
            $grants[] = $this->grants->grant(
                $tenant,
                $capabilityKey,
                EntitlementAccessMode::FULL,
                $sourceType,
                $startsAt,
                $endsAt,
                $sourceReferenceType,
                $sourceReferenceId,
                $grantGroupId,
                $grantReasonCode,
                $reason,
                null,
                $metadata,
            );
        }

        return $grants;
    }
}
