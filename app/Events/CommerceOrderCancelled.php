<?php

namespace App\Events;

use App\Models\CommerceOrderEvent;

/** طلب متجر أُلغي (`order.cancelled`) (COPS-H1-2) — يُطلق بعد الالتزام، معرّفات فقط. */
final class CommerceOrderCancelled extends CommerceOrderDomainEvent
{
    public static function recordType(): string
    {
        return CommerceOrderEvent::ORDER_CANCELLED;
    }
}
