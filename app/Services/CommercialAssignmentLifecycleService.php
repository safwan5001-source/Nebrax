<?php

namespace App\Services;

use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\TenantCommercialAssignment;
use App\Models\TenantCommercialAssignmentEvent;
use App\Support\EntitlementAccessMode;
use App\Support\TenantApplicationEntitlementDecision;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CommercialAssignmentLifecycleService
{
    private const FULL_GRACE_DAYS = 7;
    private const READ_ONLY_GRACE_DAYS = 30;

    public function __construct(
        private CommercialEntitlementMaterializationService $materialization,
        private EntitlementGrantService $grants,
    ) {}

    public function accessForGrant(Tenant $tenant, ?string $grantGroupId, DateTimeInterface $evaluationTime): ?TenantApplicationEntitlementDecision
    {
        if ($grantGroupId === null) return null;

        $assignment = TenantCommercialAssignment::query()
            ->where('id', $grantGroupId)
            ->where('tenant_id', $tenant->id)
            ->first();
        if ($assignment === null) return null;

        $at = CarbonImmutable::instance($evaluationTime)->utc();
        if ($assignment->status !== TenantCommercialAssignment::STATUS_ACTIVE || $this->shouldEnd($assignment, $at)) {
            return TenantApplicationEntitlementDecision::DENIED;
        }
        if ($assignment->payment_failed_at === null) {
            return TenantApplicationEntitlementDecision::FULL;
        }

        $days = CarbonImmutable::instance($assignment->payment_failed_at)->utc()->diffInDays($at);
        if ($days > self::READ_ONLY_GRACE_DAYS) return TenantApplicationEntitlementDecision::DENIED;
        if ($days > self::FULL_GRACE_DAYS) return TenantApplicationEntitlementDecision::READ_ONLY;

        return TenantApplicationEntitlementDecision::FULL;
    }

    public function recordPaymentFailure(TenantCommercialAssignment $assignment, ?PlatformAdministrator $administrator, DateTimeInterface $failedAt, ?string $reason = null): TenantCommercialAssignment
    {
        if ($assignment->status !== TenantCommercialAssignment::STATUS_ACTIVE) {
            throw ValidationException::withMessages(['assignment' => 'Only active commercial assignments may enter payment grace.']);
        }

        $at = CarbonImmutable::instance($failedAt)->utc();
        return $this->withTenantContext($assignment, function () use ($assignment, $administrator, $at, $reason): TenantCommercialAssignment {
            return DB::transaction(function () use ($assignment, $administrator, $at, $reason): TenantCommercialAssignment {
                if ($assignment->payment_failed_at !== null) return $assignment;

                $assignment->forceFill([
                    'payment_failed_at' => $at,
                    'lifecycle_state' => TenantCommercialAssignment::LIFECYCLE_GRACE_FULL,
                ])->save();
                $this->event($assignment, $administrator, TenantCommercialAssignmentEvent::ACTION_PAYMENT_FAILED, $at, $reason);
                $this->event($assignment, $administrator, TenantCommercialAssignmentEvent::ACTION_GRACE_FULL_STARTED, $at, $reason);

                return $assignment->refresh();
            });
        });
    }

    public function scheduleCancellation(TenantCommercialAssignment $assignment, ?PlatformAdministrator $administrator, DateTimeInterface $effectiveAt, ?string $reason = null): TenantCommercialAssignment
    {
        if ($assignment->status !== TenantCommercialAssignment::STATUS_ACTIVE) {
            throw ValidationException::withMessages(['assignment' => 'Only active commercial assignments may be scheduled for cancellation.']);
        }
        $at = CarbonImmutable::instance($effectiveAt)->utc();
        if ($at->lessThanOrEqualTo(CarbonImmutable::instance($assignment->starts_at)->utc())) {
            throw ValidationException::withMessages(['effective_at' => 'Cancellation must be scheduled after the assignment start.']);
        }

        return $this->withTenantContext($assignment, function () use ($assignment, $administrator, $at, $reason): TenantCommercialAssignment {
            return DB::transaction(function () use ($assignment, $administrator, $at, $reason): TenantCommercialAssignment {
                if ($assignment->scheduled_cancellation_at !== null && $assignment->scheduled_cancellation_at->equalTo($at)) return $assignment;

                $assignment->forceFill([
                    'scheduled_cancellation_at' => $at,
                    'lifecycle_state' => TenantCommercialAssignment::LIFECYCLE_SCHEDULED_CANCELLATION,
                ])->save();
                $this->event($assignment, $administrator, TenantCommercialAssignmentEvent::ACTION_CANCELLATION_SCHEDULED, $at, $reason);

                return $assignment->refresh();
            });
        });
    }

    public function reconcile(TenantCommercialAssignment $assignment, ?PlatformAdministrator $administrator, DateTimeInterface $evaluationTime, ?string $reason = null): TenantCommercialAssignment
    {
        $at = CarbonImmutable::instance($evaluationTime)->utc();
        if ($assignment->status !== TenantCommercialAssignment::STATUS_ACTIVE) return $assignment;

        return $this->withTenantContext($assignment, function () use ($assignment, $administrator, $at, $reason): TenantCommercialAssignment {
            return DB::transaction(function () use ($assignment, $administrator, $at, $reason): TenantCommercialAssignment {
                $assignment = $assignment->refresh();
                if ($assignment->status !== TenantCommercialAssignment::STATUS_ACTIVE) return $assignment;

                if ($this->shouldEnd($assignment, $at)) {
                    return $this->end($assignment, $administrator, $at, $reason);
                }

                if ($assignment->payment_failed_at === null) return $assignment;
                $failedAt = CarbonImmutable::instance($assignment->payment_failed_at)->utc();
                $days = $failedAt->diffInDays($at);
                if ($days > self::READ_ONLY_GRACE_DAYS) {
                    return $this->end($assignment, $administrator, $at, $reason ?? 'Commercial grace period ended.');
                }
                if ($days > self::FULL_GRACE_DAYS && $assignment->lifecycle_state !== TenantCommercialAssignment::LIFECYCLE_GRACE_READ_ONLY) {
                    return $this->degradeToReadOnly($assignment, $administrator, $at, $reason);
                }

                return $assignment;
            });
        });
    }

    private function shouldEnd(TenantCommercialAssignment $assignment, CarbonImmutable $at): bool
    {
        return ($assignment->scheduled_cancellation_at !== null && CarbonImmutable::instance($assignment->scheduled_cancellation_at)->lessThanOrEqualTo($at))
            || ($assignment->ends_at !== null && CarbonImmutable::instance($assignment->ends_at)->lessThanOrEqualTo($at));
    }

    private function degradeToReadOnly(TenantCommercialAssignment $assignment, ?PlatformAdministrator $administrator, CarbonImmutable $at, ?string $reason): TenantCommercialAssignment
    {
        $this->grants->revokeGrantGroupAccess($assignment->tenant, $assignment->id, EntitlementAccessMode::FULL, $administrator?->id, $at);
        if ($assignment->source_type === TenantCommercialAssignment::SOURCE_PLAN) {
            $this->materialization->materializePlan(
                $assignment->tenant, $assignment->planVersion, $at, $assignment->ends_at, $assignment->id,
                $administrator?->id, ['commercial_assignment_id' => $assignment->id, 'lifecycle_state' => TenantCommercialAssignment::LIFECYCLE_GRACE_READ_ONLY],
                true, EntitlementAccessMode::READ_ONLY,
            );
        } else {
            $this->materialization->materializeAddon(
                $assignment->tenant, $assignment->productVersion, $at, $assignment->ends_at, $assignment->id,
                $administrator?->id, ['commercial_assignment_id' => $assignment->id, 'lifecycle_state' => TenantCommercialAssignment::LIFECYCLE_GRACE_READ_ONLY],
                true, EntitlementAccessMode::READ_ONLY,
            );
        }
        $assignment->forceFill(['lifecycle_state' => TenantCommercialAssignment::LIFECYCLE_GRACE_READ_ONLY])->save();
        $this->event($assignment, $administrator, TenantCommercialAssignmentEvent::ACTION_GRACE_READ_ONLY_STARTED, $at, $reason);

        return $assignment->refresh();
    }

    private function end(TenantCommercialAssignment $assignment, ?PlatformAdministrator $administrator, CarbonImmutable $at, ?string $reason): TenantCommercialAssignment
    {
        $this->grants->revokeGrantGroup($assignment->tenant, $assignment->id, $administrator?->id, $at);
        $assignment->forceFill([
            'status' => 'ended',
            'lifecycle_state' => TenantCommercialAssignment::LIFECYCLE_ENDED_DENIED,
            'ended_at' => $at,
        ])->save();
        $this->event($assignment, $administrator, TenantCommercialAssignmentEvent::ACTION_EXPIRED, $at, $reason);

        return $assignment->refresh();
    }

    private function event(TenantCommercialAssignment $assignment, ?PlatformAdministrator $administrator, string $action, CarbonImmutable $at, ?string $reason): void
    {
        TenantCommercialAssignmentEvent::create([
            'tenant_commercial_assignment_id' => $assignment->id,
            'tenant_id' => $assignment->tenant_id,
            'platform_administrator_id' => $administrator?->id,
            'action' => $action,
            'effective_at' => $at,
            'reason' => trim((string) $reason) ?: null,
            'metadata' => ['lifecycle_state' => $assignment->lifecycle_state],
        ]);
    }

    private function withTenantContext(TenantCommercialAssignment $assignment, \Closure $callback): mixed
    {
        $context = app(TenantContext::class);
        $previous = $context->id();
        $context->set($assignment->tenant_id);
        try {
            return $callback();
        } finally {
            if ($previous === null) $context->forget(); else $context->set($previous);
        }
    }
}
