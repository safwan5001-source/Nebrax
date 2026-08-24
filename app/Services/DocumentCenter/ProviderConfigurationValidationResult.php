<?php

namespace App\Services\DocumentCenter;

final class ProviderConfigurationValidationResult
{
    /** @param list<string> $errors */
    public function __construct(
        public readonly bool $valid,
        public readonly array $errors = [],
    ) {
    }

    public static function success(): self
    {
        return new self(true);
    }

    /** @param list<string> $errors */
    public static function failure(array $errors): self
    {
        return new self(false, $errors);
    }
}
