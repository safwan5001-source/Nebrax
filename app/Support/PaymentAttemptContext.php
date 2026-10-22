<?php

namespace App\Support;

use App\Models\PaymentGateway;

/** مدخلات إنشاء صفحة الدفع. `attemptId` هو مفتاح idempotency الثابت عند المزوّد. */
final class PaymentAttemptContext
{
    public function __construct(
        public readonly PaymentGateway $gateway,
        public readonly string $attemptId,
        public readonly int $amountMinor,
        public readonly string $currency,
        public readonly string $payableKey,
    ) {}
}
