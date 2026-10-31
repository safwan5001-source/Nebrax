<?php

namespace App\Services\Commerce;

use RuntimeException;

/** H6 Batch M — a staff partner-link refusal with a stable machine `reason` (HTTP status carried alongside). */
class WholesalePartnerLinkAdminException extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}
