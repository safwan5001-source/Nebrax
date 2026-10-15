<?php

namespace App\Support\Communications;

use RuntimeException;

/**
 * AWJ-COMMS-02-B — الرسالة القائمة بالمفتاح لا يمكن التحقق من تطابق محتواها (صف قديم بلا بصمة).
 * الرسائل ثابتة النص عمداً: لا عنوان ولا متغيرات ولا مفاتيح ولا بصمات في أي استثناء.
 */
class IdempotencyUnverifiableException extends RuntimeException
{
}
