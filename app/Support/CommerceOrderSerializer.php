<?php

namespace App\Support;

use App\Models\CommerceOrder;
use App\Models\Tenant;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Commerce API V1 — PR-5: shared public CommerceOrder serialization
 * ═══════════════════════════════════════════════════════════════
 *
 *  Extracts the exact response shape `StorefrontCheckoutController::
 *  serializeOrder()` established into one reusable static, so the
 *  standalone `GET /commerce/v1/orders/{id}` endpoint reuses the approved
 *  public contract byte-for-byte instead of growing a third private copy.
 *
 *  `CommerceCheckoutController::complete()` originally kept its own
 *  literal copy of this same shape (a "mirror" in name only — it had
 *  already silently drifted from this class, caught by
 *  `CommerceOrderStatusApiTest`'s shape-parity assertion when
 *  COM-MOBILE-ORDER-HISTORY-1 added new `delivery` fields here but not to
 *  that copy) and now calls `CommerceOrderSerializer::serialize()`
 *  directly instead. `StorefrontCheckoutController` (`/store/v1`, a
 *  separate trust boundary/consumer) keeps its own independent copy —
 *  out of scope for a `/commerce/v1`-only task, and no test asserts
 *  parity between the two products' shapes.
 *
 *  Public-safe fields only: no tenant internals beyond the existing
 *  contract, no cost/ledger/inventory data, no API client identity.
 *  `payment` (COM-MOBILE-PAYMENTS-1) exposes only method/status/method
 *  name — never a card/PSP field, since none exist in this V1 (COD/Pay on
 *  Pickup only, ADR-09).
 *
 *  COM-MOBILE-ORDER-HISTORY-1: also the detail shape for the authenticated
 *  customer's own order history (`GET /commerce/v1/me/orders/{id}`) — one
 *  serializer, one contract, for the guest-reference, checkout-completion,
 *  and customer-owned read paths alike. `region`/`building_no`/
 *  `additional_number` added to `delivery` here (COM-MOBILE-ADDRESSES-1
 *  had already added the columns to `CommerceOrderSnapshot`, but no
 *  serializer exposed them yet).
 */
final class CommerceOrderSerializer
{
    /** @return array<string, mixed> */
    public static function serialize(CommerceOrder $order): array
    {
        $currency = Tenant::findOrFail($order->tenant_id)->currency;

        return [
            'id' => $order->id,
            'number' => $order->number,
            'status' => $order->status,
            'delivery_method' => $order->delivery_method,
            'total' => ['amount_minor' => $order->total, 'currency' => $currency],
            'contact' => [
                'name' => $order->snapshot?->contact_name,
                'phone' => $order->snapshot?->phone,
                'email' => $order->snapshot?->email,
            ],
            'delivery' => [
                'country' => $order->snapshot?->shipping_country,
                'region' => $order->snapshot?->shipping_region,
                'city' => $order->snapshot?->shipping_city,
                'district' => $order->snapshot?->shipping_district,
                'street' => $order->snapshot?->shipping_street,
                'building_no' => $order->snapshot?->shipping_building_no,
                'additional_number' => $order->snapshot?->shipping_additional_number,
                'postal_code' => $order->snapshot?->shipping_postal_code,
                'notes' => $order->snapshot?->shipping_notes,
                // COM-MOBILE-SHIPPING-1: مسبقاً محسوباً ضمن `total` أعلاه —
                // هذا الحقل تفصيلٌ للعرض فقط، لا مصدر حقيقة إضافياً.
                'amount' => ['amount_minor' => $order->delivery_amount_minor, 'currency' => $currency],
            ],
            'payment' => [
                'method' => $order->paymentIntent?->method,
                'status' => $order->paymentIntent?->status,
                'payment_method_name' => $order->paymentIntent?->payment_method_name,
            ],
            'items' => $order->lines->map(fn ($line) => [
                'product_id' => $line->product_id,
                'product_name' => $line->product_name_snapshot,
                'unit_name' => $line->unit_name,
                'quantity' => $line->quantity,
                'unit_price' => ['amount_minor' => $line->unit_price, 'currency' => $currency],
                'line_total' => ['amount_minor' => $line->line_total, 'currency' => $currency],
            ])->all(),
            'created_at' => $order->created_at?->toIso8601String(),
        ];
    }
}
