<?php

namespace App\Services\Accounting;

use RuntimeException;

/**
 * رفضُ تعيينٍ ضريبي (`tax_input` / `tax_output`) لحسابٍ غير مؤهَّل — REM-05 / ACC-01.
 * يبقى `RuntimeException` فيمرّ عبر مسار `domain()` الحالي إلى HTTP 422، ويحمل رمزَ سببٍ ثابتاً
 * (`reason`) تضيفه الاستجابة حقلاً إضافياً بجوار `message`.
 */
class VatRoleMappingException extends RuntimeException
{
    public function __construct(string $message, public readonly string $reason)
    {
        parent::__construct($message);
    }
}
