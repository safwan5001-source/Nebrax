<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontProductResource;
use App\Models\CommerceCategoryListing;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\FulfillmentPolicyNotConfiguredException;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\ProductMediaGalleryService;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
 * فقط) — لا حمولة منتج كاملة لمجرَّد منتقٍ. التفصيل يعيد استخدام
 * `StorefrontProductResource` نفسه الذي يستثني أصلاً كل حقل تكلفة/هامش/مورّد/
 * مخزون داخلي (راجع تعليق ذلك المورد).
 */
class CommerceWorkspaceStorefrontProductController extends ApiController
{
    private const PER_PAGE_DEFAULT = 20;

    private const PER_PAGE_MAX = 50;

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
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:'.self::PER_PAGE_MAX],
        ]);

        $query = Product::query()
            ->where('is_active', true)
            ->whereIn('id', CommerceListing::query()
                ->where('sales_channel_id', $storefront->sales_channel_id)
                ->where('is_published', true)
                ->select('product_id'))
            ->orderBy('name')
            ->orderBy('id');

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

        $perPage = min((int) ($filters['per_page'] ?? self::PER_PAGE_DEFAULT), self::PER_PAGE_MAX);
        $paginator = $query->paginate($perPage, ['*'], 'page', (int) ($filters['page'] ?? 1));

        $gallery = app(ProductMediaGalleryService::class);
        $data = $paginator->getCollection()->map(function (Product $product) use ($gallery) {
            $media = StorefrontProductResource::commerceMediaPayload($gallery->resolveGallery($product));

            return [
                'id' => $product->id,
                'name' => $product->name,
                'name_en' => $product->name_en,
                'thumbnail_url' => $media[0]['url'] ?? null,
                'is_variant_managed' => $product->isVariantManaged(),
            ];
        })->all();

        return response()->json([
            'data' => $data,
            'meta' => [
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
            ->where('is_active', true)
            ->with(['productCategory:id,name'])
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
            ? $this->variantResource($request, $productModel, $channelId, $currency, $warehouse, $prices, $availability, $gallery)
            : $this->simpleResource($request, $productModel, $channelId, $currency, $warehouse, $prices, $availability, $gallery);

        return response()->json(['data' => $resource]);
    }

    /** @return array<string, mixed> */
    private function simpleResource(
        Request $request,
        Product $product,
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

        $galleryMedia = StorefrontProductResource::commerceMediaPayload($gallery->resolveGallery($product));

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
