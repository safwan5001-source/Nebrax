<?php

namespace App\Services;

use App\Models\Tenant;
use App\Support\ApplicationAccessResult;
use App\Support\ApplicationOperationClass;
use App\Support\EntitlementShadowEvent;
use App\Support\EntitlementShadowMismatch;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

/** Observes entitlement decisions and can never influence the legacy response. */
class EntitlementShadowEvaluator
{
    public function __construct(
        private ApplicationAccessDecision $decisions,
        private TenantContext $tenantContext,
    ) {}

    public function observe(Request $request, string $capabilityKey, ApplicationOperationClass $operation, ApplicationAccessResult $legacy): void
    {
        if (config('entitlements.mode', 'off') !== 'shadow') return;

        $evaluatedAt = CarbonImmutable::now('UTC');
        $startedAt = hrtime(true);

        try {
            $tenantId = $this->tenantContext->id();
            if ($tenantId === null) throw new \RuntimeException('Trusted tenant context is unavailable.');
            $tenant = Tenant::query()->findOrFail($tenantId);
            $new = $this->decisions->decide($tenant, $capabilityKey, $operation, null, $evaluatedAt);
            $mismatch = EntitlementShadowMismatch::between($legacy->level, $new->level);
            if ($mismatch === null) return;

            $userId = $request->user()?->getAuthIdentifier();
            $correlationId = $request->headers->get('X-Request-ID') ?? $request->attributes->get('request_id');
            $event = new EntitlementShadowEvent(
                $mismatch->value,
                $tenantId,
                $userId === null ? null : (string) $userId,
                $capabilityKey,
                $request->route()?->getName(),
                $operation,
                $request->getMethod(),
                $legacy,
                $new,
                $correlationId === null ? null : (string) $correlationId,
                $evaluatedAt,
                round((hrtime(true) - $startedAt) / 1_000_000, 3),
            );
            Log::warning('ENTITLEMENT_SHADOW_MISMATCH', $event->toContext());
        } catch (Throwable $exception) {
            Log::error('SHADOW_EVALUATION_ERROR', [
                'tenant_id' => $this->tenantContext->id(),
                'capability_key' => $capabilityKey,
                'operation_class' => $operation->value,
                'exception' => $exception::class,
            ]);
        }
    }
}
