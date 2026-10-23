<?php

namespace App\Support;

use RuntimeException;

/** خطأ أجهزة دفع POS برمز ثابت (`reason`) تترجمه الواجهة؛ الرسالة عربية بلا قيم سرية. */
final class PosTerminalException extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
