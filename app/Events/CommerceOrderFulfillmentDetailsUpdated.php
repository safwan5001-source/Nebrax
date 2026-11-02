<?php

namespace App\Events;

use App\Models\CommerceOrderEvent;

/** تنفيذ طلب متجر: تحديث تفاصيل (`fulfillment.details_updated`) (COPS-H2-1) — يُطلق بعد الالتزام، معرّفات فقط. */
final class CommerceOrderFulfillmentDetailsUpdated extends CommerceOrderDomainEvent
{
    public static function recordType(): string
    {
        return CommerceOrderEvent::FULFILLMENT_DETAILS_UPDATED;
    }
}
