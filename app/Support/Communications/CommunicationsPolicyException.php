<?php

namespace App\Support\Communications;

use RuntimeException;

/**
 * AWJ-COMMS-02-B — نيّة مرفوضة بسياسة (تصنيف غير مفعَّل، مفتاح يحمل بيانات المستلم، ...).
 * الرسائل ثابتة النص عمداً: لا عنوان ولا متغيرات ولا مفاتيح ولا بصمات في أي استثناء.
 */
class CommunicationsPolicyException extends RuntimeException
{
}
