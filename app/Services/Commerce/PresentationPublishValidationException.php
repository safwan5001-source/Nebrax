<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * CUST-HV V3 — وثيقة المظهر المطبَّعة لا تصلح للنشر (نشر فوري أو مجدول).
 * تحمل **مساراً لكل خطأ** (`announcements.items[2].window.endsAt`) برمزٍ ثابت
 * تترجمه الواجهة، فيعرف التاجر أي عنصرٍ يصلحه — لا رسالة عامة واحدة.
 * المسودة لا تُرفض أبداً بهذه القواعد؛ هي بوابة نشر فقط (V0 AMEND-7).
 */
final class PresentationPublishValidationException extends RuntimeException
{
    /** @param array<string, array{code: string, message: string}> $errors path ⇒ خطأ */
    public function __construct(public readonly array $errors)
    {
        parent::__construct('تعذّر نشر التصميم: توجد عناصر تحتاج إلى تصحيح قبل النشر.');
    }

    /** @return array{message: string, code: string, errors: array<string, list<string>>, error_codes: array<string, string>} */
    public function toPayload(): array
    {
        return [
            'message' => $this->getMessage(),
            'code' => 'publish_validation_failed',
            'errors' => array_map(static fn (array $e): array => [$e['message']], $this->errors),
            'error_codes' => array_map(static fn (array $e): string => $e['code'], $this->errors),
        ];
    }
}
