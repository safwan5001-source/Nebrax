<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceOrder;
use App\Models\Tenant;
use App\Services\Commerce\CommerceOrderService;
use App\Support\CommerceOrderSerializer;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * H6 Batch M — the approved wholesale buyer's OWN order history on the Host-resolved wholesale channel.
 *
 * Reached only through `EnsureWholesalePriceAccess` (token + channel binding + APPROVED membership, re-checked on every request —
 * a suspended or rejected buyer gets 403 exactly like the catalogue), which also establishes `CustomerContext` from the verified
 * token. Ownership is `CommerceOrderService::ownedOrders()` / `findOwnedOrder()` (the `CustomerContext` identity — never a client
 * id), the same trusted source `GET /commerce/v1/me/orders` uses, additionally narrowed to THIS channel so orders the same identity
 * placed elsewhere (e.g. the mobile app) are not shown on the wholesale storefront. Another buyer's order, another channel's order
 * and a missing order are one and the same 404.
 *
 * Output reuses the approved public serializers: no ERP document ids, invoice/ledger/inventory/cost data, payment-provider fields,
 * partner or price-list ids, staff identities or cancellation reasons.
 */
final class StorefrontBuyerOrderController extends PublicApiController
{
    public function index(Request $request, CommerceOrderService $orders, StorefrontContext $context): JsonResponse
    {
        $request->validate([
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:50'],
        ]);

        $paginator = $orders->ownedOrders()
            ->where('sales_channel_id', $context->salesChannelId())
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate($this->perPage($request));

        $currency = Tenant::findOrFail(app(TenantContext::class)->id())->currency;

        return new JsonResponse([
            'data' => $paginator->getCollection()->map(fn (CommerceOrder $order): array => [
                'id' => $order->id,
                'number' => $order->number,
                'status' => CommerceOrderSerializer::publicStatus($order),
                'delivery_method' => $order->delivery_method,
                ...CommerceOrderSerializer::cancellationBlock($order),
                'total' => ['amount_minor' => $order->total, 'currency' => $currency],
                'created_at' => $order->created_at?->toIso8601String(),
            ])->all(),
            'meta' => [
                'request_id' => PublicApiResponse::requestId($request),
                'pagination' => [
                    'page' => $paginator->currentPage(),
                    'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(),
                    'last_page' => $paginator->lastPage(),
                    'has_more' => $paginator->hasMorePages(),
                ],
            ],
        ]);
    }

    public function show(Request $request, string $order, CommerceOrderService $orders, StorefrontContext $context): JsonResponse
    {
        $found = $orders->findOwnedOrder($order);
        if ($found === null || $found->sales_channel_id !== $context->salesChannelId()) {
            return PublicApiResponse::error($request, PublicApiErrorCode::NOT_FOUND, 'الطلب غير متاح.');
        }

        return PublicApiResponse::success($request, ['order' => CommerceOrderSerializer::serialize($found)]);
    }
}
