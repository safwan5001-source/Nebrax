<?php

namespace App\Services;

use RuntimeException;

/** AI-ACTIONS-05: a known, safe-to-show reason a single import row could not be applied. */
final class AiActionRowFailure extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message, public readonly bool $retryable = false)
    {
        parent::__construct($message);
    }
}
