<?php

namespace App\Services\Commerce;

/**
 * STORE-ADMIN-ADOPT-1B-3A — نتيجة استدعاء `StorefrontDomainVerificationService::verify()`
 * الوحيدة. ثلاث حالات حصراً (القرار §23):
 *  - `success()`: سجلّ TXT المتوقَّع بالضبط موجود — النطاق التزم بإثبات الملكية.
 *  - `mismatch()`: الاستعلام نجح تشغيلياً لكن لا سجلّ مطابق (غائب/خاطئ/غير
 *    ذي صلة) — إثبات ملكية غائب، لا فشل تشغيلي.
 *  - `operationalFailure()`: الاستعلام نفسه لم يكتمل (محلّل/شبكة) — **ليس**
 *    إثباتاً على غياب الملكية؛ المستدعي يجب ألا يُسقِط الحالة أبداً بناءً
 *    عليها.
 */
final class DomainVerificationResult
{
    private function __construct(
        public readonly bool $matched,
        public readonly bool $operationalFailure,
    ) {}

    public static function success(): self
    {
        return new self(matched: true, operationalFailure: false);
    }

    public static function mismatch(): self
    {
        return new self(matched: false, operationalFailure: false);
    }

    public static function operationalFailure(): self
    {
        return new self(matched: false, operationalFailure: true);
    }
}
