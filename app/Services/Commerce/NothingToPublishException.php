<?php

namespace App\Services\Commerce;

use RuntimeException;

/** STORE-BACKEND-1 — نشر بلا صف أو بـ `draft_revision = 0`. */
final class NothingToPublishException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('لا توجد مسودة محفوظة للنشر.');
    }
}
