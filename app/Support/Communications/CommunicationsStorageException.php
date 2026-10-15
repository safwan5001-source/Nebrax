<?php

namespace App\Support\Communications;

use RuntimeException;

/**
 * AWJ-COMMS-02-B — فشل تخزين غير متوقع (ليس تعارض تفرّد) — رسالة ثابتة بلا قيم.
 * الرسائل ثابتة النص عمداً: لا عنوان ولا متغيرات ولا مفاتيح ولا بصمات في أي استثناء.
 */
class CommunicationsStorageException extends RuntimeException
{
}
