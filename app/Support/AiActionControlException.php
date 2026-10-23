<?php

namespace App\Support;

use RuntimeException;

/**
 * رفض تغيير ضابط إجراءات المساعد أو قراءته بمدخلات غير صالحة — IMP-X-01a. الرسالة ثابتة بلا قيم، و`reason` رمز قصير ثابت.
 */
final class AiActionControlException extends RuntimeException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct("تعذر تنفيذ عملية ضابط إجراءات المساعد ({$reason}).");
    }
}
