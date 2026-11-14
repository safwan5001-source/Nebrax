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

    // TANKER-PR6B-2 — سند مرحَّل مخزنياً لا يُلغى (يُعكس الترحيل أولاً).
    public const FILL_INVENTORY_POSTED = 'fill_inventory_posted';

    // TANKER-PR6B-3 — ترحيل السند مخزنياً ومحاسبياً (معاملة واحدة، مغلق خلف بوابة نشر).
    public const POSTING_DISABLED = 'posting_disabled';
    public const POSTING_BLOCKED = 'posting_blocked';
    public const FILL_VOIDED = 'fill_voided';
    public const FILL_NOT_PENDING = 'fill_not_pending';
    public const HISTORICAL_PERMISSION_REQUIRED = 'historical_permission_required';
    public const HISTORICAL_REVIEW_REQUIRED = 'historical_review_required';
    public const QUANTITY_EXCEEDS_STOCK_LIMIT = 'quantity_exceeds_stock_limit';
    public const INSUFFICIENT_STOCK = 'insufficient_stock';
    public const POSTED_COST_ZERO = 'posted_cost_zero';
    public const LEDGER_VARIANCE_BLOCKED = 'ledger_variance_blocked';
    public const DISTINCT_APPROVER_REQUIRED = 'distinct_approver_required';
    public const PERIOD_LOCKED = 'period_locked';
    public const POSTING_FAILED = 'posting_failed';

    // TANKER-PR5 — مرفقات السند.
    public const ATTACHMENT_INVALID = 'attachment_invalid';
    public const ATTACHMENT_TYPE_NOT_ALLOWED = 'attachment_type_not_allowed';
    public const ATTACHMENT_TOO_LARGE = 'attachment_too_large';
    public const ATTACHMENT_LIMIT_REACHED = 'attachment_limit_reached';
    public const ATTACHMENT_ADD_BLOCKED = 'attachment_add_blocked';
    public const ATTACHMENT_REMOVAL_BLOCKED = 'attachment_removal_blocked';
    public const ATTACHMENT_NOT_ACTIVE = 'attachment_not_active';
    public const ATTACHMENT_SAME_CONTENT = 'attachment_same_content';
    public const ATTACHMENT_DUPLICATE = 'attachment_duplicate';
    public const ATTACHMENT_STORAGE_FAILED = 'attachment_storage_failed';
    public const ATTACHMENT_CONFLICT = 'attachment_conflict';

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
