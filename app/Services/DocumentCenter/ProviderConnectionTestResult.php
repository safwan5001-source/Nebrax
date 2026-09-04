<?php

namespace App\Services\DocumentCenter;

final class ProviderConnectionTestResult
{
    public function __construct(
        public readonly bool $ok,
        public readonly string $message,
        public readonly ?string $errorCode = null,
        public readonly ?int $httpStatus = null,
    ) {
    }

    public static function passed(string $message): self
    {
        return new self(true, $message);
    }

    public static function failed(string $message, ?string $errorCode = null, ?int $httpStatus = null): self
    {
        return new self(false, $message, $errorCode, $httpStatus);
    }
}
