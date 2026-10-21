<?php

namespace App\Support;

use RuntimeException;

/**
 * رفض تغيير ضابط تفعيل ZATCA أو قراءته بمدخلات غير صالحة — REM-18b-3a.
 *
 * الرسالة ثابتة بلا قيم (لا معرّفات ولا أسباب مُدخلة)، و`reason` رمز قصير ثابت للاختبار والتشخيص.
 */
final class ZatcaRolloutControlException extends RuntimeException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct("تعذر تنفيذ عملية ضابط تفعيل ZATCA ({$reason}).");
    }
}
