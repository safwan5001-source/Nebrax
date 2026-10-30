<?php

namespace App\Services\Commerce;

use RuntimeException;

/** H6 Batch E — a refused membership transition. `$reason` is a stable machine code; `$status` the HTTP status. */
class WholesaleMembershipException extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message, public readonly int $status = 409)
    {
        parent::__construct($message);
    }
}
