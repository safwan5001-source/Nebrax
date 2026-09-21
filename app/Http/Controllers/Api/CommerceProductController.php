<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontProductResource;
use App\Models\CommerceCategoryListing;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\FulfillmentPolicyNotConfiguredException;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\ProductMediaGalleryService;
use App\Support\DocumentLineVariantResolver;
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
 * **Variants (COM-MOBILE-VARIANTS-1)** — `index()` keeps `/store/v1`'s own
 * list-row convention for a variant-managed product unchanged
 * (`is_variant_managed: true`, no ambiguous parent price/stock, no
 * variant/option payload — resolving every variant's price/stock for a full
 * paginated page would be real N+1 for no listing benefit, exactly why
 * `/store/v1`'s own list never does it either). `show()` now mirrors
 * `StorefrontProductController::show()`'s already-shipped variant branch:
 * `options` (attribute/value definitions) and `variants` (id, sku,
 * descriptor, option_value_ids, price, in_stock, media) — no new pricing,
 * availability, or variant-identity logic; `CommercePriceResolver::resolve()`
 * and `AvailableToSellService::forWarehouse()` already accept `$variantId`
 * (VAR-COM-1), and `CommerceCartController::store()` already forwards
 * `product_variant_id` to the shared `CommerceCartService` — this only
 * closes the read-side gap of exposing what a client needs to select a
 * variant before adding it to cart. `AvailableToSellService::forWarehouse()`
 * is still never called with `variantId=null` on a variant-managed parent
 * (would silently return a *wrong* zero-stock signal, not "no stock").
 *
 * **Media (COM-MOBILE-MEDIA-1)** — reuses `ProductMediaGalleryService` (the
 * single gallery-resolution authority, VAR-MEDIA-1) and
 * `StorefrontProductResource::commerceMediaPayload()` to link each item to
 * `/commerce/v1/media/{id}` (`CommerceMediaController`), which re-applies the
 * exact same channel-publication check this controller already performs — no
 * parallel media storage/authority. The product-level shared gallery is wired
 * into every product; a variant-managed product's `show()` additionally
 * resolves each variant's own media via `resolveGallery($product, $variant)`
 * (COM-MOBILE-VARIANTS-1) — the same three-layer algorithm
 * `ProductMediaGalleryService` already applies for `/store/v1` and POS.
 */
class CommerceProductController extends PublicApiController
{
    private const SORTS = ['name' => 'name', 'sale_price' => 'sale_price', 'created_at' => 'created_at'];

    public function index(
        Request $request,
        CommercePriceResolver $prices,
        FulfillmentPolicyService $fulfillment,
        AvailableToSellService $availability,
        ProductMediaGalleryService $gallery,
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
            // COM-CATALOG-2 — الترشيح بالتصنيف يحترم بوابة نشر التصنيف على
            // القناة المحلولة: تصنيفٌ غير منشور يُرجِع نتيجة فارغة حتمياً،
            // بينما يبقى المنتج المنشور (CommerceListing) ظاهراً في القائمة
            // العامة — استقلالية كاملة بين البوابتين.
            $categoryId = (string) $filters['category_id'];
            $query->where('category_id', $categoryId);
            $categoryPublished = CommerceCategoryListing::publishedOn($channelId)
                ->where('category_id', $categoryId)
                ->exists();
            if (! $categoryPublished) {
                $query->whereRaw('0 = 1');
            }
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
            ->map(fn (Product $product) => $this->toResource($request, $product, $channelId, $currency, $warehouse, $prices, $availability, $gallery, false))
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
        ProductMediaGalleryService $gallery,
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

        $resource = $this->toResource($request, $product, $channelId, $currency, $warehouse, $prices, $availability, $gallery, true);

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
        ProductMediaGalleryService $gallery,
        bool $detailed,
    ): array {
        if ($product->isVariantManaged()) {
            if ($detailed) {
                return $this->variantResource($request, $product, $channelId, $currency, $warehouse, $prices, $availability, $gallery);
            }

            // List row deferred (see class docblock): no ambiguous parent price/stock.
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

        // COM-MOBILE-MEDIA-1 — product-level shared gallery only (no variant
        // passed): matches the variant-media deferral documented above.
        $galleryMedia = StorefrontProductResource::commerceMediaPayload($gallery->resolveGallery($product));

        return (new StorefrontProductResource($product, $price, $currency, $inStock, $detailed, null, $galleryMedia))->resolve($request);
    }

    /**
     * COM-MOBILE-VARIANTS-1 — mirrors `StorefrontProductController::show()`'s
     * variant-managed branch exactly (same authorities, same shape), adapted
     * for the mobile trust boundary (`commerceMediaPayload()`, no
     * `tenantSlug`). No ambiguous parent price/stock: price/availability are
     * resolved per active variant only.
     */
    private function variantResource(
        Request $request,
        Product $product,
        string $channelId,
        string $currency,
        $warehouse,
        CommercePriceResolver $prices,
        AvailableToSellService $availability,
        ProductMediaGalleryService $gallery,
    ): array {
        $activeVariants = $product->variants()
            ->where('is_active', true)
            ->with('optionValues.option')
            ->get();

        $variantPayload = [];
        $cheapest = null;
        $anyInStock = null;
        foreach ($activeVariants as $variant) {
            $variantPrice = $prices->resolve($product->id, $channelId, null, null, false, $variant->id);
            if ($variantPrice->amount !== null && ($cheapest === null || $variantPrice->amount < $cheapest)) {
                $cheapest = $variantPrice->amount;
            }

            $variantInStock = null;
            if ($warehouse !== null) {
                $variantInStock = $availability->forWarehouse($product->id, $warehouse->id, $variant->id)->availableToSell > 0;
                $anyInStock = $anyInStock === true || $variantInStock === true;
            }

            $optionValueIds = $variant->optionValues()->with('option')->get()
                ->sortBy(fn ($value) => [(int) ($value->option->sort_order ?? 0), (int) $value->sort_order])
                ->pluck('id')->values()->all();

            $variantPayload[] = [
                'id' => $variant->id,
                'sku' => $variant->sku,
                'descriptor' => DocumentLineVariantResolver::descriptor($variant),
                'option_value_ids' => $optionValueIds,
                'price' => ['amount_minor' => $variantPrice->amount ?? 0, 'currency' => $currency],
                'in_stock' => $variantInStock,
                'media' => StorefrontProductResource::commerceMediaPayload($gallery->resolveGallery($product, $variant)),
            ];
        }

        $optionsPayload = $product->options()->where('is_active', true)->with('values')->get()
            ->map(fn ($option) => [
                'id' => $option->id,
                'name' => $option->name,
                'name_en' => $option->name_en,
                'values' => $option->values->where('is_active', true)->values()->map(fn ($value) => [
                    'id' => $value->id,
                    'value' => $value->value,
                    'value_en' => $value->value_en,
                ])->all(),
            ])->all();

        $galleryMedia = StorefrontProductResource::commerceMediaPayload($gallery->resolveGallery($product));

        return (new StorefrontProductResource(
            $product,
            $cheapest ?? 0,
            $currency,
            $anyInStock,
            true,
            null,
            $galleryMedia,
            $optionsPayload,
            $variantPayload,
        ))->resolve($request);
    }
}
