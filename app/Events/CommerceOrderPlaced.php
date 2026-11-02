<?php

namespace App\Events;

use App\Models\CommerceOrderEvent;

/** طلب متجر جديد أُتمّ (`order.placed`) (COPS-H1-2) — يُطلق بعد الالتزام، معرّفات فقط. */
final class CommerceOrderPlaced extends CommerceOrderDomainEvent
{
    public static function recordType(): string
    {
        return CommerceOrderEvent::ORDER_PLACED;
    }
}
