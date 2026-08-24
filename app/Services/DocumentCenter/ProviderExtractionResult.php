<?php

namespace App\Services\DocumentCenter;

final class ProviderExtractionResult
{
    /** @param array<string, mixed> $payload */
    public function __construct(
        public readonly array $payload,
        public readonly ?int $inputTokens,
        public readonly ?int $outputTokens,
    ) {
    }
}
