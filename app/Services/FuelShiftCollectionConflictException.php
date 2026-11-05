<?php

namespace App\Services;

use Exception;

/**
 * تعارض إقرار تحصيل الوردية → 409 من المتحكّم (لا 422 عام). لا يرث RuntimeException عمداً كي لا يحوّله `ApiController::domain()` إلى 422.
 * الرموز: `idempotency_conflict` (مفتاح مستخدم لحمولة/وردية أخرى) · `stale_revision` (نسخة الأساس لا تطابق الحالية).
 */
class FuelShiftCollectionConflictException extends Exception
{
    public function __construct(public readonly string $reason, string $message, public readonly int $currentRevision)
    {
        parent::__construct($message);
    }
}
