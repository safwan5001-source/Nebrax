<?php

namespace App\Events;

use App\Models\CommerceOrderEvent;

/** تنفيذ طلب متجر: بدء تحضير (`fulfillment.started`) (COPS-H2-1) — يُطلق بعد الالتزام، معرّفات فقط. */
final class CommerceOrderFulfillmentStarted extends CommerceOrderDomainEvent
{
    public static function recordType(): string
    {
        return CommerceOrderEvent::FULFILLMENT_STARTED;
    }
}
