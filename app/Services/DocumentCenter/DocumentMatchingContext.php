<?php

namespace App\Services\DocumentCenter;

final readonly class DocumentMatchingContext
{
    public function __construct(
        public string $tenantId,
        public string $branchId,
        public string $documentType,
    ) {
    }
}
