<?php

namespace App\Support;

use Exception;
use Illuminate\Http\JsonResponse;

/**
 * رفض إجراء مراجعة كشف طرف (IMP-PS-A3a) برمز ثابت `reason` وحالة HTTP صريحة (409 للحالة/القِدَم/التعارض، 422 للمدخل). يرث `Exception` لا `RuntimeException`
 * عمداً: `ApiController::domain()` يحوّل الأخيرة إلى 422 عامّ، والمطلوب هنا جسم `{message, reason}` وحالة مضبوطة تُنتجها `render()`.
 * الرسالة بلا قيم حساسة (معرّفات ومفاتيح وحدات فقط في `details`).
 */
final class PartnerStatementReviewException extends Exception
{
    /** @param array<string, mixed> $details */
    public function __construct(public readonly string $reason, string $message, public readonly int $status = 422, public readonly array $details = [])
    {
        parent::__construct($message);
    }

    public function render(): JsonResponse
    {
        return response()->json(['message' => $this->getMessage(), 'reason' => $this->reason] + ($this->details !== [] ? ['details' => $this->details] : []), $this->status);
    }
}
