<?php

namespace App\Services;

use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Support\ApplicationCatalog;
use App\Support\ApplicationOperationClass;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use DateTimeInterface;

class CommercialAccessInspectorService
{
    public function __construct(
        private ApplicationAccessDecision $access,
        private TenantApplicationService $applications,
        private CommercialAssignmentLifecycleService $lifecycle,
    ) {}

    /** @return array<string,mixed> */
    public function inspect(Tenant $tenant, string $capabilityKey, ApplicationOperationClass $operation, ?DateTimeInterface $evaluationTime = null): array
    {
        $at = CarbonImmutable::instance($evaluationTime ?? now('UTC'))->utc();
        return $this->withTenantContext($tenant, function () use ($tenant, $capabilityKey, $operation, $at): array {
            $catalog = ApplicationCatalog::find($capabilityKey);
            $grants = TenantApplicationEntitlement::query()
                ->where('tenant_id', $tenant->id)
                ->where('capability_key', $capabilityKey)
                ->where('starts_at', '<=', $at)
                ->where(fn ($query) => $query->whereNull('ends_at')->orWhere('ends_at', '>', $at))
                ->where(fn ($query) => $query->whereNull('revoked_at')->orWhere('revoked_at', '>', $at))
                ->orderBy('source_type')
                ->get();
            $decision = $this->access->decide($tenant, $capabilityKey, $operation, null, $at);

            return [
                'tenant_id' => $tenant->id,
                'capability_key' => $capabilityKey,
                'operation_class' => $operation->value,
                'evaluated_at' => $at->toIso8601String(),
                'catalog' => $catalog,
                'effective_access' => ['level' => $decision->level->value, 'reason' => $decision->reason->value],
                'commercial_sources' => $grants->map(fn (TenantApplicationEntitlement $grant) => [
                    'source_type' => $grant->source_type,
                    'access_mode' => $grant->access_mode,
                    'source_reference_type' => $grant->source_reference_type,
                    'source_reference_id' => $grant->source_reference_id,
                    'grant_group_id' => $grant->grant_group_id,
                    'lifecycle_access' => $this->lifecycle->accessForGrant($tenant, $grant->grant_group_id, $at)?->value,
                    'starts_at' => $grant->starts_at?->toIso8601String(),
                    'ends_at' => $grant->ends_at?->toIso8601String(),
                ])->all(),
                'tenant_application_state' => ['status' => $this->applications->statusFor($capabilityKey)],
                'dependencies' => collect($catalog['dependencies'] ?? [])->map(fn (string $key) => [
                    'capability_key' => $key,
                    'effective_access' => $this->access->decide($tenant, $key, ApplicationOperationClass::READ, null, $at)->level->value,
                ])->all(),
                'rbac' => ['evaluated' => false, 'reason' => 'No principal was supplied; RBAC is not inferred by this inspector.'],
            ];
        });
    }

    private function withTenantContext(Tenant $tenant, \Closure $callback): mixed
    {
        $context = app(TenantContext::class);
        $previous = $context->id();
        $context->set($tenant->id);
        try { return $callback(); } finally { if ($previous === null) $context->forget(); else $context->set($previous); }
    }
}
