<?php

namespace App\Support\Communications;

use RuntimeException;

/**
 * AWJ-COMMS-02-B — نفس مفتاح منع التكرار بمحتوى مختلف (قناة/تصنيف/مستلم/قالب/مصدر/متغيرات).
 * الرسائل ثابتة النص عمداً: لا عنوان ولا متغيرات ولا مفاتيح ولا بصمات في أي استثناء.
 */
class IdempotencyConflictException extends RuntimeException
{
}
