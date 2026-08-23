<?php

namespace App\Services;

use App\Support\ApplicationOperationClass;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

final class EntitlementObservabilityService
{
    public function record(
        string $event,
        string $tenantId,
        string $capabilityKey,
        ?string $sourceType,
        ?string $accessMode,
        string $reason,
        ?ApplicationOperationClass $operation = null,
        ?int $evaluationLatencyMs = null,
        ?Request $request = null,
    ): void {
        $correlationId = $request?->headers->get('X-Request-ID') ?? $request?->attributes->get('request_id');

        Log::info($event, [
            'tenant_id' => $tenantId,
            'capability_key' => $capabilityKey,
            'source_type' => $sourceType,
            'access_mode' => $accessMode,
            'reason' => $reason,
            'operation_class' => $operation?->value ?? 'system',
            'evaluation_latency_ms' => $evaluationLatencyMs,
            'correlation_id' => $correlationId === null ? null : (string) $correlationId,
        ]);
    }
}
