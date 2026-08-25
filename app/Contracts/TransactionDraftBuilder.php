<?php

namespace App\Contracts;

use App\Models\DocumentBatch;

interface TransactionDraftBuilder
{
    /** يبني مسودة من دليل مراجع ضمن سياق موثوق ويعيد مرجع المعاملة العام. */
    public function build(DocumentBatch $batch, DraftBuildContext $context): CreatedDraftReference;
}
