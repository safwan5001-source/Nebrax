<?php

namespace App\Services;

use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantCommercialAssignment;
use App\Support\ApplicationCatalog;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Closure;

class PlatformTenantCommercialApplicationService
{
    public function __construct(
        private TenantApplicationService $applications,
        private PlatformApplicationOverrideService $overrides,
    ) {}

    /** @return array<string, mixed> */
    public function summary(Tenant $tenant): array
    {
        return $this->withTenantContext($tenant, function () use ($tenant): array {
            $at = CarbonImmutable::now('UTC');
            $assignments = TenantCommercialAssignment::query()
                ->where('tenant_id', $tenant->id)
                ->with(['planVersion.products.productVersion.product', 'productVersion.product'])
                ->latest('created_at')
                ->get();
            $active = $assignments->filter(fn (TenantCommercialAssignment $assignment): bool => $this->isCurrent($assignment, $at));
            $currentPlan = $active->first(fn (TenantCommercialAssignment $assignment) => $assignment->source_type === TenantCommercialAssignment::SOURCE_PLAN);
            $overrideSummary = $this->overrides->summary($tenant);
            $overrideByKey = collect($overrideSummary['applications'])->keyBy('key');

            return [
                'applications' => collect($this->applications->stateFor())
                    ->map(fn (array $application, string $key) => [
                        ...$this->applicationData($key, $application),
                        ...$this->overrideFields($overrideByKey->get($key, [])),
                    ])
                    ->values()
                    ->all(),
                'commercial_summary' => [
                    'current_plan' => $currentPlan === null ? null : $this->assignmentData($currentPlan),
                    'included_products' => $currentPlan === null ? [] : $currentPlan->planVersion?->products
                        ->map(fn ($mapping) => $this->productVersionData($mapping->productVersion))
                        ->filter()
                        ->values()
                        ->all(),
                    'active_addons' => $active
                        ->filter(fn (TenantCommercialAssignment $assignment) => $assignment->source_type === TenantCommercialAssignment::SOURCE_ADDON)
                        ->map(fn (TenantCommercialAssignment $assignment) => $this->assignmentData($assignment))
                        ->values()
                        ->all(),
                    'trials' => $active
                        ->filter(fn (TenantCommercialAssignment $assignment) => $assignment->source_type === TenantCommercialAssignment::SOURCE_TRIAL)
                        ->map(fn (TenantCommercialAssignment $assignment) => $this->assignmentData($assignment))
                        ->values()
                        ->all(),
                    'legacy_entitlements' => TenantApplicationEntitlement::query()
                        ->where('tenant_id', $tenant->id)
                        ->where('source_type', EntitlementSourceType::LEGACY_GRANDFATHER->value)
                        ->where(fn ($query) => $query->whereNull('revoked_at')->orWhere('revoked_at', '>', $at))
                        ->where('starts_at', '<=', $at)
                        ->where(fn ($query) => $query->whereNull('ends_at')->orWhere('ends_at', '>', $at))
                        ->orderBy('capability_key')
                        ->get(['capability_key', 'access_mode', 'starts_at', 'ends_at'])
                        ->map(fn (TenantApplicationEntitlement $grant) => [
                            'capability_key' => $grant->capability_key,
                            'access_mode' => $grant->access_mode,
                            'starts_at' => $grant->starts_at?->toIso8601String(),
                            'ends_at' => $grant->ends_at?->toIso8601String(),
                        ])
                        ->all(),
                    'ended_assignments' => $assignments
                        ->filter(fn (TenantCommercialAssignment $assignment) => ! $this->isCurrent($assignment, $at))
                        ->map(fn (TenantCommercialAssignment $assignment) => $this->assignmentData($assignment))
                        ->values()
                        ->all(),
                ],
            ];
        });
    }

    /** @param array<string, mixed> $override @return array<string, mixed> */
    private function overrideFields(array $override): array
    {
        return [
            'access' => $override['access'] ?? ApplicationCatalog::ACCESS_OPERATIONAL,
            'commercial_mode' => $override['commercial_mode'] ?? 'denied',
            'override_grant_id' => $override['override_grant_id'] ?? null,
            'operational_status' => $override['operational_status'] ?? 'disabled',
            'can_grant' => $override['can_grant'] ?? false,
            'can_revert' => $override['can_revert'] ?? false,
            'can_show' => $override['can_show'] ?? false,
            'can_hide' => $override['can_hide'] ?? false,
            'skip_reasons' => $override['skip_reasons'] ?? [
                'grant' => [],
                'revert' => [],
                'show' => [],
                'hide' => [],
            ],
        ];
    }

    /** @param array<string, mixed> $application @return array<string, mixed> */
    private function applicationData(string $key, array $application): array
    {
        return [
            'key' => $key,
            'group' => $application['group'],
            'maturity' => $application['maturity'],
            'mandatory' => $application['mandatory'],
            'dependencies' => $application['dependencies'],
            'enabled' => $application['enabled'],
            'status' => $application['status'],
            'changed_at' => $application['changed_at'],
            'reason' => $application['reason'],
            'commercial' => $application['commercial'],
            'effective_access' => $application['effective_access'],
            'dependency_status' => $application['dependency_status'],
        ];
    }

    /** @return array<string, mixed> */
    private function assignmentData(TenantCommercialAssignment $assignment): array
    {
        return [
            'id' => $assignment->id,
            'source_type' => $assignment->source_type,
            'status' => $assignment->status,
            'lifecycle_state' => $assignment->lifecycle_state,
            'starts_at' => $assignment->starts_at?->toIso8601String(),
            'ends_at' => $assignment->ends_at?->toIso8601String(),
            'scheduled_cancellation_at' => $assignment->scheduled_cancellation_at?->toIso8601String(),
            'ended_at' => $assignment->ended_at?->toIso8601String(),
            'reason' => $assignment->reason,
            'plan_version' => $assignment->planVersion === null ? null : [
                'id' => $assignment->planVersion->id,
                'plan_code' => $assignment->planVersion->plan_code,
                'version' => $assignment->planVersion->version,
            ],
            'product_version' => $this->productVersionData($assignment->productVersion),
        ];
    }

    /** @return array<string, mixed>|null */
    private function productVersionData(?object $version): ?array
    {
        if ($version === null) {
            return null;
        }

        return [
            'id' => $version->id,
            'version' => $version->version,
            'product_code' => $version->product?->code,
            'product_name' => $version->product?->name,
        ];
    }

    private function isCurrent(TenantCommercialAssignment $assignment, CarbonImmutable $at): bool
    {
        return $assignment->status === TenantCommercialAssignment::STATUS_ACTIVE
            && $assignment->starts_at !== null
            && $assignment->starts_at->lessThanOrEqualTo($at)
            && ($assignment->ends_at === null || $assignment->ends_at->greaterThan($at));
    }

    private function withTenantContext(Tenant $tenant, Closure $callback): mixed
    {
        $context = app(TenantContext::class);
        $previous = $context->id();
        $context->set($tenant->id);

        try {
            return $callback();
        } finally {
            if ($previous === null) {
                $context->forget();
            } else {
                $context->set($previous);
            }
        }
    }
}
