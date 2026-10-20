<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontProductResource;
use App\Models\CommerceCategoryListing;
use App\Models\CommerceListing;
use App\Models\InventoryReservation;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\FulfillmentPolicyNotConfiguredException;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\ProductMediaGalleryService;
use App\Services\Commerce\CommerceDeliveryScheduleService;
use App\Models\CommerceDeliverySlot;
use App\Services\Commerce\StorefrontFacetVisualProjector;
use App\Support\Commerce\CatalogFacetFilter;
use App\Support\Commerce\DeliverTodayFilter;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Validation\Rule;

/**
 * CUST-H2-3 — قراءة منتجات مساحة عمل Commerce للمعاينة داخل مُخصِّص صفحة
 * المنتج (Preview Product picker). **قراءة فقط**؛ لا يوجد فعلٌ كتابي هنا،
 * ولا سلطة سعر/مخزون/نشر — معرّف المنتج مُحدِّدٌ (selector) لا سلطة.
 *
 * **الفجوة التي يغلقها هذا المتحكّم**: `docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`
 * ووثيقتا الأدلة/التقرير الملحقتان أكَّدت أنه لا يوجد اليوم مساراً مُصادَقاً
 * ضمن مساحة عمل Commerce (`commerce.manage`) لقراءة المنتجات. `CommerceProductController`
 * قائمٌ فعلاً لكنه موصولٌ حصراً تحت سلسلة مصادقة الجوال/العامة (`AuthenticateApiClient`
 * عبر `routes/api_commerce.php`) — سلسلةٌ مختلفة تماماً عن سلسلة مساحة عمل
 * Commerce الموثَّقة التي يعمل تحتها المُخصِّص نفسه. هذا المتحكّم **جديد ورفيع**،
 * يعيد استخدام نفس سلطات النشر/السعر/التوفر/الوسائط
 * (`CommercePriceResolver`/`AvailableToSellService`/`FulfillmentPolicyService`/
 * `ProductMediaGalleryService`) ونفس مورد العرض العام (`StorefrontProductResource`،
 * الذي يستثني التكلفة/الهامش/المورّد/المخزون الخام أصلاً) بدل تكرار أيٍّ من
 * منطقها — يطابق نمط `CommerceProductController::show()` حرفياً، فرقه الوحيد
 * حلّ القناة من **متجرٍ مملوكٍ لهذا المستأجر تحديداً** (`ownedStorefront()`،
 * بنفس نمط `StorefrontPresentationVersionService::ownedStorefront()`) بدل
 * `StorefrontContext` المحلولة من مضيف الطلب.
 *
 * **قاعدة الأهلية**: منتجٌ مؤهَّل للمعاينة على متجرٍ بعينه إن وفقط إن كان
 * نشطاً (`is_active = true`) وله `CommerceListing` منشور (`is_published = true`)
 * على **نفس قناة بيع هذا المتجر تحديداً** (`Storefront.sales_channel_id`) —
 * القاعدة نفسها التي يفرضها `/commerce/v1/products` اليوم على قناته المحلولة،
 * مُطبَّقة هنا على قناة المتجر المفتوح في المُخصِّص بدل القناة المحلولة من
 * الاستضافة. مستأجرٌ آخر، ومنتجٌ من نفس المستأجر غير منشور على قناة هذا
 * المتجر بعينها (بما فيه منشورٌ على قناة *أخرى* لنفس المستأجر) → 404 لا 403،
 * بلا تسريب وجود جزئي — يطابق نمط `ownedStorefront()`/`findOwnedVersion()`
 * تماماً.
 *
 * **الحمولة**: القائمة مُصغَّرة عمداً (مُعرِّف/اسم/صورة مصغَّرة/مؤشّر متغيّرات
 * مع سعر/عملة وتوفر مشتقّين للبطاقات) — لا حمولة منتج كاملة لمجرَّد منتقٍ. التفصيل يعيد استخدام
 * `StorefrontProductResource` نفسه الذي يستثني أصلاً كل حقل تكلفة/هامش/مورّد/
 * مخزون داخلي (راجع تعليق ذلك المورد).
 *
 * **CUST-H4-3 — `sort=newest`**: إضافيٌّ واختياري بالكامل. عند غيابه يبقى
 * الفرز الافتراضي (الاسم) كما هو حرفياً لكل مستدعٍ قائم (منتقي صفحة المنتج،
 * حقل معرّفات Featured الخام). مُخصِّص الواجهة يستعمله فقط لمعاينة قسم «وصل
 * حديثاً» الحقيقي على الصفحة الرئيسية، ليطابق ترتيب `-available_on` (→
 * `created_at` تنازلياً) الذي تستعمله الواجهة المنشورة فعلاً
 * (`StorefrontProductController`/`NewArrivals.tsx`) — لا معنى جديد يُخترع هنا.
 *
 * **CUST-H4-5 — `ids[]`**: إضافيٌّ واختياري بالكامل، لمنتقي/معاينة قسم
 * «منتجات مميّزة» الحقيقي على الصفحة الرئيسية. يحلّ دفعة واحدة محدودة
 * (≤8، مطابقةً لـ`MAX_FEATURED_PRODUCTS` في عقد المحتوى بالواجهة) من
 * معرّفات منتجات مُخزَّنة في تهيئة العرض، بدل طلبٍ مستقلٍّ لكل معرّف (N+1).
 * يتركّب فوق بوابة الأهلية القائمة (نشط + منشور على قناة *هذا* المتجر) بـ
 * `whereIn` إضافية — لا يُغيّرها ولا يتجاوزها؛ معرّفٌ أجنبي أو غير مؤهَّل
 * يسقط من النتيجة صمتاً (لا تسريب، لا خطأ) تماماً كما يفعل الفشل الجزئي في
 * المعاينة اليوم. الحمولة نفسها (`WorkspaceProductSummary`) مع الحقول العامة الإضافية.
 */
class CommerceWorkspaceStorefrontProductController extends ApiController
{
    private const PER_PAGE_DEFAULT = 20;

    private const PER_PAGE_MAX = 50;

    /** يطابق `MAX_FEATURED_PRODUCTS` في `section-content.ts` (كلا النسختين) — مصدر الحد نفسه. */
    private const IDS_FILTER_MAX = 8;

    public function index(Request $request, string $id): JsonResponse
    {
        $this->denySelfService($request);

        $storefront = $this->ownedStorefront($id);
        if ($storefront === null) {
            abort(404, 'المتجر غير موجود.');
        }

        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'category_id' => ['sometimes', 'nullable', 'uuid'],
            // CUST-H4-3 — Canvas's "New Arrivals" home-section preview needs
            // the same recency ordering `StorefrontProductController`'s
            // public `-available_on` sort (→ `created_at` desc) already
            // gives Published (`NewArrivals.tsx`). Additive and opt-in only:
            // every existing caller (Featured's raw-id input, the Product/
            // Category preview pickers) omits `sort` and keeps today's
            // alphabetical order unchanged.
            'sort' => ['sometimes', 'nullable', 'string', 'in:newest'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:'.self::PER_PAGE_MAX],
            'ids' => ['sometimes', 'array', 'max:'.self::IDS_FILTER_MAX],
            'ids.*' => ['uuid'],
            // FLOWERS-H9c / ADR-21 — additive filters used by the approved
            // section-data preview contract. Existing callers omit these.
            'city' => ['sometimes', 'nullable', 'string', 'max:120'],
            'region' => ['sometimes', 'nullable', 'string', 'max:120'],
            'include_meta' => ['sometimes', 'nullable', Rule::in(['1', '0', 'true', 'false', 1, 0, true, false])],
            ...DeliverTodayFilter::rules(),
            ...CatalogFacetFilter::rules(),
        ]);

        $query = Product::query()
            // The storefront catalogue is company-wide: publication belongs to
            // this storefront's sales channel, not to whichever operational
            // branch the merchant currently has selected in the back office.
            // TenantScope remains active, and ownedStorefront() + the channel
            // publication subquery below are the two explicit authority gates.
            ->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->whereIn('id', CommerceListing::query()
                ->where('sales_channel_id', $storefront->sales_channel_id)
                ->where('is_published', true)
                ->select('product_id'));

        if (filled($filters['ids'] ?? null)) {
            $query->whereIn('id', array_values(array_unique($filters['ids'])));
        }

        if (($filters['sort'] ?? null) === 'newest') {
            $query->orderByDesc('created_at')->orderByDesc('id');
        } else {
            $query->orderBy('name')->orderBy('id');
        }

        if (filled($filters['search'] ?? null)) {
            $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], (string) $filters['search']).'%';
            $query->where(fn ($q) => $q
                ->where('name', 'like', $like)
                ->orWhere('name_en', 'like', $like)
                ->orWhere('sku', 'like', $like));
        }

        if (filled($filters['category_id'] ?? null)) {
            // CUST-H2-4 — يغذّي معاينة منطقة `product_grid` الحقيقية في
            // مُخصِّص صفحة التصنيف بمنتجات فعلية منتمية لتصنيفٍ بعينه، بنفس
            // بوابة نشر التصنيف الموثوقة التي يطبّقها `CommerceProductController`
            // العام حرفياً (تصنيفٌ غير منشور على هذه القناة تحديداً → نتيجة
            // فارغة حتمية، لا خطأ) — استقلالية كاملة عن بوابة نشر المنتج نفسه.
            $categoryId = (string) $filters['category_id'];
            $query->where('category_id', $categoryId);
            $categoryPublished = CommerceCategoryListing::publishedOn($storefront->sales_channel_id)
                ->where('category_id', $categoryId)
                ->exists();
            if (! $categoryPublished) {
                $query->whereRaw('0 = 1');
            }
        }

        // The public storefront applies collection context first, then its
        // derived deliver-today filter, then the selected facet/brand filters.
        // Reuse the same filter authority here so a shelf cannot preview a
        // product that the published channel would omit.
        $facetFilter = new CatalogFacetFilter();
        $facetSelection = CatalogFacetFilter::selection($filters);
        $facetFilter->applyCollection($query, $facetSelection);
        if (DeliverTodayFilter::requested($filters)) {
            app(DeliverTodayFilter::class)->apply(
                $query,
                $storefront->sales_channel_id,
                $filters['city'] ?? null,
                $filters['region'] ?? null,
            );
        }
        $baseQuery = clone $query;
        $facetFilter->apply($query, $facetSelection);

        if ($facetSelection['collection'] !== null && blank($filters['sort'] ?? null)) {
            $query->reorder();
            $facetFilter->orderByCollectionPosition($query, $facetSelection);
            $query->orderBy('name')->orderBy('id');
        }

        $perPage = min((int) ($filters['per_page'] ?? self::PER_PAGE_DEFAULT), self::PER_PAGE_MAX);
        $paginator = $query->paginate($perPage, ['*'], 'page', (int) ($filters['page'] ?? 1));

        $gallery = app(ProductMediaGalleryService::class);
        $currency = Tenant::findOrFail($storefront->tenant_id)->currency;
        $inStockByProduct = $this->batchAvailability($paginator->getCollection(), $storefront->sales_channel_id);
        $data = $paginator->getCollection()->map(function (Product $product) use ($gallery, $storefront, $currency, $inStockByProduct) {
            $media = StorefrontProductResource::workspaceMediaPayload($gallery->resolveGallery($product), $storefront->id);

            return [
                'id' => $product->id,
                'name' => $product->name,
                'name_en' => $product->name_en,
                'thumbnail_url' => $media[0]['url'] ?? null,
                'is_variant_managed' => $product->isVariantManaged(),
                // Keep list cards aligned with the public catalogue contract.
                // Variant products intentionally expose no guessed parent price.
                'price' => [
                    'amount_minor' => $product->isVariantManaged() ? null : (int) $product->sale_price,
                    'currency' => $currency,
                ],
                'in_stock' => $inStockByProduct[$product->id] ?? null,
            ];
        })->all();

        $meta = [
            'pagination' => [
                'page' => $paginator->currentPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'last_page' => $paginator->lastPage(),
                'has_more' => $paginator->hasMorePages(),
            ],
        ];
        if (filter_var($filters['include_meta'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            $facetMeta = $facetFilter->meta($baseQuery, $facetSelection);
            $meta = [
                ...$facetMeta,
                'facets' => app(StorefrontFacetVisualProjector::class)->project(
                    $facetMeta['facets'],
                    $facetFilter->activeFacetModels(),
                    true,
                    (string) $storefront->tenant_id,
                ),
                ...$meta,
            ];
        }

        return response()->json([
            'data' => $data,
            'meta' => $meta,
        ]);
    }

    /**
     * FLOWERS-H9c / ADR-21 — one read-only, editor-scoped contract for the
     * three sections whose published data is resolved at request time. This
     * adapter delegates product/facet work to the existing index authority
     * and delivery work to CommerceDeliveryScheduleService; it never returns
     * costs, raw inventory, supplier data, or write-capable controls.
     */
    public function sectionData(Request $request, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $storefront = $this->ownedStorefront($id);
        if ($storefront === null) {
            abort(404, 'المتجر غير موجود.');
        }

        $section = $request->validate([
            'section' => ['required', Rule::in(['product_shelf', 'discovery', 'delivery_promise'])],
            'source_kind' => ['sometimes', 'nullable', Rule::in(['collection', 'facet'])],
            'source_slug' => ['sometimes', 'nullable', 'string', 'max:64'],
            'source_key' => ['sometimes', 'nullable', 'string', 'max:64'],
            'source_value' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'limit' => ['sometimes', 'nullable', 'integer', 'min:2', 'max:12'],
            'axis' => ['sometimes', 'nullable', Rule::in(['brand', 'facet'])],
            'dimension' => ['sometimes', 'nullable', 'string', 'max:64'],
            'method' => ['sometimes', Rule::in(CommerceDeliverySlot::METHODS)],
            'city' => ['sometimes', 'nullable', 'string', 'max:120'],
            'region' => ['sometimes', 'nullable', 'string', 'max:120'],
            ...DeliverTodayFilter::rules(),
        ]);

        if ($section['section'] === 'product_shelf') {
            $sourceKind = $section['source_kind'] ?? null;
            if ($sourceKind === 'collection') {
                abort_if(blank($section['source_slug'] ?? null), 422, 'مصدر الرف غير مكتمل.');
                $request->merge(['collection' => $section['source_slug']]);
            } elseif ($sourceKind === 'facet') {
                abort_if(blank($section['source_key'] ?? null) || blank($section['source_value'] ?? null), 422, 'مصدر الرف غير مكتمل.');
                $request->merge(['facet' => [$section['source_key'] => $section['source_value']]]);
            }
            $request->merge([
                'per_page' => (int) ($section['limit'] ?? 8),
                'page' => 1,
            ]);

            return $this->index($request, $id);
        }

        if ($section['section'] === 'discovery') {
            abort_if(blank($section['axis'] ?? null), 422, 'محور الاكتشاف غير مكتمل.');
            if ($section['axis'] === 'facet') {
                abort_if(blank($section['dimension'] ?? null), 422, 'بُعد الاكتشاف غير مكتمل.');
            }
            $request->merge(['per_page' => 1, 'include_meta' => 'true', 'page' => 1]);
            $payload = $this->index($request, $id)->getData(true);
            $meta = (array) ($payload['meta'] ?? []);
            if ($section['axis'] === 'brand') {
                return response()->json(['data' => [
                    'axis' => 'brand',
                    'name' => '',
                    'options' => array_map(static fn (array $brand): array => [
                        'value' => (string) ($brand['id'] ?? ''),
                        'name' => (string) ($brand['name'] ?? ''),
                        'count' => (int) ($brand['count'] ?? 0),
                    ], array_values(array_filter((array) ($meta['brands'] ?? []), static fn ($row): bool => is_array($row)))),
                ]]);
            }
            $facet = collect((array) ($meta['facets'] ?? []))->firstWhere('key', $section['dimension']);
            if (! is_array($facet)) {
                return response()->json(['data' => null]);
            }

            return response()->json(['data' => [
                'axis' => 'facet',
                'dimension' => $facet['key'],
                'name' => $facet['name'] ?? '',
                'name_en' => $facet['name_en'] ?? null,
                'visual' => $facet['visual'] ?? null,
                'options' => array_map(static fn (array $value): array => [
                    'value' => (string) ($value['slug'] ?? ''),
                    'name' => (string) ($value['name'] ?? ''),
                    'name_en' => $value['name_en'] ?? null,
                    'count' => (int) ($value['count'] ?? 0),
                    'visual' => $value['visual'] ?? null,
                ], array_values(array_filter((array) ($facet['values'] ?? []), static fn ($row): bool => is_array($row)))),
            ]]);
        }

        $options = app(CommerceDeliveryScheduleService::class)->options(
            $storefront->sales_channel_id,
            $section['method'] ?? CommerceDeliverySlot::METHOD_DELIVERY,
            $section['city'] ?? null,
            $section['region'] ?? null,
        );
        $earliest = null;
        if (($options['enabled'] ?? false) && is_array($options['earliest'] ?? null)) {
            $date = $options['earliest']['date'] ?? null;
            $slotId = $options['earliest']['slot_id'] ?? null;
            foreach ((array) ($options['dates'] ?? []) as $day) {
                if (($day['date'] ?? null) !== $date) continue;
                foreach ((array) ($day['slots'] ?? []) as $slot) {
                    if (($slot['id'] ?? null) !== $slotId) continue;
                    $earliest = [
                        'date' => $date,
                        'start_time' => $slot['start_time'] ?? null,
                        'end_time' => $slot['end_time'] ?? null,
                        'label' => $slot['label'] ?? '',
                        'label_en' => $slot['label_en'] ?? null,
                        'timezone' => $options['timezone'] ?? null,
                    ];
                    break 2;
                }
            }
        }

        return response()->json(['data' => ['earliest' => $earliest]]);
    }

    /** @return array<string, bool|null> */
    private function batchAvailability(Collection $products, string $channelId): array
    {
        $ids = $products->pluck('id')->all();
        if ($ids === []) return [];

        try {
            $warehouse = app(FulfillmentPolicyService::class)->resolveWarehouseFor($channelId);
        } catch (FulfillmentPolicyNotConfiguredException) {
            return array_fill_keys($ids, null);
        }

        $onHand = ProductWarehouseStock::query()
            ->where('warehouse_id', $warehouse->id)->whereIn('product_id', $ids)
            ->selectRaw('product_id, sum(quantity) as on_hand_qty')->groupBy('product_id')
            ->pluck('on_hand_qty', 'product_id');
        $reserved = InventoryReservation::query()
            ->where('warehouse_id', $warehouse->id)->where('status', InventoryReservation::STATUS_ACTIVE)
            ->whereIn('product_id', $ids)->selectRaw('product_id, sum(base_quantity) as reserved_qty')
            ->groupBy('product_id')->pluck('reserved_qty', 'product_id');

        $result = [];
        foreach ($ids as $productId) {
            $result[$productId] = max(0, (int) ($onHand[$productId] ?? 0) - (int) ($reserved[$productId] ?? 0)) > 0;
        }
        return $result;
    }

    public function show(
        Request $request,
        CommercePriceResolver $prices,
        FulfillmentPolicyService $fulfillment,
        AvailableToSellService $availability,
        ProductMediaGalleryService $gallery,
        string $id,
        string $product,
    ): JsonResponse {
        $this->denySelfService($request);

        $storefront = $this->ownedStorefront($id);
        if ($storefront === null) {
            abort(404, 'المتجر غير موجود.');
        }

        $channelId = $storefront->sales_channel_id;

        $isEligible = CommerceListing::query()
            ->where('product_id', $product)
            ->where('sales_channel_id', $channelId)
            ->where('is_published', true)
            ->exists();

        if (! $isEligible) {
            abort(404, 'المنتج غير موجود.');
        }

        $productModel = Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->with(['productCategory' => fn ($q) => $q
                ->withoutGlobalScope(BranchScope::class)
                ->select(['id', 'name'])])
            ->find($product);

        if ($productModel === null) {
            abort(404, 'المنتج غير موجود.');
        }

        $currency = Tenant::findOrFail($storefront->tenant_id)->currency;

        $warehouse = null;
        try {
            $warehouse = $fulfillment->resolveWarehouseFor($channelId);
        } catch (FulfillmentPolicyNotConfiguredException) {
            $warehouse = null;
        }

        $resource = $productModel->isVariantManaged()
            ? $this->variantResource($request, $productModel, $storefront->id, $channelId, $currency, $warehouse, $prices, $availability, $gallery)
            : $this->simpleResource($request, $productModel, $storefront->id, $channelId, $currency, $warehouse, $prices, $availability, $gallery);

        return response()->json(['data' => $resource]);
    }

    /** @return array<string, mixed> */
    private function simpleResource(
        Request $request,
        Product $product,
        string $storefrontId,
        string $channelId,
        string $currency,
        $warehouse,
        CommercePriceResolver $prices,
        AvailableToSellService $availability,
        ProductMediaGalleryService $gallery,
    ): array {
        $resolved = $prices->resolve($product->id, $channelId);
        $price = (int) ($resolved->amount ?? $product->sale_price);

        $inStock = null;
        if ($warehouse !== null) {
            $inStock = $availability->forWarehouse($product->id, $warehouse->id)->availableToSell > 0;
        }

        $galleryMedia = StorefrontProductResource::workspaceMediaPayload($gallery->resolveGallery($product), $storefrontId);

        return (new StorefrontProductResource($product, $price, $currency, $inStock, true, null, $galleryMedia))->resolve($request);
    }

    /**
     * مطابقٌ لـ `CommerceProductController::variantResource()` — لا يُكرَّر
     * منطق تسعير/توفر/متغيّر هنا، فقط يُستدعى عبر نفس السلطات.
     *
     * @return array<string, mixed>
     */
    private function variantResource(
        Request $request,
        Product $product,
        string $storefrontId,
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
                'option_value_ids' => $optionValueIds,
                'price' => ['amount_minor' => $variantPrice->amount ?? 0, 'currency' => $currency],
                'in_stock' => $variantInStock,
                'media' => StorefrontProductResource::workspaceMediaPayload($gallery->resolveGallery($product, $variant), $storefrontId),
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

        $galleryMedia = StorefrontProductResource::workspaceMediaPayload($gallery->resolveGallery($product), $storefrontId);

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

    /**
     * مطابقٌ لنمط `StorefrontPresentationVersionService::ownedStorefront()`
     * تماماً: السلطة من `TenantContext` وحده، لا معرّف واردٍ من الطلب. متجرٌ
     * أجنبي أو غير موجود → `null` هنا، فيتحوّل المستدعي دوماً إلى 404 صريح.
     */
    private function ownedStorefront(string $storefrontId): ?Storefront
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            return null;
        }

        $storefront = Storefront::query()->find($storefrontId);
        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        return $storefront;
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
