<?php

namespace App\Services;

use App\Models\CommercialPlanVersion;
use App\Models\CommercialProductVersion;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\TenantCommercialAssignment;
use App\Models\TenantCommercialAssignmentEvent;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Closure;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CommercialTrialService
{
    public function __construct(private CommercialEntitlementMaterializationService $materialization) {}

    public function startPlanTrial(Tenant $tenant, ?PlatformAdministrator $administrator, CommercialPlanVersion $planVersion, DateTimeInterface $startsAt, int $durationDays, ?string $reason = null): TenantCommercialAssignment
    {
        if ($planVersion->published_at === null || $planVersion->retired_at !== null) {
            throw ValidationException::withMessages(['plan_version' => 'Trials require a published, non-retired plan version.']);
        }

        return $this->start($tenant, $administrator, $planVersion, $startsAt, $durationDays, $reason);
    }

    public function startAddonTrial(Tenant $tenant, ?PlatformAdministrator $administrator, CommercialProductVersion $productVersion, DateTimeInterface $startsAt, int $durationDays, ?string $reason = null): TenantCommercialAssignment
    {
        if ($productVersion->published_at === null || $productVersion->retired_at !== null) {
            throw ValidationException::withMessages(['product_version' => 'Trials require a published, non-retired product version.']);
        }

        return $this->start($tenant, $administrator, $productVersion, $startsAt, $durationDays, $reason);
    }

    /** @param CommercialPlanVersion|CommercialProductVersion $version */
    private function start(Tenant $tenant, ?PlatformAdministrator $administrator, object $version, DateTimeInterface $startsAt, int $durationDays, ?string $reason): TenantCommercialAssignment
    {
        if ($durationDays < 1 || $durationDays > 90) {
            throw ValidationException::withMessages(['duration_days' => 'Trial duration must be between 1 and 90 days.']);
        }
        $start = CarbonImmutable::instance($startsAt)->utc();
        $end = $start->addDays($durationDays);
        $isPlan = $version instanceof CommercialPlanVersion;
        $versionField = $isPlan ? 'commercial_plan_version_id' : 'commercial_product_version_id';

        return $this->withTenantContext($tenant, fn (): TenantCommercialAssignment => DB::transaction(function () use ($tenant, $administrator, $version, $durationDays, $reason, $start, $end, $isPlan, $versionField): TenantCommercialAssignment {
            $existing = TenantCommercialAssignment::query()
                ->where('tenant_id', $tenant->id)
                ->where('source_type', TenantCommercialAssignment::SOURCE_TRIAL)
                ->where($versionField, $version->id)
                ->first();
            if ($existing !== null) {
                throw ValidationException::withMessages(['trial' => 'A trial for this commercial version has already been recorded for this tenant.']);
            }

            $assignment = TenantCommercialAssignment::create([
                'tenant_id' => $tenant->id,
                'source_type' => TenantCommercialAssignment::SOURCE_TRIAL,
                'commercial_plan_version_id' => $isPlan ? $version->id : null,
                'commercial_product_version_id' => $isPlan ? null : $version->id,
                'status' => TenantCommercialAssignment::STATUS_ACTIVE,
                'lifecycle_state' => TenantCommercialAssignment::LIFECYCLE_ACTIVE,
                'starts_at' => $start,
                'ends_at' => $end,
                'assigned_by_platform_administrator_id' => $administrator?->id,
                'reason' => trim((string) $reason) ?: null,
                'metadata' => ['trial_duration_days' => $durationDays, 'commercial_version_id' => $version->id],
                'idempotency_key' => hash('sha256', json_encode([$tenant->id, 'trial', $version->id], JSON_THROW_ON_ERROR)),
            ]);
            if ($isPlan) {
                $this->materialization->materializePlan($tenant, $version, $start, $end, $assignment->id, $administrator?->id, ['commercial_assignment_id' => $assignment->id, 'trial' => true], false, \App\Support\EntitlementAccessMode::FULL, EntitlementSourceType::TRIAL);
            } else {
                $this->materialization->materializeAddon($tenant, $version, $start, $end, $assignment->id, $administrator?->id, ['commercial_assignment_id' => $assignment->id, 'trial' => true], false, \App\Support\EntitlementAccessMode::FULL, EntitlementSourceType::TRIAL);
            }
            TenantCommercialAssignmentEvent::create([
                'tenant_commercial_assignment_id' => $assignment->id,
                'tenant_id' => $tenant->id,
                'platform_administrator_id' => $administrator?->id,
                'action' => TenantCommercialAssignmentEvent::ACTION_TRIAL_STARTED,
                'effective_at' => $start,
                'reason' => trim((string) $reason) ?: null,
                'metadata' => ['duration_days' => $durationDays, 'source_reference_id' => $version->id],
            ]);

            return $assignment->refresh();
        }));
    }

    private function withTenantContext(Tenant $tenant, Closure $callback): mixed
    {
        $context = app(TenantContext::class);
        $previous = $context->id();
        $context->set($tenant->id);
        try {
            return $callback();
        } finally {
            if ($previous === null) $context->forget(); else $context->set($previous);
        }
    }
}
