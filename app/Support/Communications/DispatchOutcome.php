<?php

namespace App\Support\Communications;

/**
 * ADR-COMMS-01 — ما يعيده المزوّد من محاولة إرسال واحدة. `Unknown` حالة مهلة بعد إرسال الطلب:
 * قد تكون الرسالة خرجت فعلاً، فلا يُبدَّل المزود ولا تُعاد المحاولة قبل التسوية.
 */
enum DispatchOutcome: string
{
    case Accepted = 'accepted';
    case RetryableFailure = 'retryable_failure';
    case PermanentFailure = 'permanent_failure';
    case Unsupported = 'unsupported';
    case Unknown = 'unknown';

    public function deliveryStatus(): DeliveryStatus
    {
        return match ($this) {
            self::Accepted => DeliveryStatus::Accepted,
            self::RetryableFailure => DeliveryStatus::FailedRetryable,
            self::PermanentFailure, self::Unsupported => DeliveryStatus::FailedPermanent,
            self::Unknown => DeliveryStatus::Unknown,
        };
    }

    /** التبديل إلى مزوّد احتياطي آمن فقط عند فشل قابل لإعادة المحاولة أو عدم دعم المزوّد للطلب، وقبل أي قبول. */
    public function permitsFallback(): bool
    {
        return $this === self::RetryableFailure || $this === self::Unsupported;
    }
}
