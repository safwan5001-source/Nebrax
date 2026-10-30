<?php

namespace App\Services\Commerce;

use RuntimeException;

/** H6 Batch F — a refused channel-settings change, with a stable machine `reason` and the HTTP status to answer with. */
final class SalesChannelSettingsException extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}
