<?php

namespace App\Support\Communications;

use RuntimeException;

/**
 * AWJ-COMMS-02-B — نيّة لا تطابق المستأجر الموثوق من السياق.
 * الرسائل ثابتة النص عمداً: لا عنوان ولا متغيرات ولا مفاتيح ولا بصمات في أي استثناء.
 */
class TenantMismatchException extends RuntimeException
{
}
