<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * CUST-H1-1 — رفض عملية دورة حياة على نسخة عرض بسبب حالتها الحالية:
 * نشِطة/مجدولة/نسخة العمل المتوافقة أثناء نافذة التوافق القديمة.
 */
final class VersionLifecycleConflictException extends RuntimeException
{
    public function __construct(string $message)
    {
        parent::__construct($message);
    }
}
