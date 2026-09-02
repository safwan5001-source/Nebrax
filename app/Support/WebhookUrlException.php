<?php

namespace App\Support;

use RuntimeException;

/**
 * رفض عنوان Webhook لأسباب أمنية (SSRF/سياسة). يحمل رمزًا ثابتًا (`reason`) مع
 * رسالة عربية — تلتقطه طبقة التحقّق (422) وتستعمله خدمة التسليم لتصنيف الفشل.
 */
class WebhookUrlException extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
