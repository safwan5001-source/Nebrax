<?php

namespace App\Support\Payments;

use App\Models\PaymentGateway;

/** مدخلات إنشاء صفحة الدفع. `attemptId` هو مفتاح idempotency الثابت عند المزوّد. */
final class AttemptContext
{
    public function __construct(
        public readonly PaymentGateway $gateway,
        public readonly string $attemptId,
        public readonly int $amountMinor,
        public readonly string $currency,
        public readonly string $payableKey,
    ) {}
}
