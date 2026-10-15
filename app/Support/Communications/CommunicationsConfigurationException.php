<?php

namespace App\Support\Communications;

use RuntimeException;

/**
 * AWJ-COMMS-02-B — إعداد أمني مفقود أو غير صالح (مفاتيح HMAC) — فشل مغلق.
 * الرسائل ثابتة النص عمداً: لا عنوان ولا متغيرات ولا مفاتيح ولا بصمات في أي استثناء.
 */
class CommunicationsConfigurationException extends RuntimeException
{
}
