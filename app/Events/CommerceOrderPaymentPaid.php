<?php

namespace App\Events;

use App\Models\CommerceOrderEvent;

/** التقاط دفع إلكتروني مثبَّت (`payment.paid`) (COPS-H1-2) — يُطلق بعد الالتزام، معرّفات فقط. */
final class CommerceOrderPaymentPaid extends CommerceOrderDomainEvent
{
    public static function recordType(): string
    {
        return CommerceOrderEvent::PAYMENT_PAID;
    }
}
