<?php

namespace App\Events;

use App\Models\CommerceOrderEvent;

/** تنفيذ طلب متجر: جاهزية (`fulfillment.ready`) (COPS-H2-1) — يُطلق بعد الالتزام، معرّفات فقط. */
final class CommerceOrderFulfillmentReady extends CommerceOrderDomainEvent
{
    public static function recordType(): string
    {
        return CommerceOrderEvent::FULFILLMENT_READY;
    }
}
