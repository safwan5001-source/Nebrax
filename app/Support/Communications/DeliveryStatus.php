<?php

namespace App\Support\Communications;

/**
 * ADR-COMMS-01 §6 — حالات الرسالة. الانتقال أحادي الاتجاه: إيصالٌ متأخر لا يُرجع `read` إلى `delivered`،
 * و`unknown` (مهلة شبكة بعد الإرسال) تُسوّى بإيصال أو فشل، لا بإعادة إرسال عمياء.
 *
 * الدورة الوحيدة المقصودة هي حلقة إعادة المحاولة `sending → failed_retryable → retry_scheduled → sending`؛
 * يحدّها عدد المحاولات الأقصى في الـoutbox (شريحة لاحقة) لا هذا الجدول. ما بعد القبول لا يعود إلى `sending`.
 */
enum DeliveryStatus: string
{
    case Queued = 'queued';
    case Sending = 'sending';
    case Accepted = 'accepted';
    case Delivered = 'delivered';
    case Read = 'read';
    case FailedRetryable = 'failed_retryable';
    case RetryScheduled = 'retry_scheduled';
    case FailedPermanent = 'failed_permanent';
    case Undeliverable = 'undeliverable';
    case Expired = 'expired';
    case BlockedPolicy = 'blocked_policy';
    case Cancelled = 'cancelled';
    case Unknown = 'unknown';

    public function isTerminal(): bool
    {
        return $this->allowedNext() === [];
    }

    public function canTransitionTo(self $next): bool
    {
        return in_array($next, $this->allowedNext(), true);
    }

    /** @return list<self> */
    private function allowedNext(): array
    {
        return match ($this) {
            self::Queued => [self::Sending, self::BlockedPolicy, self::Cancelled, self::Expired],
            self::Sending => [self::Accepted, self::FailedRetryable, self::FailedPermanent, self::Unknown],
            self::FailedRetryable => [self::RetryScheduled, self::FailedPermanent, self::Expired],
            self::RetryScheduled => [self::Sending, self::Cancelled, self::Expired],
            self::Unknown => [self::Accepted, self::Delivered, self::Read, self::FailedPermanent, self::Undeliverable, self::Expired],
            self::Accepted => [self::Delivered, self::Read, self::FailedPermanent, self::Undeliverable, self::Expired],
            self::Delivered => [self::Read],
            self::Read,
            self::FailedPermanent,
            self::Undeliverable,
            self::Expired,
            self::BlockedPolicy,
            self::Cancelled => [],
        };
    }
}
