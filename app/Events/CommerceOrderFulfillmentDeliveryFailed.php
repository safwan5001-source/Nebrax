<?php

namespace App\Events;

use App\Models\CommerceOrderEvent;

/** تنفيذ طلب متجر: فشل توصيل (`fulfillment.delivery_failed`) (COPS-H2-1) — يُطلق بعد الالتزام، معرّفات فقط. */
final class CommerceOrderFulfillmentDeliveryFailed extends CommerceOrderDomainEvent
{
    public static function recordType(): string
    {
        return CommerceOrderEvent::FULFILLMENT_DELIVERY_FAILED;
    }
}
