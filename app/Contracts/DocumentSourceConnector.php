<?php

namespace App\Contracts;

use App\Services\DocumentCenter\DocumentSourceEnvelope;
use App\Services\DocumentCenter\DocumentSourceReceipt;
use App\Support\DocumentSourceChannel;

interface DocumentSourceConnector
{
    public function channel(): DocumentSourceChannel;

    public function receive(DocumentSourceEnvelope $envelope): DocumentSourceReceipt;
}
