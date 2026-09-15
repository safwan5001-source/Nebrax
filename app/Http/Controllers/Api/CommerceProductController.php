<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontProductResource;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\FulfillmentPolicyNotConfiguredException;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Support\PublicApiResponse;
use App\Tenancy\BranchScope;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public/Mobile Commerce API V1 — PR-2 (Read-only Catalog: products).
 *
 * Deliberately a **new, thin controller** — not a reuse of
 * `StorefrontProductController` — reusing the exact same authority services
 * (`CommercePriceResolver`, `FulfillmentPolicyService`, `AvailableToSellService`)
 * instead of duplicating any pricing/availability logic. Matches the
 * architecture doc's own PR-2 description: "thin adapters reusing existing
 * catalog/publication/pricing services."
 *
 * Publication gate is identical to `/store/v1`'s: `is_active=true` **and** a
 * published `CommerceListing` on the resolved `sales_channel_id` — read
 * verbatim from `StorefrontContext`, which `ResolveCommerceChannel` +
 * `MobileSalesChannelResolver` already populate with the tenant's resolved
 * *mobile* channel (never a client-supplied id). The exact same query shape
 * already respects whatever channel is resolved — it was never hardcoded to
 * `SalesChannel::TYPE_WEB` in the first place.
 *
 * **Variants deliberately deferred** — mirrors `/store/v1`'s own existing
 * list-row convention for a variant-managed product (`is_variant_managed:
 * true`, no price, no variant/option payload) for both list and detail here.
 * `CommercePriceResolver`/`AvailableToSellService` gained variant-awareness
 * since this doc section was written (VAR-COM-1), but building the actual
 * variant contract for `/commerce/v1` (attributes, per-variant price/stock)
 * is real, non-trivial new surface — out of PR-2's explicit scope, not
 * silently invented here. `AvailableToSellService::forWarehouse()` reading
 * `product_variant_id IS NULL` on a variant-managed parent would silently
 * return zero stock (a *wrong* signal, not "no stock") — never called for
 * such a product; `in_stock` stays `null` (unknown), not a fabricated
 * `false`.
 *
 * **Media deliberately out of scope** — no `/commerce/v1/media/{id}` route
 * exists yet (not in this PR's explicit scope), so `StorefrontProductResource`
 * is reused with an empty gallery and `detailed=false` even on `show()`:
 * `thumbnail_url`/`media` resolve to `null`/absent rather than a link to an
 * endpoint that doesn't exist for this trust boundary.
 */
class CommerceProductController extends PublicApiController
{
    private const SORTS = ['name' => 'name', 'sale_price' => 'sale_price', 'created_at' => 'created_at'];

    public function index(
        Request $request,
        CommercePriceResolver $prices,
        FulfillmentPolicyService $fulfillment,
        AvailableToSellService $availability,
    ): JsonResponse {
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'category_id' => ['sometimes', 'nullable', 'uuid'],
            'sort' => ['sometimes', 'nullable', 'string', 'max:40'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $storefront = app(StorefrontContext::class);
        $channelId = $storefront->salesChannelId();

        $query = Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->whereIn('id', CommerceListing::query()
                ->where('sales_channel_id', $channelId)
                ->where('is_published', true)
                ->select('product_id'))
            ->with(['productCategory:id,name']);

        if (filled($filters['search'] ?? null)) {
            $like = $this->likeTerm((string) $filters['search']);
            $query->where(fn ($q) => $q
                ->where('name', 'like', $like)
                ->orWhere('name_en', 'like', $like)
                ->orWhere('sku', 'like', $like));
        }

        if (filled($filters['category_id'] ?? null)) {
            $query->where('category_id', $filters['category_id']);
        }

        $this->applySort($query, $filters['sort'] ?? null, self::SORTS, 'name');

        $paginator = $query->paginate($this->perPage($request));

        $currency = Tenant::findOrFail($storefront->tenantId())->currency;

        $warehouse = null;
        try {
            $warehouse = $fulfillment->resolveWarehouseFor($channelId);
        } catch (FulfillmentPolicyNotConfiguredException) {
            $warehouse = null;
        }

        $data = $paginator->getCollection()
            ->map(fn (Product $product) => $this->toResource($request, $product, $channelId, $currency, $warehouse, $prices, $availability, false))
            ->all();

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

    public function show(
        Request $request,
        CommercePriceResolver $prices,
        FulfillmentPolicyService $fulfillment,
        AvailableToSellService $availability,
    ): JsonResponse {
        $id = (string) $request->route('id');

        $storefront = app(StorefrontContext::class);
        $channelId = $storefront->salesChannelId();

        $isPublished = CommerceListing::query()
            ->where('product_id', $id)
            ->where('sales_channel_id', $channelId)
            ->where('is_published', true)
            ->exists();

        if (! $isPublished) {
            abort(404, 'المنتج غير موجود.');
        }

        $product = Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->with(['productCategory:id,name'])
            ->find($id);

        if ($product === null) {
            abort(404, 'المنتج غير موجود.');
        }

        $currency = Tenant::findOrFail($storefront->tenantId())->currency;

        $warehouse = null;
        try {
            $warehouse = $fulfillment->resolveWarehouseFor($channelId);
        } catch (FulfillmentPolicyNotConfiguredException) {
            $warehouse = null;
        }

        $resource = $this->toResource($request, $product, $channelId, $currency, $warehouse, $prices, $availability, true);

        return PublicApiResponse::success($request, $resource);
    }

    private function toResource(
        Request $request,
        Product $product,
        string $channelId,
        string $currency,
        $warehouse,
        CommercePriceResolver $prices,
        AvailableToSellService $availability,
        bool $detailed,
    ): array {
        if ($product->isVariantManaged()) {
            // Deferred (see class docblock): no ambiguous parent price/stock.
            $price = 0;
            $inStock = null;
        } else {
            $resolved = $prices->resolve($product->id, $channelId);
            $price = (int) ($resolved->amount ?? $product->sale_price);

            $inStock = null;
            if ($warehouse !== null) {
                $inStock = $availability->forWarehouse($product->id, $warehouse->id)->availableToSell > 0;
            }
        }

        return (new StorefrontProductResource($product, $price, $currency, $inStock, $detailed, null))->resolve($request);
    }
}
