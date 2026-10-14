<?php

namespace App\Support\Communications;

use InvalidArgumentException;

/**
 * ADR-COMMS-01 §6 — نتيجة محاولة إرسال واحدة. `safeMessage` نصٌّ تشخيصي قصير منظَّف (بلا محارف تحكّم، مقصوص):
 * المزوّد مسؤول عن ألا يضع فيه رمزاً أو سراً، والمعالج لا يسجّل غيره. الفشل مصنَّف (`DispatchOutcome`)
 * لا نصّ حرّ، فيقرر المسار إعادة المحاولة أو التبديل من التصنيف وحده.
 */
final readonly class DispatchResult
{
    public const MAX_MESSAGE = 200;

    private function __construct(
        public DispatchOutcome $outcome,
        public ?string $providerMessageId = null,
        public ?string $errorCode = null,
        public ?string $safeMessage = null,
    ) {
        if ($errorCode !== null && preg_match('/^[a-z0-9_.-]{1,64}\z/', $errorCode) !== 1) {
            throw new InvalidArgumentException('Error code must be a short machine-readable token.');
        }
    }

    public static function accepted(?string $providerMessageId = null): self
    {
        return new self(DispatchOutcome::Accepted, $providerMessageId);
    }

    public static function retryableFailure(string $errorCode, ?string $safeMessage = null): self
    {
        return new self(DispatchOutcome::RetryableFailure, null, $errorCode, self::sanitize($safeMessage));
    }

    public static function permanentFailure(string $errorCode, ?string $safeMessage = null): self
    {
        return new self(DispatchOutcome::PermanentFailure, null, $errorCode, self::sanitize($safeMessage));
    }

    public static function unsupported(string $reason = 'unsupported_channel_or_classification'): self
    {
        return new self(DispatchOutcome::Unsupported, null, $reason, null);
    }

    /** مهلة بعد إرسال الطلب: الرسالة قد تكون خرجت. تُسوّى بإيصال لا بإعادة إرسال. */
    public static function unknown(string $errorCode = 'timeout', ?string $safeMessage = null): self
    {
        return new self(DispatchOutcome::Unknown, null, $errorCode, self::sanitize($safeMessage));
    }

    public function isAccepted(): bool
    {
        return $this->outcome === DispatchOutcome::Accepted;
    }

    public function deliveryStatus(): DeliveryStatus
    {
        return $this->outcome->deliveryStatus();
    }

    private static function sanitize(?string $message): ?string
    {
        if ($message === null) {
            return null;
        }

        $clean = trim((string) preg_replace('/[\x00-\x1f\x7f]+/', ' ', $message));

        return $clean === '' ? null : mb_substr($clean, 0, self::MAX_MESSAGE);
    }
}
