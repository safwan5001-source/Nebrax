<?php

namespace App\Http\Controllers\Api;

use App\Models\Tenant;
use App\Services\Commerce\CommerceOrderService;
use App\Support\CommerceOrderSerializer;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * COM-MOBILE-ORDER-HISTORY-1 — the authenticated customer's own order
 * history. Reached only through the existing `X-Customer-Token`
 * required-auth route group (`AuthenticateCommerceCustomer` +
 * `EstablishCustomerContext`, unmodified) — ownership is
 * `CommerceOrderService::ownedOrders()`'s `CustomerContext::
 * customerIdentityId()` filter, the same trusted source `CommerceOrder`'s
 * own docblock has always documented, never a client-supplied id.
 *
 * Deliberately a separate route/controller from the existing
 * `GET /commerce/v1/orders/{id}` guest order-status endpoint
 * (`CommerceOrderController`) — that one proves ownership via a signed
 * `X-Order-Reference` header, an entirely different trust mechanism for an
 * entirely different caller (a guest who never authenticates). `me/orders`
 * avoids any path collision between the two route groups and keeps both
 * trust boundaries visibly distinct rather than branching one controller
 * on which proof happened to be presented.
 *
 * List rows stay a lightweight summary (id/number/status/delivery_method/
 * total/created_at) — full line items and the delivery/contact snapshot
 * are reserved for the single-order detail endpoint, matching common
 * order-history list/detail asymmetry and avoiding an N+1 snapshot/line
 * load per row on every list page.
 */
final class CommerceCustomerOrderController extends PublicApiController
{
    private const SORTS = ['created_at' => 'created_at', 'number' => 'number', 'total' => 'total'];

    public function index(Request $request, CommerceOrderService $orders): JsonResponse
    {
        $filters = $request->validate([
            'sort' => ['sometimes', 'nullable', 'string', 'max:40'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = $orders->ownedOrders();
        $this->applySort($query, $filters['sort'] ?? null, self::SORTS, '-created_at');

        $paginator = $query->paginate($this->perPage($request));

        $currency = Tenant::findOrFail(app(TenantContext::class)->id())->currency;

        $data = $paginator->getCollection()->map(fn ($order) => [
            'id' => $order->id,
            'number' => $order->number,
            'status' => $order->status,
            'delivery_method' => $order->delivery_method,
            'total' => ['amount_minor' => $order->total, 'currency' => $currency],
            'created_at' => $order->created_at?->toIso8601String(),
        ])->all();

        return new JsonResponse([
            'data' => $data,
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

    public function show(Request $request, string $id, CommerceOrderService $orders): JsonResponse
    {
        $order = $orders->findOwnedOrder($id);
        if ($order === null) {
            return PublicApiResponse::error($request, PublicApiErrorCode::NOT_FOUND, 'الطلب غير متاح.');
        }

        return PublicApiResponse::success($request, ['order' => CommerceOrderSerializer::serialize($order)]);
    }
}
