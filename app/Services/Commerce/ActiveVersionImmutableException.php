<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * CUST-H1-1 — النسخة المنشورة (active_version_id) للقراءة فقط في هذا الأفق.
 * التعديل يتطلّب إنشاء/تكرار نسخة مسودة مستقلة.
 */
final class ActiveVersionImmutableException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('النسخة المنشورة للقراءة فقط. أنشئ نسخة مسودة للتعديل.');
    }
}
