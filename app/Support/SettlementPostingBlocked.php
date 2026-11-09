<?php

namespace App\Support;

use RuntimeException;

/**
 * سبب حجب متوقع لترحيل تسوية (فترة مقفلة، حالة تغيّرت، شرط نشر ناقص…): تُرمى داخل معاملة الترحيل فتُرجَع كاملةً ثم يلتقطها المستدعي نتيجةَ «محجوب» لا خطأً تقنياً.
 * لا تحمل قيماً مالية، رموزاً ثابتة فقط.
 */
final class SettlementPostingBlocked extends RuntimeException
{
    /** @param list<string> $reasons */
    public function __construct(public readonly array $reasons)
    {
        parent::__construct('SETTLEMENT_POSTING_BLOCKED: '.implode(',', $reasons));
    }
}
