<?php

namespace App\Services\Commerce;

use RuntimeException;

/** فشل مغلق في Backfill مضيفات الخيار A — يُرجَع بالمعاملة كلها (all-or-nothing). */
final class FlatHostBackfillException extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
