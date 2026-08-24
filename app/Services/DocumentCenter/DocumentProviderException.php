<?php

namespace App\Services\DocumentCenter;

use RuntimeException;

final class DocumentProviderException extends RuntimeException
{
    public function __construct(
        public readonly string $safeCode,
        public readonly string $safeMessage,
        public readonly bool $retryable = true,
    ) {
        parent::__construct($safeMessage);
    }
}
