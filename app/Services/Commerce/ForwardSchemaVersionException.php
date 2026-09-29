<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * CUST-H1-1 — مخطط أحدث من الإصدار المدعوم حالياً (`StorefrontPresentationNormalizer::VERSION`).
 *
 * يُرفض فشلاً آمناً (fail-closed) قبل أي تطبيع أو حفظ — لا يُستبدل المستند
 * بافتراضي «AWJ Modern» أبداً على مسارات النسخ (خلافاً لسلوك المطبّع القديم
 * على الرأس المتوافق). يحمي عمليات الطرح المتدرّج/التراجع.
 */
final class ForwardSchemaVersionException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('إصدار المستند أحدث مما يدعمه الخادم الحالي.');
    }
}
