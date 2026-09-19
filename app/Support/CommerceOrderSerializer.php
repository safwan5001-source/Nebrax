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
 *  serializeOrder()` established (and `CommerceCheckoutController` mirrored
 *  in PR-4) into one reusable static, so the standalone
 *  `GET /commerce/v1/orders/{id}` endpoint reuses the approved public
 *  contract byte-for-byte instead of growing a third private copy.
 *
 *  The two existing controllers are deliberately left untouched (no
 *  refactor of working PR-4 code); this class is the single reuse point
 *  for the new endpoint only. Shape parity with the checkout-complete
 *  response is asserted by `CommerceOrderStatusApiTest`.
 *
 *  Public-safe fields only: no tenant internals beyond the existing
 *  contract, no cost/ledger/inventory/payment data, no API client identity.
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
                'city' => $order->snapshot?->shipping_city,
                'district' => $order->snapshot?->shipping_district,
                'street' => $order->snapshot?->shipping_street,
                'postal_code' => $order->snapshot?->shipping_postal_code,
                'notes' => $order->snapshot?->shipping_notes,
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
