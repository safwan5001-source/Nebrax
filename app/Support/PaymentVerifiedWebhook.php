<?php

namespace App\Support;

/** حدث تحقّق المحوّل من توقيعه. لا يحمل حالة دفع للتطبيق: معرّف الحدث ونوعه ومرجع الدفعة فقط (الحقيقة من `fetchPayment`). */
final class PaymentVerifiedWebhook
{
    public function __construct(
        public readonly string $eventId,
        public readonly ?string $eventType,
        public readonly ?string $providerPaymentId,
    ) {}
}
