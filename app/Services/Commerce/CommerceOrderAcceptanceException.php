<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * COPS-H1-4 — رفض عمل لقبول طلب متجر يدوياً (ADR-29 §2.2): رمز `reason` ثابت تقرؤه الواجهة ورمز HTTP مقترن به (409 للحالات، 422 لغير المؤكَّد).
 * الرفض (`merchant_rejected`) يرمي {@see CommerceOrderCancellationException} لأنه مسار الإلغاء نفسه، ويستعمل بعض الرموز أدناه لحالاته الخاصة.
 */
final class CommerceOrderAcceptanceException extends RuntimeException
{
    public const NOT_CONFIRMED = 'not_confirmed';

    public const ALREADY_CANCELLED = 'already_cancelled';

    /** الطلب ليس بانتظار قبول يدوي (لقطته تلقائية، أو البوابة مغلقة فوضعه الفعّال تلقائي). */
    public const NOT_MANUAL = 'not_manual';

    /** رمز للمعاينة الاسترشادية (`acceptAction`)؛ القبول المتكرر الفعلي idempotent ولا يرمي به. */
    public const ALREADY_ACCEPTED = 'already_accepted';

    /** R-5: نية إلكترونية غير مدفوعة بعد ⇒ لا قبول ولا طابور ولا تنبيه. */
    public const PAYMENT_PENDING = 'payment_pending';

    /** لا نية دفع جاهزة (لا نية، أو نية ملغاة) ⇒ لا قبول. */
    public const PAYMENT_NOT_READY = 'payment_not_ready';

    public function __construct(public readonly string $reason, string $message, public readonly int $status = 409)
    {
        parent::__construct($message);
    }
}
