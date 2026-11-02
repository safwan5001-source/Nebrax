<?php

namespace App\Events;

use App\Models\CommerceOrderEvent;

/** تنفيذ طلب متجر: تسليم (`fulfillment.delivered`) (COPS-H2-1) — يُطلق بعد الالتزام، معرّفات فقط. */
final class CommerceOrderFulfillmentDelivered extends CommerceOrderDomainEvent
{
    public static function recordType(): string
    {
        return CommerceOrderEvent::FULFILLMENT_DELIVERED;
    }
}
