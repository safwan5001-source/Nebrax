<?php

namespace App\Contracts;

use App\Models\DocumentExtractionResult;
use App\Services\DocumentCenter\DocumentMatchingContext;
use App\Services\DocumentCenter\DocumentMatchReport;

interface DocumentMatcher
{
    public function match(DocumentExtractionResult $result, DocumentMatchingContext $context): DocumentMatchReport;
}
