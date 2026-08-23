<?php

namespace App\Services;

use App\Models\CommercialPlanVersion;
use App\Models\CommercialProductVersion;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantCommercialAssignment;
use App\Models\TenantCommercialAssignmentEvent;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Closure;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;

class CommercialAssignmentService
{
    public function __construct(
        private CommercialEntitlementMaterializationService $materialization,
        private EntitlementGrantService $grants,
    ) {}

    /** @return array<string, mixed> */
    public function previewPlan(Tenant $tenant, CommercialPlanVersion $planVersion, DateTimeInterface $startsAt, ?DateTimeInterface $endsAt = null): array
    {
        return $this->preview($tenant, TenantCommercialAssignment::SOURCE_PLAN, $planVersion, $startsAt, $endsAt);
    }

    /** @return array<string, mixed> */
    public function previewAddon(Tenant $tenant, CommercialProductVersion $productVersion, DateTimeInterface $startsAt, ?DateTimeInterface $endsAt = null): array
    {
        return $this->preview($tenant, TenantCommercialAssignment::SOURCE_ADDON, $productVersion, $startsAt, $endsAt);
    }

    /** @return array<string, mixed> */
    public function previewPlanTrial(Tenant $tenant, CommercialPlanVersion $planVersion, DateTimeInterface $startsAt, int $durationDays): array
    {
        return $this->previewTrial($tenant, $planVersion, $startsAt, $durationDays);
    }

    /** @return array<string, mixed> */
    public function previewAddonTrial(Tenant $tenant, CommercialProductVersion $productVersion, DateTimeInterface $startsAt, int $durationDays): array
    {
        return $this->previewTrial($tenant, $productVersion, $startsAt, $durationDays);
    }

    public function assignPlan(
        Tenant $tenant,
        ?PlatformAdministrator $administrator,
        CommercialPlanVersion $planVersion,
        DateTimeInterface $startsAt,
        ?DateTimeInterface $endsAt = null,
        ?string $reason = null,
    ): TenantCommercialAssignment {
        return $this->assign($tenant, $administrator, TenantCommercialAssignment::SOURCE_PLAN, $planVersion, $startsAt, $endsAt, $reason);
    }

    public function assignAddon(
        Tenant $tenant,
        ?PlatformAdministrator $administrator,
        CommercialProductVersion $productVersion,
        DateTimeInterface $startsAt,
        ?DateTimeInterface $endsAt = null,
        ?string $reason = null,
    ): TenantCommercialAssignment {
        return $this->assign($tenant, $administrator, TenantCommercialAssignment::SOURCE_ADDON, $productVersion, $startsAt, $endsAt, $reason);
    }

    public function cancel(TenantCommercialAssignment $assignment, PlatformAdministrator $administrator, ?string $reason = null): TenantCommercialAssignment
    {
        return $this->end($assignment, $administrator, TenantCommercialAssignment::STATUS_CANCELLED, TenantCommercialAssignmentEvent::ACTION_CANCELLED, $reason);
    }

    public function revoke(TenantCommercialAssignment $assignment, PlatformAdministrator $administrator, ?string $reason = null): TenantCommercialAssignment
    {
        return $this->end($assignment, $administrator, TenantCommercialAssignment::STATUS_REVOKED, TenantCommercialAssignmentEvent::ACTION_REVOKED, $reason);
    }

    /** @param CommercialPlanVersion|CommercialProductVersion $version @return array<string, mixed> */
    private function preview(Tenant $tenant, string $sourceType, object $version, DateTimeInterface $startsAt, ?DateTimeInterface $endsAt): array
    {
        [$start, $end] = $this->interval($startsAt, $endsAt);
        $isPlan = $version instanceof CommercialPlanVersion;
        $definition = $isPlan
            ? $this->materialization->previewPlan($version)
            : $this->materialization->previewAddon($version);
        $source = match ($sourceType) {
            TenantCommercialAssignment::SOURCE_PLAN => EntitlementSourceType::PLAN,
            TenantCommercialAssignment::SOURCE_ADDON => EntitlementSourceType::ADDON,
            TenantCommercialAssignment::SOURCE_TRIAL => EntitlementSourceType::TRIAL,
        };
        $referenceType = $isPlan ? 'commercial-plan-version' : 'commercial-product-version';

        $existingGrants = TenantApplicationEntitlement::query()
            ->where('tenant_id', $tenant->id)
            ->whereIn('capability_key', $definition['capability_keys'])
            ->whereNull('revoked_at')
            ->where('starts_at', '<=', $start)
            ->where(fn ($query) => $query->whereNull('ends_at')->orWhere('ends_at', '>', $start))
            ->get(['capability_key', 'access_mode', 'source_type', 'source_reference_type', 'source_reference_id'])
            ->map(fn (TenantApplicationEntitlement $grant) => [
                'capability_key' => $grant->capability_key,
                'access_mode' => $grant->access_mode,
                'source_type' => $grant->source_type,
                'source_reference_type' => $grant->source_reference_type,
                'source_reference_id' => $grant->source_reference_id,
            ])->all();

        $activeAssignments = TenantCommercialAssignment::query()
            ->where('tenant_id', $tenant->id)
            ->where('source_type', $sourceType)
            ->where('status', TenantCommercialAssignment::STATUS_ACTIVE)
            ->when($isPlan,
                fn ($query) => $query->where('commercial_plan_version_id', $version->id),
                fn ($query) => $query->where('commercial_product_version_id', $version->id),
            )
            ->get(['starts_at', 'ends_at']);
        $idempotentExisting = $activeAssignments->contains(fn (TenantCommercialAssignment $assignment) =>
            $assignment->starts_at->equalTo($start)
            && (($assignment->ends_at === null && $end === null) || ($assignment->ends_at !== null && $end !== null && $assignment->ends_at->equalTo($end)))
        );
        $hasConflictingOverlap = $activeAssignments->contains(function (TenantCommercialAssignment $assignment) use ($start, $end): bool {
            $exact = $assignment->starts_at->equalTo($start)
                && (($assignment->ends_at === null && $end === null) || ($assignment->ends_at !== null && $end !== null && $assignment->ends_at->equalTo($end)));
            if ($exact) return false;

            return $assignment->starts_at->lessThanOrEqualTo($end ?? CarbonImmutable::parse('9999-12-31', 'UTC'))
                && ($assignment->ends_at === null || $assignment->ends_at->greaterThan($start));
        });

        return [
            'tenant_id' => $tenant->id,
            'source_type' => $source->value,
            'source_reference_type' => $referenceType,
            'target_version_id' => $version->id,
            'starts_at' => $start->toIso8601String(),
            'ends_at' => $end?->toIso8601String(),
            'products' => $definition['products'],
            'capabilities' => $definition['capability_keys'],
            'existing_grants' => $existingGrants,
            'grants_to_create' => array_map(fn (string $key) => ['capability_key' => $key, 'access_mode' => 'full'], $definition['capability_keys']),
            'idempotent_existing' => $idempotentExisting,
            'conflicts' => $hasConflictingOverlap ? ['An active assignment for the same commercial version overlaps this interval.'] : [],
            'resulting_effective_access' => array_map(fn (string $key) => ['capability_key' => $key, 'access_mode' => 'full'], $definition['capability_keys']),
        ];
    }

    /** @param CommercialPlanVersion|CommercialProductVersion $version @return array<string, mixed> */
    private function previewTrial(Tenant $tenant, object $version, DateTimeInterface $startsAt, int $durationDays): array
    {
        if ($durationDays < 1 || $durationDays > 90) {
            throw ValidationException::withMessages(['duration_days' => 'Trial duration must be between 1 and 90 days.']);
        }

        $preview = $this->preview($tenant, TenantCommercialAssignment::SOURCE_TRIAL, $version, $startsAt, CarbonImmutable::instance($startsAt)->utc()->addDays($durationDays));
        $isPlan = $version instanceof CommercialPlanVersion;
        $hasRecordedTrial = TenantCommercialAssignment::query()
            ->where('tenant_id', $tenant->id)
            ->where('source_type', TenantCommercialAssignment::SOURCE_TRIAL)
            ->when($isPlan,
                fn ($query) => $query->where('commercial_plan_version_id', $version->id),
                fn ($query) => $query->where('commercial_product_version_id', $version->id),
            )
            ->exists();

        if ($hasRecordedTrial) {
            $preview['conflicts'][] = 'A trial for this commercial version has already been recorded for this tenant.';
        }
        $preview['trial_duration_days'] = $durationDays;

        return $preview;
    }

    /** @param CommercialPlanVersion|CommercialProductVersion $version */
    private function assign(
        Tenant $tenant,
        ?PlatformAdministrator $administrator,
        string $sourceType,
        object $version,
        DateTimeInterface $startsAt,
        ?DateTimeInterface $endsAt,
        ?string $reason,
    ): TenantCommercialAssignment {
        [$start, $end] = $this->interval($startsAt, $endsAt);
        $this->assertVersionForSource($sourceType, $version);
        $identity = hash('sha256', json_encode([
            $tenant->id, $sourceType, $version->id,
            $start->format('Y-m-d\TH:i:s.u\Z'), $end?->format('Y-m-d\TH:i:s.u\Z'),
        ], JSON_THROW_ON_ERROR));

        return $this->withTenantContext($tenant, fn (): TenantCommercialAssignment => DB::transaction(function () use ($tenant, $administrator, $sourceType, $version, $start, $end, $reason, $identity): TenantCommercialAssignment {
            try {
                $assignment = DB::transaction(fn (): TenantCommercialAssignment => TenantCommercialAssignment::query()->firstOrCreate(
                    ['tenant_id' => $tenant->id, 'idempotency_key' => $identity],
                    [
                        'source_type' => $sourceType,
                        'commercial_plan_version_id' => $sourceType === TenantCommercialAssignment::SOURCE_PLAN ? $version->id : null,
                        'commercial_product_version_id' => $sourceType === TenantCommercialAssignment::SOURCE_ADDON ? $version->id : null,
                        'status' => TenantCommercialAssignment::STATUS_ACTIVE,
                        'starts_at' => $start,
                        'ends_at' => $end,
                        'assigned_by_platform_administrator_id' => $administrator?->id,
                        'reason' => $this->normalizedReason($reason),
                        'metadata' => ['commercial_version_id' => $version->id],
                    ],
                ));
            } catch (QueryException $exception) {
                $assignment = TenantCommercialAssignment::query()
                    ->where('tenant_id', $tenant->id)
                    ->where('idempotency_key', $identity)
                    ->first();
                if ($assignment === null) throw $exception;
            }

            if ($assignment->wasRecentlyCreated) {
                $this->recordEvent($assignment, $administrator, TenantCommercialAssignmentEvent::ACTION_ASSIGNED, $start, $reason);
            }

            if ($assignment->status === TenantCommercialAssignment::STATUS_ACTIVE) {
                if ($sourceType === TenantCommercialAssignment::SOURCE_PLAN) {
                    $this->materialization->materializePlan($tenant, $version, $start, $end, $assignment->id, $administrator?->id, ['commercial_assignment_id' => $assignment->id]);
                } else {
                    $this->materialization->materializeAddon($tenant, $version, $start, $end, $assignment->id, $administrator?->id, ['commercial_assignment_id' => $assignment->id]);
                }
            }

            return $assignment->refresh();
        }));
    }

    private function end(
        TenantCommercialAssignment $assignment,
        PlatformAdministrator $administrator,
        string $status,
        string $eventAction,
        ?string $reason,
    ): TenantCommercialAssignment {
        if ($assignment->status !== TenantCommercialAssignment::STATUS_ACTIVE) {
            return $assignment;
        }

        $tenant = $assignment->tenant;

        return $this->withTenantContext($tenant, fn (): TenantCommercialAssignment => DB::transaction(function () use ($assignment, $administrator, $status, $eventAction, $reason): TenantCommercialAssignment {
            $at = now('UTC');
            $updates = ['status' => $status, 'ended_at' => $at];
            if ($status === TenantCommercialAssignment::STATUS_CANCELLED) {
                $updates['lifecycle_state'] = TenantCommercialAssignment::LIFECYCLE_ENDED_DENIED;
                $updates['cancelled_at'] = $at;
                $updates['cancelled_by_platform_administrator_id'] = $administrator->id;
            } else {
                $updates['lifecycle_state'] = TenantCommercialAssignment::LIFECYCLE_REVOKED;
                $updates['revoked_at'] = $at;
                $updates['revoked_by_platform_administrator_id'] = $administrator->id;
            }
            $assignment->forceFill($updates)->save();
            $this->grants->revokeGrantGroup($assignment->tenant, $assignment->id, $administrator->id, $at);
            $this->recordEvent($assignment->refresh(), $administrator, $eventAction, $at, $reason);

            return $assignment->refresh();
        }));
    }

    /** @param CommercialPlanVersion|CommercialProductVersion $version */
    private function assertVersionForSource(string $sourceType, object $version): void
    {
        if ($sourceType === TenantCommercialAssignment::SOURCE_PLAN && ! $version instanceof CommercialPlanVersion) {
            throw ValidationException::withMessages(['source_type' => 'A plan assignment requires a commercial plan version.']);
        }
        if ($sourceType === TenantCommercialAssignment::SOURCE_ADDON && ! $version instanceof CommercialProductVersion) {
            throw ValidationException::withMessages(['source_type' => 'An add-on assignment requires a commercial product version.']);
        }
    }

    /** @return array{CarbonImmutable, ?CarbonImmutable} */
    private function interval(DateTimeInterface $startsAt, ?DateTimeInterface $endsAt): array
    {
        $start = CarbonImmutable::instance($startsAt)->utc();
        $end = $endsAt === null ? null : CarbonImmutable::instance($endsAt)->utc();
        if ($end !== null && $end->lessThanOrEqualTo($start)) {
            throw ValidationException::withMessages(['ends_at' => 'The assignment interval must have a positive duration.']);
        }

        return [$start, $end];
    }

    private function recordEvent(TenantCommercialAssignment $assignment, ?PlatformAdministrator $administrator, string $action, DateTimeInterface $effectiveAt, ?string $reason): void
    {
        TenantCommercialAssignmentEvent::create([
            'tenant_commercial_assignment_id' => $assignment->id,
            'tenant_id' => $assignment->tenant_id,
            'platform_administrator_id' => $administrator?->id,
            'action' => $action,
            'effective_at' => CarbonImmutable::instance($effectiveAt)->utc(),
            'reason' => $this->normalizedReason($reason),
            'metadata' => ['source_type' => $assignment->source_type],
        ]);
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

    private function normalizedReason(?string $reason): ?string
    {
        return trim((string) $reason) ?: null;
    }
}
