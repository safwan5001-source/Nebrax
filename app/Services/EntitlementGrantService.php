<?php

namespace App\Services;

use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Support\ApplicationCatalog;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Validation\ValidationException;

class EntitlementGrantService
{
    public function grant(
        Tenant $tenant,
        string $capabilityKey,
        EntitlementAccessMode $accessMode,
        EntitlementSourceType $sourceType,
        DateTimeInterface $startsAt,
        ?DateTimeInterface $endsAt = null,
        ?string $sourceReferenceType = null,
        ?string $sourceReferenceId = null,
        ?string $grantGroupId = null,
        ?string $grantReasonCode = null,
        ?string $reason = null,
        ?string $grantedByPlatformAdministratorId = null,
        array $metadata = [],
    ): TenantApplicationEntitlement {
        $context = app(TenantContext::class);
        if ($context->has() && $context->id() !== $tenant->getKey()) {
            throw ValidationException::withMessages(['tenant' => 'The trusted tenant does not match the active tenant context.']);
        }
        if (! ApplicationCatalog::isActivatable($capabilityKey)) {
            throw ValidationException::withMessages(['capability_key' => 'The capability must exist and be built.']);
        }

        $start = CarbonImmutable::instance($startsAt)->utc();
        $end = $endsAt === null ? null : CarbonImmutable::instance($endsAt)->utc();
        if ($end !== null && $end->lessThanOrEqualTo($start)) {
            throw ValidationException::withMessages(['ends_at' => 'The grant interval must have a positive duration.']);
        }
        if (($sourceReferenceType === null) !== ($sourceReferenceId === null)) {
            throw ValidationException::withMessages(['source_reference' => 'Source reference type and id must be supplied together.']);
        }

        $identity = [
            $tenant->getKey(), $capabilityKey, $accessMode->value, $sourceType->value,
            $sourceReferenceType, $sourceReferenceId, $grantGroupId,
            $start->format('Y-m-d\TH:i:s.u\Z'), $end?->format('Y-m-d\TH:i:s.u\Z'), $grantReasonCode,
        ];
        $idempotencyKey = hash('sha256', json_encode($identity, JSON_THROW_ON_ERROR));

        $grant = TenantApplicationEntitlement::query()->firstOrCreate(
            ['tenant_id' => $tenant->getKey(), 'idempotency_key' => $idempotencyKey],
            [
                'capability_key' => $capabilityKey, 'access_mode' => $accessMode->value,
                'source_type' => $sourceType->value, 'source_reference_type' => $sourceReferenceType,
                'source_reference_id' => $sourceReferenceId, 'grant_group_id' => $grantGroupId,
                'starts_at' => $start, 'ends_at' => $end, 'grant_reason_code' => $grantReasonCode,
                'reason' => $reason, 'granted_by_platform_administrator_id' => $grantedByPlatformAdministratorId,
                'metadata' => $metadata,
            ],
        );
        if (in_array($sourceType, [EntitlementSourceType::PLAN, EntitlementSourceType::ADDON, EntitlementSourceType::TRIAL], true)) {
            app(EntitlementObservabilityService::class)->record(
                'COMMERCIAL_ASSIGNMENT_APPLIED',
                $tenant->getKey(),
                $capabilityKey,
                $sourceType->value,
                $accessMode->value,
                $grant->wasRecentlyCreated ? 'assignment_applied' : 'idempotent_replay',
            );
        }

        return $grant;
    }

    public function revokeGrantGroup(
        Tenant $tenant,
        string $grantGroupId,
        ?string $revokedByPlatformAdministratorId = null,
        ?DateTimeInterface $revokedAt = null,
    ): int {
        $context = app(TenantContext::class);
        if ($context->has() && $context->id() !== $tenant->getKey()) {
            throw ValidationException::withMessages(['tenant' => 'The trusted tenant does not match the active tenant context.']);
        }

        $grants = TenantApplicationEntitlement::query()
            ->where('tenant_id', $tenant->getKey())
            ->where('grant_group_id', $grantGroupId)
            ->whereNull('revoked_at')
            ->get(['capability_key', 'source_type', 'access_mode']);
        $revoked = TenantApplicationEntitlement::query()
            ->where('tenant_id', $tenant->getKey())
            ->where('grant_group_id', $grantGroupId)
            ->whereNull('revoked_at')
            ->update([
                'revoked_at' => CarbonImmutable::instance($revokedAt ?? now())->utc(),
                'revoked_by_platform_administrator_id' => $revokedByPlatformAdministratorId,
            ]);
        foreach ($grants as $grant) {
            app(EntitlementObservabilityService::class)->record('COMMERCIAL_ASSIGNMENT_REVOKED', $tenant->getKey(), $grant->capability_key, $grant->source_type, $grant->access_mode, 'grant_group_revoked');
        }

        return $revoked;
    }

    public function revokeGrantGroupAccess(
        Tenant $tenant,
        string $grantGroupId,
        EntitlementAccessMode $accessMode,
        ?string $revokedByPlatformAdministratorId = null,
        ?DateTimeInterface $revokedAt = null,
    ): int {
        $context = app(TenantContext::class);
        if ($context->has() && $context->id() !== $tenant->getKey()) {
            throw ValidationException::withMessages(['tenant' => 'The trusted tenant does not match the active tenant context.']);
        }

        $grants = TenantApplicationEntitlement::query()
            ->where('tenant_id', $tenant->getKey())
            ->where('grant_group_id', $grantGroupId)
            ->where('access_mode', $accessMode->value)
            ->whereNull('revoked_at')
            ->get(['capability_key', 'source_type', 'access_mode']);
        $revoked = TenantApplicationEntitlement::query()
            ->where('tenant_id', $tenant->getKey())
            ->where('grant_group_id', $grantGroupId)
            ->where('access_mode', $accessMode->value)
            ->whereNull('revoked_at')
            ->update([
                'revoked_at' => CarbonImmutable::instance($revokedAt ?? now())->utc(),
                'revoked_by_platform_administrator_id' => $revokedByPlatformAdministratorId,
            ]);
        foreach ($grants as $grant) {
            app(EntitlementObservabilityService::class)->record('COMMERCIAL_ASSIGNMENT_REVOKED', $tenant->getKey(), $grant->capability_key, $grant->source_type, $grant->access_mode, 'access_mode_revoked');
        }

        return $revoked;
    }

    public function revokeSource(
        Tenant $tenant,
        EntitlementSourceType $sourceType,
        string $sourceReferenceType,
        string $sourceReferenceId,
        ?string $revokedByPlatformAdministratorId = null,
        ?DateTimeInterface $revokedAt = null,
    ): int {
        $context = app(TenantContext::class);
        if ($context->has() && $context->id() !== $tenant->getKey()) {
            throw ValidationException::withMessages(['tenant' => 'The trusted tenant does not match the active tenant context.']);
        }

        $grants = TenantApplicationEntitlement::query()
            ->where('tenant_id', $tenant->getKey())
            ->where('source_type', $sourceType->value)
            ->where('source_reference_type', $sourceReferenceType)
            ->where('source_reference_id', $sourceReferenceId)
            ->whereNull('revoked_at')
            ->get(['capability_key', 'source_type', 'access_mode']);
        $revoked = TenantApplicationEntitlement::query()
            ->where('tenant_id', $tenant->getKey())
            ->where('source_type', $sourceType->value)
            ->where('source_reference_type', $sourceReferenceType)
            ->where('source_reference_id', $sourceReferenceId)
            ->whereNull('revoked_at')
            ->update([
                'revoked_at' => CarbonImmutable::instance($revokedAt ?? now())->utc(),
                'revoked_by_platform_administrator_id' => $revokedByPlatformAdministratorId,
            ]);
        foreach ($grants as $grant) {
            app(EntitlementObservabilityService::class)->record('COMMERCIAL_ASSIGNMENT_REVOKED', $tenant->getKey(), $grant->capability_key, $grant->source_type, $grant->access_mode, 'source_revoked');
        }

        return $revoked;
    }
}
