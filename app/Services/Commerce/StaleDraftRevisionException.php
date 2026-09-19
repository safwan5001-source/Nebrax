<?php

namespace App\Services\Commerce;

use RuntimeException;

/** STORE-BACKEND-1 — `draft_revision` الوارد لا يطابق الصف المقفول. */
final class StaleDraftRevisionException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('المسودة تغيّرت. أعد التحميل ثم احفظ من جديد.');
    }
}
