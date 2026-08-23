<?php

namespace App\Services;

use App\Models\Tenant;
use App\Support\ApplicationAccessLevel;
use App\Support\ApplicationAccessResult;
use App\Support\ApplicationAccessReason;
use App\Support\ApplicationOperationClass;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * يفرض القرار المركب فقط على cohort نشر موثوق. خارج الكوهورت لا يفعل شيئاً
 * حتى تبقى الحراسة القديمة هي السلطة كاملةً.
 */
final class EntitlementCohortEnforcer
{
    public function __construct(
        private EntitlementRolloutPolicy $rollout,
        private ApplicationAccessDecision $decisions,
        private TenantContext $tenantContext,
        private EntitlementObservabilityService $observability,
    ) {}

    public function enforce(Request $request, string $capabilityKey, ApplicationOperationClass $operation): void
    {
        if (! $this->rollout->isAuthoritativeForCurrentTenant()) {
            return;
        }

        $startedAt = hrtime(true);
        try {
            $tenantId = $this->tenantContext->id();
            if ($tenantId === null) {
                throw new \RuntimeException('Trusted tenant context is unavailable.');
            }

            $tenant = Tenant::query()->findOrFail($tenantId);
            $decision = $this->decisions->decide($tenant, $capabilityKey, $operation, null, CarbonImmutable::now('UTC'));
        } catch (Throwable $exception) {
            $latency = (int) ((hrtime(true) - $startedAt) / 1_000_000);
            $this->logFailure($request, $capabilityKey, $operation, 'evaluation_failure', null, null);
            $this->observability->record('ENTITLEMENT_ACCESS_DENIED', $this->tenantContext->id() ?? 'unknown', $capabilityKey, null, 'denied', 'evaluation_failure', $operation, $latency, $request);
            abort(403, 'هذه القدرة غير متاحة لهذه المؤسسة.');
        }

        if ($decision->level === ApplicationAccessLevel::ALLOWED
            || ($decision->level === ApplicationAccessLevel::READ_ONLY && $operation->permitsReadOnlyAccess())) {
            return;
        }

        $latency = (int) ((hrtime(true) - $startedAt) / 1_000_000);
        $this->logFailure($request, $capabilityKey, $operation, 'denied', $decision, $this->tenantContext->id());
        $event = $decision->reason === ApplicationAccessReason::ENTITLEMENT_READ_ONLY ? 'ENTITLEMENT_READ_ONLY_BLOCK' : 'ENTITLEMENT_ACCESS_DENIED';
        $this->observability->record($event, $this->tenantContext->id() ?? 'unknown', $capabilityKey, null, $decision->level->value, $decision->reason->value, $operation, $latency, $request);
        abort(403, 'هذه القدرة غير متاحة لهذه المؤسسة.');
    }

    private function logFailure(
        Request $request,
        string $capabilityKey,
        ApplicationOperationClass $operation,
        string $event,
        ?ApplicationAccessResult $decision,
        ?string $tenantId,
    ): void {
        Log::warning('ENTITLEMENT_COHORT_ENFORCEMENT', [
            'event' => $event,
            'tenant_id' => $tenantId,
            'user_id' => ($userId = $request->user()?->getAuthIdentifier()) === null ? null : (string) $userId,
            'capability_key' => $capabilityKey,
            'route_name' => $request->route()?->getName(),
            'operation_class' => $operation->value,
            'decision' => $decision?->level->value,
            'reason' => $decision?->reason->value,
            'correlation_id' => ($correlationId = $request->headers->get('X-Request-ID') ?? $request->attributes->get('request_id')) === null ? null : (string) $correlationId,
            'evaluated_at' => CarbonImmutable::now('UTC')->toIso8601String(),
        ]);
    }
}
