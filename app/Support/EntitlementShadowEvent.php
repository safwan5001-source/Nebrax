<?php

namespace App\Support;

use Carbon\CarbonImmutable;

final readonly class EntitlementShadowEvent
{
    public function __construct(
        public string $mismatch,
        public string $tenantId,
        public ?string $userId,
        public string $capabilityKey,
        public ?string $routeName,
        public ApplicationOperationClass $operation,
        public string $httpMethod,
        public ApplicationAccessResult $old,
        public ApplicationAccessResult $new,
        public ?string $correlationId,
        public CarbonImmutable $evaluatedAt,
        public float $evaluationLatencyMs,
    ) {}

    /** @return array<string, string|float|null> */
    public function toContext(): array
    {
        return [
            'mismatch' => $this->mismatch,
            'tenant_id' => $this->tenantId,
            'user_id' => $this->userId,
            'capability_key' => $this->capabilityKey,
            'route_name' => $this->routeName,
            'operation_class' => $this->operation->value,
            'http_method' => $this->httpMethod,
            'old_decision' => $this->old->level->value,
            'new_decision' => $this->new->level->value,
            'old_reason' => $this->old->reason->value,
            'new_reason' => $this->new->reason->value,
            'correlation_id' => $this->correlationId,
            'evaluated_at' => $this->evaluatedAt->toIso8601String(),
            'evaluation_latency_ms' => $this->evaluationLatencyMs,
        ];
    }
}
