<?php

namespace App\Contracts;

use App\Models\DocumentBatch;

interface TransactionDraftBuilder
{
    /** @return array{link_id:string,purchase_id:string,purchase_number:string,status:string,idempotent_replay:bool} */
    public function build(DocumentBatch $batch, int $expectedVersion, string $reason, ?string $warehouseId, ?string $costCenterId, ?string $actorId): array;
}
