<?php

namespace App\Services\AppBuilder;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * تجاوز حدّ كمية صانع التطبيقات (DRF-07 / S02c). يرث `RuntimeException` فتحوّله مسارات المجال إلى 422 عند عدم التقاطه،
 * ويعيد `ApiController::domain()` رميه لتُنتج `render()` الجسم الثابت `{message, reason, resource, limit, current}` — رمز
 * `reason` ثابت تترجمه الواجهة. لا يحمل أي معرّف داخلي أو بيانات مستأجر آخر.
 */
final class PlanLimitExceededException extends RuntimeException
{
    public const REASON = 'plan_limit_reached';

    public function __construct(
        public readonly string $resource,
        public readonly int $limit,
        public readonly int $current,
        string $message,
    ) {
        parent::__construct($message);
    }

    public function render(): JsonResponse
    {
        return response()->json([
            'message' => $this->getMessage(),
            'reason' => self::REASON,
            'resource' => $this->resource,
            'limit' => $this->limit,
            'current' => $this->current,
        ], 422);
    }
}
