<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use InvalidArgumentException;

/**
 * لقطة موحّدة لحالة دفعة لدى المزوّد، مطبَّعة إلى حالات المحاولة والهللات. المحوّل وحده يعرف صيغة المزوّد.
 * `status` أحد ثوابت `PaymentAttempt::STATUS_*` (لا `created`).
 */
final class PaymentProviderSnapshot
{
    public function __construct(
        public readonly string $providerPaymentId,
        public readonly string $status,
        public readonly int $amountMinor,
        public readonly string $currency,
        public readonly int $capturedMinor = 0,
        public readonly ?CarbonImmutable $capturedAt = null,
        public readonly ?string $failureCode = null,
        /** المبلغ المسترد التراكمي لدى المزوّد (هللات)؛ 0 ما لم يُسترد شيء. أساس مطابقة الاسترداد (PAY-H3-01a، إضافي). */
        public readonly int $refundedMinor = 0,
    ) {
        if ($providerPaymentId === '' || $amountMinor < 0 || $capturedMinor < 0 || $refundedMinor < 0 || strlen($currency) !== 3) {
            throw new InvalidArgumentException('Invalid provider payment snapshot.');
        }
    }
}
