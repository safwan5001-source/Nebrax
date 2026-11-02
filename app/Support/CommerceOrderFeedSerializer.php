<?php

namespace App\Support;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderEvent;
use App\Services\Commerce\CommerceOrderAttentionQuery;

/**
 * مسلسل تغذية الموظف ومصالحة الانتباه (COPS-H1-2). للموظف حصراً، منفصل عن `CommerceOrderSerializer` العام الذي لا يتغيّر.
 *
 * حقول بيضاء صريحة: لا اسم عميل ولا هاتف ولا بريد ولا عنوان ولا مبلغ ولا اسم موظف — التفاصيل عبر `GET commerce/orders/{id}` المحروس. الأحداث تحمل
 * `data` بالمفاتيح البيضاء لكل نوع فقط (`CommerceOrderEvent::DATA_KEYS`) ولو خُزِّن أكثر.
 */
final class CommerceOrderFeedSerializer
{
    /** @return array<string, mixed> */
    public static function event(CommerceOrderEvent $event, ?CommerceOrder $order): array
    {
        return [
            'seq' => (int) $event->feed_seq,
            'type' => $event->type,
            'occurred_at' => $event->occurred_at?->toIso8601String(),
            'order' => [
                'id' => (string) $event->commerce_order_id,
                'number' => $order?->number,
                'storefront_id' => $order?->storefront_id,
                'sales_channel_id' => $order?->sales_channel_id,
            ],
            'actor' => ['type' => $event->actor_type],
            'data' => (object) array_intersect_key($event->data ?? [], array_flip(CommerceOrderEvent::DATA_KEYS[$event->type] ?? [])),
        ];
    }

    /** @return array<string, mixed> */
    public static function attention(CommerceOrder $order, CommerceOrderAttentionQuery $query): array
    {
        $intent = $order->paymentIntent;

        return [
            'order' => [
                'id' => (string) $order->id,
                'number' => $order->number,
                'storefront_id' => $order->storefront_id,
                'sales_channel_id' => $order->sales_channel_id,
                'delivery_method' => $order->delivery_method,
                'created_at' => $order->created_at?->toIso8601String(),
            ],
            'payment' => ['method' => $intent?->method, 'status' => $intent?->status],
            'reasons' => $query->reasonsFor($order),
        ];
    }
}
