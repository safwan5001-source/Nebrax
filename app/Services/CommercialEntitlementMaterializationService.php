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
        ?string $grantGroupId = null,
        ?string $grantedByPlatformAdministratorId = null,
        array $assignmentMetadata = [],
        bool $allowRetiredExistingSource = false,
        EntitlementAccessMode $accessMode = EntitlementAccessMode::FULL,
    ): array {
        $this->assertAvailablePlan($planVersion, $allowRetiredExistingSource);

        return $this->grantCapabilities(
            $tenant,
            $this->planCapabilityKeys($planVersion),
            EntitlementSourceType::PLAN,
            'commercial-plan-version',
            $planVersion->id,
            $grantGroupId ?? $planVersion->id,
            $startsAt,
            $endsAt,
            'COMMERCIAL_PLAN_VERSION',
            'Commercial plan version',
            ['commercial_plan_version_id' => $planVersion->id, ...$assignmentMetadata],
            $grantedByPlatformAdministratorId,
            $accessMode,
        );
    }

    /** @return list<TenantApplicationEntitlement> */
    public function materializeAddon(
        Tenant $tenant,
        CommercialProductVersion $productVersion,
        DateTimeInterface $startsAt,
        ?DateTimeInterface $endsAt = null,
        ?string $grantGroupId = null,
        ?string $grantedByPlatformAdministratorId = null,
        array $assignmentMetadata = [],
        bool $allowRetiredExistingSource = false,
        EntitlementAccessMode $accessMode = EntitlementAccessMode::FULL,
    ): array {
        $this->assertAvailableProduct($productVersion, $allowRetiredExistingSource);

        return $this->grantCapabilities(
            $tenant,
            $productVersion->capabilities()->orderBy('capability_key')->pluck('capability_key')->all(),
            EntitlementSourceType::ADDON,
            'commercial-product-version',
            $productVersion->id,
            $grantGroupId ?? $productVersion->id,
            $startsAt,
            $endsAt,
            'COMMERCIAL_PRODUCT_VERSION',
            'Commercial product version',
            ['commercial_product_version_id' => $productVersion->id, ...$assignmentMetadata],
            $grantedByPlatformAdministratorId,
            $accessMode,
        );
    }

    /** @return array{source_type:string,version_id:string,products:list<string>,capability_keys:list<string>} */
    public function previewPlan(CommercialPlanVersion $planVersion): array
    {
        $this->assertAvailablePlan($planVersion);

        return [
            'source_type' => EntitlementSourceType::PLAN->value,
            'version_id' => $planVersion->id,
            'products' => $planVersion->products()->pluck('commercial_product_version_id')->all(),
            'capability_keys' => $this->planCapabilityKeys($planVersion),
        ];
    }

    /** @return array{source_type:string,version_id:string,products:list<string>,capability_keys:list<string>} */
    public function previewAddon(CommercialProductVersion $productVersion): array
    {
        $this->assertAvailableProduct($productVersion);

        return [
            'source_type' => EntitlementSourceType::ADDON->value,
            'version_id' => $productVersion->id,
            'products' => [$productVersion->id],
            'capability_keys' => $productVersion->capabilities()->orderBy('capability_key')->pluck('capability_key')->all(),
        ];
    }

    /** @return list<string> */
    private function planCapabilityKeys(CommercialPlanVersion $planVersion): array
    {
        $capabilityKeys = [];
        foreach ($planVersion->products()->get() as $planProduct) {
            $productVersion = CommercialProductVersion::query()->findOrFail($planProduct->commercial_product_version_id);
            $this->assertAvailableProduct($productVersion);
            foreach ($productVersion->capabilities()->orderBy('capability_key')->pluck('capability_key') as $capabilityKey) {
                $capabilityKeys[$capabilityKey] = true;
            }
        }

        return array_keys($capabilityKeys);
    }

    private function assertAvailablePlan(CommercialPlanVersion $planVersion, bool $allowRetiredExistingSource = false): void
    {
        if ($planVersion->published_at === null) {
            throw ValidationException::withMessages(['plan_version' => 'Only published plan versions may be materialized.']);
        }
        if (! $allowRetiredExistingSource && $planVersion->retired_at !== null) {
            throw ValidationException::withMessages(['plan_version' => 'Retired plan versions may not receive new commercial allocations.']);
        }
    }

    private function assertAvailableProduct(CommercialProductVersion $productVersion, bool $allowRetiredExistingSource = false): void
    {
        if ($productVersion->published_at === null) {
            throw ValidationException::withMessages(['product_version' => 'Only published product versions may be materialized.']);
        }
        if (! $allowRetiredExistingSource && $productVersion->retired_at !== null) {
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
        ?string $grantedByPlatformAdministratorId = null,
        EntitlementAccessMode $accessMode = EntitlementAccessMode::FULL,
    ): array {
        $grants = [];
        foreach ($capabilityKeys as $capabilityKey) {
            $grants[] = $this->grants->grant(
                $tenant,
                $capabilityKey,
                $accessMode,
                $sourceType,
                $startsAt,
                $endsAt,
                $sourceReferenceType,
                $sourceReferenceId,
                $grantGroupId,
                $grantReasonCode,
                $reason,
                $grantedByPlatformAdministratorId,
                $metadata,
            );
        }

        return $grants;
    }
}
