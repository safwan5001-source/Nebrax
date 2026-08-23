<?php

namespace App\Contracts;

use App\Support\DocumentScanStatus;

interface DocumentSafetyScanner
{
    /** @param resource $stream */
    public function scan($stream): DocumentScanStatus;

    public function ping(): bool;

    public function providerName(): string;
}
