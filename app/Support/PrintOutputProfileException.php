<?php

namespace App\Support;

use RuntimeException;

/**
 * رفض Output Profile غير صالح. يرث RuntimeException عمداً: كل رفض عقد قوالب
 * يصل إلى العميل 422 برسالة عربية عبر المسار القائم، و`reason` رمز ثابت مشترك مع
 * الواجهة (`contracts/print-templates/output-profile.v1.json`) لا يُترجم.
 */
class PrintOutputProfileException extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
