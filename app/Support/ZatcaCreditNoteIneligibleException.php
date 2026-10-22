<?php

namespace App\Support;

use RuntimeException;

/**
 * إشعار دائن مبيعات لمستأجر مفعَّل لا يصلح للإصدار الإلكتروني (381) — REM-18b-3c. فشل مغلق صريح: ترحيل الإشعار يتراجع كاملاً
 * (لا قيد ولا مدخل سلسلة ولا حالة posted) بدل ترحيله صامتاً بلا قرار. `reason` رمز ثابت للاختبار والتشخيص، والرسالة بلا قيم.
 * (`ApiController::domain()` يحوّل RuntimeException إلى 422 برسالته.)
 */
final class ZatcaCreditNoteIneligibleException extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
