<?php

namespace App\Events;

use App\Models\CommerceOrderEvent;

/** إقرار تنبيه الطلب (`order.acknowledged`) (COPS-H3-4) — يُطلق بعد الالتزام، معرّفات فقط. */
final class CommerceOrderAcknowledged extends CommerceOrderDomainEvent
{
    public static function recordType(): string
    {
        return CommerceOrderEvent::ORDER_ACKNOWLEDGED;
    }
}
