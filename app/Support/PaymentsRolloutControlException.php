<?php

namespace App\Support;

use RuntimeException;

/**
 * رفض تغيير ضابط تفعيل المدفوعات أو قراءته بمدخلات غير صالحة — PAY-H1-02.
 *
 * الرسالة ثابتة بلا قيم (لا معرّفات ولا أسباب مُدخلة)، و`reason` رمز قصير ثابت للاختبار والتشخيص.
 */
final class PaymentsRolloutControlException extends RuntimeException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct("تعذر تنفيذ عملية ضابط تفعيل المدفوعات ({$reason}).");
    }
}
