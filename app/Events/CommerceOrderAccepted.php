<?php

namespace App\Events;

use App\Models\CommerceOrderEvent;

/** قبول التاجر اليدوي لطلب متجر (`order.accepted`) (COPS-H1-4) — يُطلق بعد الالتزام، معرّفات فقط. */
final class CommerceOrderAccepted extends CommerceOrderDomainEvent
{
    public static function recordType(): string
    {
        return CommerceOrderEvent::ORDER_ACCEPTED;
    }
}
