<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceOrder;
use App\Support\CommerceOrderReference;
use App\Support\CommerceOrderSerializer;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public/Mobile Commerce API V1 — PR-5 (Standalone Order Status).
 *
 * `GET /commerce/v1/orders/{id}` — lets the mobile app re-read the
 * `CommerceOrder` produced by checkout completion independently of the
 * checkout-complete response (app restart, deep link, lost session), per
 * `docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md` §3.2
 * ("CommerceOrder result/status").
 *
 * **Ownership is proven by the signed guest-order reference, never by the
 * order id.** The bearer token already resolved by `AuthenticateApiClient`
 * establishes only *store/client* context (tenant + mobile channel) — it
 * does NOT prove guest ownership of a specific order, and this controller
 * never treats it as such. The order must additionally:
 *
 *   1. live inside the already-trusted tenant + resolved mobile
 *      `SalesChannel` (scoped lookup — a cross-tenant or cross-channel id
 *      is indistinguishable from a nonexistent one), and
 *   2. carry a valid `X-Order-Reference` signature bound to exactly this
 *      order's tenant/channel/id (`App\Support\CommerceOrderReference`).
 *
 * Every ownership failure — missing, malformed, tampered, wrong-order
 * reference, foreign order id — returns the identical non-revealing 404
 * envelope: no enumeration oracle beyond what the public contract already
 * allows.
 *
 * Read-only by construction: no order/checkout/cart mutation, no
 * accounting/payment/inventory side effects whatsoever.
 */
final class CommerceOrderController extends PublicApiController
{
    public function show(
        Request $request,
        string $id,
        TenantContext $tenantContext,
        StorefrontContext $storefrontContext,
    ): JsonResponse {
        $reference = $request->header(CommerceOrderReference::HEADER);

        $order = CommerceOrder::query()
            ->where('id', $id)
            ->where('tenant_id', $tenantContext->id())
            ->where('sales_channel_id', $storefrontContext->salesChannelId())
            ->first();

        if ($order === null || ! CommerceOrderReference::verify($order, is_string($reference) ? $reference : null)) {
            return $this->notFound($request);
        }

        return PublicApiResponse::success($request, ['order' => CommerceOrderSerializer::serialize($order)]);
    }

    private function notFound(Request $request): JsonResponse
    {
        return PublicApiResponse::error($request, PublicApiErrorCode::NOT_FOUND, 'الطلب غير متاح.');
    }
}
