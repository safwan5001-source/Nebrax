<?php

namespace App\Events;

use App\Models\CommerceOrderEvent;

/** تحصيل دفع الاستلام/COD (`payment.collected`) (COPS-H1-2) — يُطلق بعد الالتزام، معرّفات فقط. */
final class CommerceOrderPaymentCollected extends CommerceOrderDomainEvent
{
    public static function recordType(): string
    {
        return CommerceOrderEvent::PAYMENT_COLLECTED;
    }
}
