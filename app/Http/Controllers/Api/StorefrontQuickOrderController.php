<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CartNotFoundException;
use App\Services\Commerce\CommerceCartBatchRejectedException;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\FulfillmentPolicyNotConfiguredException;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\Commerce\ResolvedCommercePrice;
use App\Support\DocumentLineVariantResolver;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\BranchScope;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use PDOException;
use RuntimeException;

/**
 * H6 Quick Order — the native replacement for the Spree wholesale quick-order page.
 *
 * Both routes sit behind {@see \App\Http\Middleware\EnsureWholesalePriceAccess} (so: wholesale flag open, a wholesale-flagged
 * channel resolved from the Host, an authenticated buyer whose membership on THIS channel is approved, re-checked on every
 * request) and the storefront mutation gateway for the write. Nothing here reads a buyer, partner, price list, tenant or
 * channel from the request.
 *
 *  - `lookup` resolves a typed SKU or name to purchasable LINES on the server: simple products by their own SKU, variant
 *    products by the VARIANT's SKU (or all active variants when the product itself matched). The price shown is the approved
 *    precedence (partner list → channel list → unavailable) from {@see CommercePriceResolver}; a line with no eligible price
 *    is `available: false` and carries NO price — never the base sale price. Read-only.
 *  - `add` takes only `product_id`, optional `product_variant_id`, `unit_key` and `quantity`, and adds all of them to the
 *    buyer's cart ALL-OR-NOTHING through {@see CommerceCartService::addMany()}. A browser-supplied price or any other field
 *    is rejected outright (422), exactly as on `cart/items`.
 */
final class StorefrontQuickOrderController extends PublicApiController
{
    /** One request may carry at most this many lines (the form is a data-entry aid, not a bulk-import channel). */
    public const MAX_LINES = 50;

    private const LOOKUP_PRODUCT_LIMIT = 20;

    private const MAX_VARIANTS_PER_PRODUCT = 12;

    public function lookup(
        Request $request,
        CommercePriceResolver $prices,
        FulfillmentPolicyService $fulfillment,
        AvailableToSellService $availability,
    ): JsonResponse {
        $this->rejectUnknown($request, ['q', 'limit']);
        $filters = $request->validate([
            'q' => ['required', 'string', 'min:1', 'max:120'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:'.self::LOOKUP_PRODUCT_LIMIT],
        ]);

        $term = trim((string) $filters['q']);
        if ($term === '') {
            throw ValidationException::withMessages(['q' => 'الكلمة المطلوبة فارغة.']);
        }

        $storefront = app(StorefrontContext::class);
        $channelId = $storefront->salesChannelId();
        // SQL LIKE is case-insensitive on SQLite but case-sensitive on PostgreSQL: compare lower(column) to a lowered term
        // so a buyer typing "cof-100" finds COF-100 on the production database too.
        $like = mb_strtolower($this->likeTerm($term));
        $exact = mb_strtolower($term);
        $limit = (int) ($filters['limit'] ?? 10);

        $products = Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->whereIn('id', CommerceListing::query()
                ->where('sales_channel_id', $channelId)
                ->where('is_published', true)
                ->select('product_id'))
            ->where(fn ($q) => $q
                ->whereRaw('lower(name) like ?', [$like])
                ->orWhereRaw('lower(name_en) like ?', [$like])
                ->orWhereRaw('lower(sku) like ?', [$like])
                ->orWhereHas('variants', fn ($v) => $v->where('is_active', true)->whereRaw('lower(sku) like ?', [$like])))
            ->with(['variants' => fn ($v) => $v->where('is_active', true)->with('optionValues.option')])
            ->orderByRaw(
                'case when lower(sku) = ? or exists (select 1 from product_variants pv where pv.product_id = products.id and pv.is_active = ? and lower(pv.sku) = ?) then 0 else 1 end',
                [$exact, true, $exact],
            )
            ->orderBy('name')
            ->limit($limit)
            ->get();

        $currency = Tenant::findOrFail($storefront->tenantId())->currency;

        $warehouse = null;
        try {
            $warehouse = $fulfillment->resolveWarehouseFor($channelId);
        } catch (FulfillmentPolicyNotConfiguredException) {
            $warehouse = null;
        }

        $lines = [];
        foreach ($products as $product) {
            foreach ($this->candidateTargets($product, $term) as $variant) {
                $lines[] = $this->line($product, $variant, $exact, $channelId, $currency, $prices, $availability, $warehouse?->id);
            }
        }

        // exact SKU hits first (stable for the rest, which keeps the name order of the query)
        usort($lines, fn (array $a, array $b): int => ($b['exact'] <=> $a['exact']));

        return PublicApiResponse::success($request, $lines);
    }

    /**
     * EXACT-SKU resolution of a typed/pasted list: for each requested SKU, the purchasable lines whose OWN sku equals it
     * (a simple product's sku, or a variant's sku; a variant-managed parent's sku yields its active variants, which the
     * buyer must pick between). Order and spelling of the request are preserved; an unknown SKU is an empty `lines`.
     * Same price/availability rules as `lookup`; read-only.
     */
    public function resolve(
        Request $request,
        CommercePriceResolver $prices,
        FulfillmentPolicyService $fulfillment,
        AvailableToSellService $availability,
    ): JsonResponse {
        $this->rejectUnknown($request, ['skus']);
        $data = $request->validate([
            'skus' => ['required', 'array', 'min:1', 'max:'.self::MAX_LINES],
            // catalog SKUs may be up to 255 characters (product and variant requests): never truncate or reject a valid one
            'skus.*' => ['required', 'string', 'min:1', 'max:255'],
        ]);

        $requested = array_values(array_map(fn ($sku) => trim((string) $sku), $data['skus']));
        $wanted = array_values(array_unique(array_map('mb_strtolower', array_filter($requested, fn ($sku) => $sku !== ''))));

        $storefront = app(StorefrontContext::class);
        $channelId = $storefront->salesChannelId();
        $currency = Tenant::findOrFail($storefront->tenantId())->currency;

        $products = $wanted === [] ? collect() : Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->whereIn('id', CommerceListing::query()
                ->where('sales_channel_id', $channelId)
                ->where('is_published', true)
                ->select('product_id'))
            ->where(fn ($q) => $q
                ->whereIn(DB::raw('lower(sku)'), $wanted)
                ->orWhereHas('variants', fn ($v) => $v->where('is_active', true)->whereIn(DB::raw('lower(sku)'), $wanted)))
            ->with(['variants' => fn ($v) => $v->where('is_active', true)->with('optionValues.option')])
            ->get();

        $warehouse = null;
        try {
            $warehouse = $fulfillment->resolveWarehouseFor($channelId);
        } catch (FulfillmentPolicyNotConfiguredException) {
            $warehouse = null;
        }

        /** @var array<string, list<array<string, mixed>>> $bySku */
        $bySku = [];
        foreach ($products as $product) {
            $productSku = $product->sku === null ? null : mb_strtolower($product->sku);
            if (! $product->isVariantManaged()) {
                if ($productSku !== null && in_array($productSku, $wanted, true)) {
                    $bySku[$productSku][] = $this->line($product, null, $productSku, $channelId, $currency, $prices, $availability, $warehouse?->id);
                }

                continue;
            }

            foreach ($product->variants as $variant) {
                $variantSku = $variant->sku === null ? null : mb_strtolower($variant->sku);
                // independent checks: a variant requested by its own sku ALSO belongs to its parent's sku when that was requested too
                if ($variantSku !== null && in_array($variantSku, $wanted, true)) {
                    $bySku[$variantSku][] = $this->line($product, $variant, $variantSku, $channelId, $currency, $prices, $availability, $warehouse?->id);
                }
                if ($productSku !== null && in_array($productSku, $wanted, true)) {
                    $bySku[$productSku][] = $this->line($product, $variant, $productSku, $channelId, $currency, $prices, $availability, $warehouse?->id);
                }
            }
        }

        $result = array_map(fn (string $sku): array => [
            'sku' => $sku,
            'lines' => array_slice($bySku[mb_strtolower($sku)] ?? [], 0, self::MAX_VARIANTS_PER_PRODUCT),
        ], $requested);

        return PublicApiResponse::success($request, $result);
    }

    public function add(Request $request, CommerceCartService $carts): JsonResponse
    {
        $this->rejectUnknown($request, ['items']);
        $data = $request->validate([
            'items' => ['required', 'array', 'min:1', 'max:'.self::MAX_LINES],
            'items.*' => ['required', 'array:product_id,product_variant_id,unit_key,quantity'],
            'items.*.product_id' => ['required', 'uuid'],
            'items.*.product_variant_id' => ['sometimes', 'nullable', 'uuid'],
            'items.*.unit_key' => ['sometimes', 'string', 'max:80'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:2147483647'],
        ]);

        $lookup = $carts->findByToken($request->cookie(CommerceCartService::COOKIE_NAME));
        if ($lookup['invalid']) {
            return $this->clearCookie($this->notFound($request));
        }

        try {
            $result = $carts->addMany($lookup['cart'], array_values($data['items']));
        } catch (CartNotFoundException) {
            return $this->clearCookie($this->notFound($request));
        } catch (CommerceCartBatchRejectedException $e) {
            return PublicApiResponse::error(
                $request,
                PublicApiErrorCode::VALIDATION_FAILED,
                'بعض الأسطر غير قابلة للشراء؛ لم تُضَف أي أسطر.',
                422,
                ['reason' => 'quick_order_rejected', 'lines' => $e->failures],
            );
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        $response = PublicApiResponse::success($request, $result['data'], $result['created'] ? 201 : 200);
        $this->setCookie(
            $response,
            $result['token'] ?? $lookup['rebound'] ?? (string) $request->cookie(CommerceCartService::COOKIE_NAME),
        );

        return $response;
    }

    /**
     * What a typed term can mean for one product: the variants whose OWN sku matched, else (the product itself matched) all of
     * its active variants, capped; a simple product is one base line (`null`).
     *
     * @return list<?ProductVariant>
     */
    private function candidateTargets(Product $product, string $term): array
    {
        if (! $product->isVariantManaged()) {
            return [null];
        }

        $needle = mb_strtolower($term);
        $matching = $product->variants->filter(fn (ProductVariant $v): bool => $v->sku !== null && str_contains(mb_strtolower($v->sku), $needle));

        // an exact variant SKU must survive the per-product cap even when more than the cap merely contain the term
        $matching = $matching->sortBy(fn (ProductVariant $v): int => mb_strtolower((string) $v->sku) === $needle ? 0 : 1);

        return ($matching->isNotEmpty() ? $matching : $product->variants)
            ->take(self::MAX_VARIANTS_PER_PRODUCT)
            ->values()
            ->all();
    }

    /** @return array<string, mixed> */
    private function line(
        Product $product,
        ?ProductVariant $variant,
        string $exactLower,
        string $channelId,
        string $currency,
        CommercePriceResolver $prices,
        AvailableToSellService $availability,
        ?string $warehouseId,
    ): array {
        $sku = $variant?->sku ?? $product->sku;

        $amount = null;
        $reason = null;
        try {
            $price = $prices->resolve($product->id, $channelId, null, null, false, $variant?->id);
            if ($price->resolved && $price->amount !== null) {
                $amount = $price->amount;
            } else {
                $reason = $price->unavailableReason === ResolvedCommercePrice::UNAVAILABLE_FOR_WHOLESALE
                    ? 'no_wholesale_price'
                    : 'not_purchasable';
            }
        } catch (RuntimeException) {
            $reason = 'not_purchasable';
        }

        $inStock = null;
        if ($warehouseId !== null) {
            $inStock = $availability->forWarehouse($product->id, $warehouseId, $variant?->id)->availableToSell > 0;
        }

        return [
            'product_id' => $product->id,
            'product_variant_id' => $variant?->id,
            'unit_key' => 'base',
            'unit_name' => (string) $product->unit,
            'sku' => $sku,
            'name' => $product->name,
            'name_en' => $product->name_en,
            'descriptor' => $variant === null ? null : DocumentLineVariantResolver::descriptor($variant),
            // No eligible wholesale price ⇒ no price at all (never 0, never the retail sale price).
            'price' => $amount === null ? null : ['amount_minor' => $amount, 'currency' => $currency],
            'available' => $amount !== null,
            'unavailable_reason' => $reason,
            'in_stock' => $inStock,
            'exact' => $sku !== null && mb_strtolower($sku) === $exactLower,
        ];
    }

    /** @param array<int, string> $allowed */
    private function rejectUnknown(Request $request, array $allowed): void
    {
        $unknown = array_values(array_diff(array_keys($request->all()), $allowed));
        if ($unknown !== []) {
            throw ValidationException::withMessages([
                'request' => 'حقول غير مسموحة: '.implode(', ', $unknown),
            ]);
        }
    }

    private function notFound(Request $request): JsonResponse
    {
        return PublicApiResponse::error($request, PublicApiErrorCode::NOT_FOUND, 'السلة غير متاحة.');
    }

    private function clearCookie(JsonResponse $response): JsonResponse
    {
        $response->headers->setCookie(cookie()->forget(CommerceCartService::COOKIE_NAME, '/', null));

        return $response;
    }

    private function setCookie(JsonResponse $response, string $rawToken): void
    {
        $response->headers->setCookie(cookie(
            CommerceCartService::COOKIE_NAME,
            $rawToken,
            CommerceCartService::LIFETIME_DAYS * 24 * 60,
            '/',
            null,
            app()->environment('production'),
            true,
            false,
            'lax',
        ));
    }
}
