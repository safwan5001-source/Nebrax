<?php

namespace App\Support;

use Exception;
use Illuminate\Http\JsonResponse;

/**
 * رفض عمل صريح في إدارة أسعار الوقود برمز `reason` ثابت وسياق للواجهة (تعارض، اقتراح غير متاح…).
 *
 * لا يرث RuntimeException عمداً: `ApiController::domain()` يحوّل كل RuntimeException إلى 422 برسالة فقط،
 * أما هذا فيُنتج جسماً `{message, reason, ...context}` وحالة محدّدة عبر render().
 */
class FuelPriceException extends Exception
{
    /** @param array<string,mixed> $context */
    public function __construct(
        public readonly string $reason,
        string $message,
        public readonly int $status = 422,
        public readonly array $context = [],
    ) {
        parent::__construct($message);
    }

    public function render(): JsonResponse
    {
        return response()->json(['message' => $this->getMessage(), 'reason' => $this->reason] + $this->context, $this->status);
    }
}
