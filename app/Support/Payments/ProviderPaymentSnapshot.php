<?php

namespace App\Support\Payments;

use Carbon\CarbonImmutable;
use InvalidArgumentException;

/**
 * لقطة موحّدة لحالة دفعة لدى المزوّد، مطبَّعة إلى حالات المحاولة والهللات. المحوّل وحده يعرف صيغة المزوّد.
 * `status` أحد ثوابت `PaymentAttempt::STATUS_*` (لا `created`).
 */
final class ProviderPaymentSnapshot
{
    public function __construct(
        public readonly string $providerPaymentId,
        public readonly string $status,
        public readonly int $amountMinor,
        public readonly string $currency,
        public readonly int $capturedMinor = 0,
        public readonly ?CarbonImmutable $capturedAt = null,
        public readonly ?string $failureCode = null,
    ) {
        if ($providerPaymentId === '' || $amountMinor < 0 || $capturedMinor < 0 || strlen($currency) !== 3) {
            throw new InvalidArgumentException('Invalid provider payment snapshot.');
        }
    }
}
