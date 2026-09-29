<?php

namespace App\Services\Commerce;

use RuntimeException;

/** CUST-H1-1 — `revision` الوارد لا يطابق نسخة العرض المقفولة. */
final class StaleVersionRevisionException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('النسخة تغيّرت. أعد التحميل ثم احفظ من جديد.');
    }
}
