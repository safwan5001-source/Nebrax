<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontProductResource;
use App\Models\CommerceCategoryListing;
use App\Models\CommerceListing;
use App\Models\InventoryReservation;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\ProductWarehouseStock;
use App\Models\Tenant;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CommerceDeliveryPromiseService;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\FulfillmentPolicyNotConfiguredException;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\Commerce\ProductAddonService;
use App\Services\Commerce\ProductContentService;
use App\Services\Commerce\ProductPersonalizationService;
use App\Services\Commerce\StorefrontFacetVisualProjector;
use App\Services\ProductMediaGalleryService;
use App\Support\DocumentLineVariantResolver;
use App\Support\Commerce\CatalogFacetFilter;
use App\Support\Commerce\DeliverTodayFilter;
use App\Support\PublicApiResponse;
use App\Tenancy\BranchScope;
use App\Tenancy\StorefrontContext;
use App\Support\Commerce\EffectivePriceOrdering;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public storefront catalog — المنتجات (COM-7-P1)، قراءة عامة مجهولة فقط.
 *
 * الحراسة: منتج يظهر فقط إن كان `is_active` **و** له `CommerceListing`
 * منشور (`is_published = true`) على قناة `web` النشطة المحلولة من الرابط
 * (`StorefrontContext`، تضبطه `ResolveStorefrontTenant`). لا كتابة، ولا كشف
 * تكلفة/هامش/حسابات داخلية/كمية مخزون خام — فقط سعر مُحلَّل وتوفر مشتقّ.
 */
class StorefrontProductController extends PublicApiController
{
    private const SORTS = ['name' => 'name', 'sale_price' => 'sale_price', 'created_at' => 'created_at'];

    /**
     * CUST-H4-5 — يطابق `MAX_FEATURED_PRODUCTS` في عقد محتوى قسم «منتجات
     * مميّزة» (كلا نسختي `section-content.ts`) — مصدر الحد نفسه.
     */
    private const IDS_FILTER_MAX = 8;

    public function index(Request $request, CommercePriceResolver $resolver): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'category_id' => ['sometimes', 'nullable', 'uuid'],
            'sort' => ['sometimes', 'nullable', 'string', 'max:40'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
            // CUST-H4-5 — قراءة دفعة واحدة محدودة للقسم المنشور «منتجات
            // مميّزة» (`FeaturedShelf.tsx`)، تستبدل N طلبٍ مستقلٍّ لكل معرّف
            // (`fetchProduct` لكل عنصر) بطلبٍ واحد. تتركّب فوق بوابة النشر/
            // التفعيل القائمة بـ`whereIn` إضافية فقط — لا تُغيّرها ولا تُضعفها؛
            // معرّفٌ أجنبي أو غير منشور يسقط من النتيجة صمتاً، لا تسريب وجوده.
            'ids' => ['sometimes', 'array', 'max:'.self::IDS_FILTER_MAX],
            'ids.*' => ['uuid'],
            // FLOWERS-H8 / ADR-20 — وجهة اشتقاق وعد التسليم ومرشّح «التسليم اليوم».
            'city' => ['sometimes', 'nullable', 'string', 'max:120'],
            'region' => ['sometimes', 'nullable', 'string', 'max:120'],
            ...DeliverTodayFilter::rules(),
            ...CatalogFacetFilter::rules(),
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

        if (filled($filters['ids'] ?? null)) {
            $query->whereIn('id', array_values(array_unique($filters['ids'])));
        }

        if (filled($filters['search'] ?? null)) {
            $like = $this->likeTerm((string) $filters['search']);
            $query->where(fn ($q) => $q
                ->where('name', 'like', $like)
                ->orWhere('name_en', 'like', $like)
                ->orWhere('sku', 'like', $like));
        }

        if (filled($filters['category_id'] ?? null)) {
            // COM-CATALOG-2 — مسار الترشيح بالتصنيف يحترم بوابة نشر التصنيف:
            // تصنيفٌ غير منشور على هذه القناة ليس سطحاً عاماً، فيُرجِع الترشيح
            // به نتيجة فارغة حتمياً. استقلالية كاملة: المنتج المنشور في تصنيف
            // غير منشور يبقى ظاهراً في القائمة العامة (مصدره CommerceListing)،
            // ولا يتأثر إلا الترشيح الصريح بذلك التصنيف.
            $categoryId = (string) $filters['category_id'];
            $query->where('category_id', $categoryId);
            $categoryPublished = CommerceCategoryListing::publishedOn($channelId)
                ->where('category_id', $categoryId)
                ->exists();
            if (! $categoryPublished) {
                $query->whereRaw('0 = 1');
            }
        }

        // FLOWERS-H2 / ADR-14 — الأبعاد الوصفية والعلامة التجارية. الاستعلام
        // الأساسي (بوابة النشر + بحث + تصنيف) يُحفظ للعدّ التفريقي في `meta`.
        $facetFilter = new CatalogFacetFilter();
        $facetSelection = CatalogFacetFilter::selection($filters);
        $facetFilter->applyCollection($query, $facetSelection);
        if (DeliverTodayFilter::requested($filters)) {
            app(DeliverTodayFilter::class)->apply($query, $channelId, $filters['city'] ?? null, $filters['region'] ?? null);
        }
        $baseQuery = clone $query;
        $facetFilter->apply($query, $facetSelection);

        if ($facetSelection['collection'] !== null && blank($filters['sort'] ?? null)) {
            // داخل مجموعة بلا `sort` صريح: ترتيب التاجر للأعضاء.
            $facetFilter->orderByCollectionPosition($query, $facetSelection);
            $query->orderBy('name');
        } else {
            $this->applyListingSort($query, $filters['sort'] ?? null, $resolver, $channelId);
        }

        $paginator = $query->paginate($this->perPage($request));

        $currency = Tenant::findOrFail($storefront->tenantId())->currency;
        $inStockByProduct = $this->batchAvailability($paginator->getCollection(), $channelId);
        // `null` على المسار الموثوق (لا شريحة رابط في COM-7-P2A) — المورد يبني
        // رابط الوسائط من المسار المناسب وفق ذلك (راجع StorefrontProductResource).
        $tenantSlug = $request->route('tenantSlug');
        $gallery = app(ProductMediaGalleryService::class);

        // H6-F — one authoritative path: the same channel-list-then-sale_price
        // precedence as `CommercePriceResolver::resolve()` (detail/cart), batched
        // so a page costs one list query instead of one per row. A channel with
        // no active list yields `sale_price` exactly as before.
        $prices = $resolver->browsePrices($paginator->getCollection(), $channelId);

        // VAR-COM-1 — منتجٌ متعدد الخيارات لا سعر أبٍ ذا معنى له
        // (`resolve()` يرفض `variantId=null` لمنتجٍ كهذا فشلاً مغلَقاً)، ولا
        // نحسب «سعراً ابتدائياً» تخمينياً في القائمة المُرقَّمة (تفادي N+1 عبر
        // كل متغيّرات كل منتجٍ في الصفحة) — القائمة تعرض `is_variant_managed`
        // فقط؛ السعر والمتغيّرات الفعلية تُحلّ في `show()` عند الدخول للمنتج
        // (قرار نطاقٍ موثَّق في التقرير، لا نقص أمان: لا سعرٌ مُختلَقٌ يُعرض).
        // FLOWERS-H8 / ADR-20 — وعد التسليم المشتق بدفعة ثابتة الاستعلامات؛ null حين الجدولة معطَّلة (فلا مفتاح).
        $promises = app(CommerceDeliveryPromiseService::class)
            ->forProducts($channelId, $paginator->getCollection(), $filters['city'] ?? null, $filters['region'] ?? null);

        $data = $paginator->getCollection()->map(function (Product $product) use ($request, $currency, $inStockByProduct, $tenantSlug, $gallery, $promises, $prices): array {
            $galleryMedia = StorefrontProductResource::mediaPayload($gallery->resolveGallery($product), $tenantSlug);
            $price = $prices[$product->id];

            return (new StorefrontProductResource(
                $product,
                $price,
                $currency,
                $inStockByProduct[$product->id] ?? null,
                false,
                $tenantSlug,
                $galleryMedia,
            ))->withDeliveryPromise($promises[$product->id] ?? null)->resolve($request);
        })->all();

        // AWJ-VD-H1 / VD-1c (D1/D2) — `visual` on facets and values, storefront.v1 only: this controller is not the
        // commerce/v1 one, whose closed contract is untouched. Legacy routes (no storefront) get `visual: null`.
        $facetMeta = $facetFilter->meta($baseQuery, $facetSelection);
        $facetMeta['facets'] = app(StorefrontFacetVisualProjector::class)
            ->project($facetMeta['facets'], $facetFilter->activeFacetModels(), $storefront->hasStorefront());

        return new JsonResponse([
            'data' => $data,
            'meta' => [
                'request_id' => PublicApiResponse::requestId($request),
                ...$facetMeta,
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

    /**
     * H6 Batch G — `sort=sale_price|-sale_price` orders by the price this listing DISPLAYS (the channel's active
     * list item, else the base unit price, variant-managed ⇒ 0), via {@see EffectivePriceOrdering}. Every other sort
     * is the unchanged `applySort`. (Batch F handled only channels with a list; the legacy-column ordering that DTC
     * channels still had is closed here.)
     */
    private function applyListingSort(Builder $query, ?string $sort, CommercePriceResolver $resolver, string $channelId): void
    {
        $this->applySort($query, $sort, self::SORTS, 'name', function (Builder $q, string $direction) use ($resolver, $channelId): void {
            EffectivePriceOrdering::apply($q, $resolver->activeChannelPriceList($channelId)?->id, true, $direction);
        });
    }

    public function show(
        Request $request,
        CommercePriceResolver $prices,
        FulfillmentPolicyService $fulfillment,
        AvailableToSellService $availability,
    ): JsonResponse {
        // يُقرأ صراحةً من الطلب لا كوسيط مربوط بالاسم: مع وجود `{tenantSlug}`
        // غير مُعلَنة في التوقيع بجانب اعتماديات مُحقَّنة أخرى، حسم Laravel
        // لمواضع معاملات الطريق يصبح هشّاً (رُصد تجريبياً ربطه بقيمة خاطئة).
        $id = (string) $request->route('id');
        $destination = $request->validate([
            'city' => ['sometimes', 'nullable', 'string', 'max:120'],
            'region' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);

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
            abort(404, 'المنتج غير موجود [not-found].');
        }

        $tenantSlug = $request->route('tenantSlug');
        $galleryService = app(ProductMediaGalleryService::class);
        $currency = Tenant::findOrFail($storefront->tenantId())->currency;

        $warehouse = null;
        try {
            $warehouse = $fulfillment->resolveWarehouseFor($channelId);
        } catch (FulfillmentPolicyNotConfiguredException) {
            $warehouse = null;
        }

        if ($product->isVariantManaged()) {
            // VAR-COM-1 — لا هويّة بيعٍ غامضة على الأب: السعر/التوفر يُحسبان
            // لكلّ متغيّرٍ فعليٍّ نشِط على حدة، لا للمنتج الأب (`DocumentLineVariantResolver`
            // كان سيرفض `resolve()` بـ`variantId=null` هنا أصلاً). عدد
            // المتغيّرات في منتج واحدٍ محدودٌ عملياً (شاشة تفصيل واحدة) فلا
            // خطر N+1 حقيقي يوازي القائمة المُرقَّمة.
            $activeVariants = $product->variants()
                ->where('is_active', true)
                ->with('optionValues.option')
                ->get();

            $variantPayload = [];
            $cheapest = null;
            $anyInStock = null;
            foreach ($activeVariants as $variant) {
                $variantPrice = $prices->resolve($id, $channelId, null, null, false, $variant->id);
                if ($variantPrice->amount !== null && ($cheapest === null || $variantPrice->amount < $cheapest)) {
                    $cheapest = $variantPrice->amount;
                }

                $variantInStock = null;
                if ($warehouse !== null) {
                    $variantInStock = $availability->forWarehouse($id, $warehouse->id, $variant->id)->availableToSell > 0;
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
                    'media' => StorefrontProductResource::mediaPayload($galleryService->resolveGallery($product, $variant), $tenantSlug),
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

            $galleryMedia = StorefrontProductResource::mediaPayload($galleryService->resolveGallery($product), $tenantSlug);

            $resource = new StorefrontProductResource(
                $product,
                $cheapest ?? 0,
                $currency,
                $anyInStock,
                true,
                $tenantSlug,
                $galleryMedia,
                $optionsPayload,
                $variantPayload,
            );
        } else {
            $price = $prices->resolve($id, $channelId);

            $inStock = null;
            if ($warehouse !== null) {
                $inStock = $availability->forWarehouse($id, $warehouse->id)->availableToSell > 0;
            }

            $galleryMedia = StorefrontProductResource::mediaPayload($galleryService->resolveGallery($product), $tenantSlug);

            $resource = new StorefrontProductResource(
                $product,
                (int) ($price->amount ?? $product->sale_price),
                $price->currency,
                $inStock,
                true,
                $tenantSlug,
                $galleryMedia,
            );
        }

        // FLOWERS-H8 / ADR-20 — وعد التسليم المشتق؛ المفتاح غائب حين الجدولة معطَّلة على القناة.
        $promise = app(CommerceDeliveryPromiseService::class)
            ->forProducts($channelId, [$product], $destination['city'] ?? null, $destination['region'] ?? null);
        $resource->withDeliveryPromise($promise[$product->id] ?? null);
        $resource->withPersonalization(app(ProductPersonalizationService::class)->publicFields($id));
        $resource->withContentBlocks(app(ProductContentService::class)->publicBlocks($id));
        $resource->withAddons(app(ProductAddonService::class)->publicAddons($id, $channelId, $currency, $tenantSlug, $warehouse));

        return PublicApiResponse::resource($request, $resource);
    }

    /**
     * توفّر مجمّعة لصفحة منتجات كاملة: استعلامان مجمّعان (On Hand، محجوز نشط)
     * بدل استدعاء `AvailableToSellService::forWarehouse()` لكل صفّ — تطبيقٌ
     * لصيغة ADR-02 نفسها (`max(0, On Hand - Active Reserved)`) بلا N+1.
     * يعيد `null` لكل المنتجات إن كانت القناة بلا سياسة تنفيذ مضبوطة (توفر
     * غير معروف، لا `false` كاذب).
     *
     * @param  Collection<int, Product>  $products
     * @return array<string, bool|null>
     */
    private function batchAvailability(Collection $products, string $channelId): array
    {
        $ids = $products->pluck('id')->all();
        if ($ids === []) {
            return [];
        }

        try {
            $warehouse = app(FulfillmentPolicyService::class)->resolveWarehouseFor($channelId);
        } catch (FulfillmentPolicyNotConfiguredException) {
            return array_fill_keys($ids, null);
        }

        // VAR-COM-1: منتجٌ متعدد الخيارات يحمل صفّاً مستقلاً لكل متغيّرٍ فعلي
        // في `product_warehouse_stock` (VAR-INV-1) — `pluck('quantity',
        // 'product_id')` كانت ستكتفي بآخر صفٍّ فقط لنفس المنتج فتُخفي مخزون
        // بقية المتغيّرات خطأً؛ `sum()` مجمَّعةٌ بـ`product_id` تجمع كل صفوف
        // المنتج (متغيّراته + صفّه البسيط إن وُجد) معاً. توفّرٌ إجماليٌّ على
        // مستوى المنتج فقط (لا تفصيل لكل متغيّر هنا) — هذا بالضبط دقة `in_stock`
        // المنطوقة في عقد هذه القائمة أصلاً؛ التفصيل الحقيقي لكل متغيّرٍ في
        // `show()`.
        $onHand = ProductWarehouseStock::query()
            ->where('warehouse_id', $warehouse->id)
            ->whereIn('product_id', $ids)
            ->selectRaw('product_id, sum(quantity) as on_hand_qty')
            ->groupBy('product_id')
            ->pluck('on_hand_qty', 'product_id');

        $reserved = InventoryReservation::query()
            ->where('warehouse_id', $warehouse->id)
            ->where('status', InventoryReservation::STATUS_ACTIVE)
            ->whereIn('product_id', $ids)
            ->selectRaw('product_id, sum(base_quantity) as reserved_qty')
            ->groupBy('product_id')
            ->pluck('reserved_qty', 'product_id');

        $result = [];
        foreach ($ids as $productId) {
            $available = max(0, (int) ($onHand[$productId] ?? 0) - (int) ($reserved[$productId] ?? 0));
            $result[$productId] = $available > 0;
        }

        return $result;
    }
}
