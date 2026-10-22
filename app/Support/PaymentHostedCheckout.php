<?php

namespace App\Support;

use Carbon\CarbonImmutable;

/** نتيجة إنشاء صفحة دفع مستضافة لدى المزوّد. */
final class PaymentHostedCheckout
{
    public function __construct(
        public readonly string $providerPaymentId,
        public readonly string $checkoutUrl,
        public readonly ?CarbonImmutable $expiresAt = null,
    ) {}
}
