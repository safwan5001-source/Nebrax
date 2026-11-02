<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * COPS-H2-1 — رفض عمل لانتقال تنفيذ طلب متجر (خطة H2-0 §2): رمز `reason` ثابت تقرؤه الواجهة ورمز HTTP مقترن به
 * (409 للحالات، 422 للمدخل/غير المؤكَّد، 428 لغياب `expected_version`). `extra` يحمل `current_version`/`current_status` عند تعارض النسخة.
 */
final class CommerceOrderFulfillmentException extends RuntimeException
{
    public const NOT_CONFIRMED = 'not_confirmed';

    public const ALREADY_CANCELLED = 'already_cancelled';

    public const AWAITING_ACCEPTANCE = 'awaiting_acceptance';

    public const PAYMENT_PENDING = 'payment_pending';

    public const PAYMENT_NOT_READY = 'payment_not_ready';

    public const PAYMENT_CANCELLED = 'payment_cancelled';

    public const POLICY_MISSING = 'fulfillment_policy_missing';

    public const INVALID_TRANSITION = 'invalid_transition';

    public const VERSION_CONFLICT = 'fulfillment_version_conflict';

    public const VERSION_REQUIRED = 'expected_version_required';

    public const INVALID_INPUT = 'invalid_input';

    public const NOT_STARTED = 'fulfillment_not_started';

    public const TERMINAL = 'fulfillment_completed';

    /** @param array<string, mixed> $extra */
    public function __construct(public readonly string $reason, string $message, public readonly int $status = 409, public readonly array $extra = [])
    {
        parent::__construct($message);
    }
}
