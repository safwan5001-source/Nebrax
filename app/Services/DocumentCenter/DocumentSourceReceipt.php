<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentFile;

final readonly class DocumentSourceReceipt
{
    public function __construct(
        public DocumentBatch $batch,
        public DocumentFile $file,
        public string $auditReference,
        public bool $idempotentReplay,
    ) {}
}
