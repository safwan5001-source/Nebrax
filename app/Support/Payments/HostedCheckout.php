<?php

namespace App\Support\Payments;

use Carbon\CarbonImmutable;

/** نتيجة إنشاء صفحة دفع مستضافة لدى المزوّد. */
final class HostedCheckout
{
    public function __construct(
        public readonly string $providerPaymentId,
        public readonly string $checkoutUrl,
        public readonly ?CarbonImmutable $expiresAt = null,
    ) {}
}
