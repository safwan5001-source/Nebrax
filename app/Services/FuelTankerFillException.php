<?php

namespace App\Services;

use Exception;
use Illuminate\Http\JsonResponse;

/**
 * TANKER-PR4 — رفض صريح لعملية تعبئة صهريج برمز ثابت (`reason`) وتفاصيل آمنة.
 *
 * لا يرث `RuntimeException` عمداً: `ApiController::domain()` كان سيحوّله إلى 422 عام بلا رمز. يرسم نفسه بجسم
 * `{message, reason, details?}` وحالة 422 (رفض عمل) أو 409 (تعارض: مفتاح idempotency بمحتوى مختلف، أو سند ورقي مكرر) أو 404 (خارج النطاق).
 * التفاصيل بلا PII ولا مبالغ مالية؛ لا تكشف سجلاً خارج نطاق المستخدم.
 */
class FuelTankerFillException extends Exception
{
    public const SHIFT_REQUIRED = 'shift_required';
    public const SHIFT_NOT_OPEN = 'shift_not_open';
    public const NOZZLE_OPERATION_NOT_ALLOWED = 'nozzle_operation_not_allowed';
    public const EQUIPMENT_NOT_OPERATIONAL = 'equipment_not_operational';
    public const PRODUCT_MISMATCH = 'product_mismatch';
    public const OWNER_INACTIVE = 'owner_inactive';
    public const TANKER_REQUIRED = 'tanker_required';
    public const TANKER_MISMATCH = 'tanker_mismatch';
    public const TANKER_INACTIVE = 'tanker_inactive';
    public const VOUCHER_DUPLICATE = 'voucher_duplicate';
    public const VOUCHER_INVALID = 'voucher_invalid';
    public const QUANTITY_INVALID = 'quantity_invalid';
    public const CAPACITY_EXCEEDED = 'capacity_overrun_blocked';
    public const CAPACITY_CONFIRMATION_REQUIRED = 'capacity_overrun_confirmation_required';
    public const IDEMPOTENCY_CONFLICT = 'idempotency_key_reused';
    public const INVALID_INPUT = 'invalid_input';
    public const NOT_FOUND = 'not_found';
    public const FORBIDDEN = 'forbidden';

    /** @param array<string,mixed> $details */
    public function __construct(
        public readonly string $reason,
        string $message,
        public readonly int $status = 422,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }

    public function render(): JsonResponse
    {
        $body = ['message' => $this->getMessage(), 'reason' => $this->reason];
        if ($this->details !== []) {
            $body['details'] = $this->details;
        }

        return response()->json($body, $this->status);
    }
}
