<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * رفض عمل لإلغاء طلب متجر (ADR-28 §3): رمز `reason` ثابت تقرؤه الواجهة، ورمز HTTP مقترن به (409 للحالات، 422 لمدخل/حالة غير قابلة).
 */
final class CommerceOrderCancellationException extends RuntimeException
{
    public const NOT_CONFIRMED = 'not_confirmed';

    public const ALREADY_POSTED = 'already_posted';

    public const PAYMENT_PAID = 'payment_paid';

    public const PAYMENT_COLLECTED = 'payment_collected';

    public const PAYMENT_CAPTURED = 'payment_captured';

    public const PAYMENT_AUTHORIZED = 'payment_authorized';

    /** رمز للمعاينة الاسترشادية فقط (`cancelAction`)؛ الإلغاء المتكرر الفعلي idempotent ولا يرمي به. */
    public const ALREADY_CANCELLED = 'already_cancelled';

    /** COPS-H1-4 (رفض التاجر): الطلب ليس بانتظار قبول يدوي (لقطة تلقائية) ⇒ لا رفض؛ يُلغى بمسار الإلغاء العادي. */
    public const NOT_MANUAL = 'not_manual';

    /** COPS-H1-4 (رفض التاجر): قُبل الطلب ⇒ لا رفض بعد القبول؛ يُلغى بمسار الإلغاء العادي بأسبابه. */
    public const ALREADY_ACCEPTED = 'already_accepted';

    public const INVALID_REASON = 'invalid_reason';

    public const NOTE_REQUIRED = 'note_required';

    public function __construct(public readonly string $reason, string $message, public readonly int $status = 409)
    {
        parent::__construct($message);
    }
}
