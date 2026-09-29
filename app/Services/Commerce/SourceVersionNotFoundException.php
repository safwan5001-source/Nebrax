<?php

namespace App\Services\Commerce;

use RuntimeException;

/** CUST-H1-1 — `source_version_id` أجنبي أو مفقود عند إنشاء/تكرار نسخة. */
final class SourceVersionNotFoundException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('النسخة المصدر غير موجودة.');
    }
}
