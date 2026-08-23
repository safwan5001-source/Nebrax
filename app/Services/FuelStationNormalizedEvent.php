<?php

namespace App\Services;

use Carbon\CarbonImmutable;

/** حدث موحّد قبل دخوله السجل الدائم؛ لا يحمل قراراً محاسبياً أو تشغيلياً. */
readonly class FuelStationNormalizedEvent
{
    /** @param array<string, mixed> $payload */
    public function __construct(
        public string $eventId,
        public FuelStationEventType $eventType,
        public CarbonImmutable $occurredAt,
        public array $payload,
        public ?int $sequence = null,
        public ?string $correlationId = null,
    ) {
    }
}
