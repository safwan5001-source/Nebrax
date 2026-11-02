<?php

namespace App\Support;

use App\Models\CommerceOrder;
use App\Services\Commerce\CommerceDeliveryScheduleService;

/**
 * إسقاط تتبّع الضيف (COPS-H2-5، D-H2-16) — **ضيّق عمداً** لأن الرابط قد يُشارَك مع المستلم (خصوصية الإهداء):
 * رقم الطلب، الحالة العامة، تاريخ الطلب، طريقة التسليم، الموعد (التاريخ/النافذة)، كتلة `fulfillment` (D-H2-13)، وانتهاء الرابط.
 * **بلا** أسماء/عناوين/هواتف/بريد/هدية/سطور/أسعار/دفع. قراءة فقط.
 */
final class CommerceOrderPublicTracking
{
    /** @return array<string, mixed> */
    public static function project(CommerceOrder $order, int $expiresAt): array
    {
        return [
            'number' => $order->number,
            'status' => CommerceOrderSerializer::publicStatus($order),
            'delivery_method' => $order->delivery_method,
            'placed_at' => ($order->confirmed_at ?? $order->created_at)?->toIso8601String(),
            ...CommerceOrderSerializer::cancellationBlock($order),
            ...($order->schedule === null ? [] : ['schedule' => CommerceDeliveryScheduleService::presentOrder($order->schedule)]),
            ...CommerceOrderPublicFulfillment::block($order),
            'expires_at' => \Carbon\CarbonImmutable::createFromTimestampUTC($expiresAt)->toIso8601String(),
        ];
    }
}
