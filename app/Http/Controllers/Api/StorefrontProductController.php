<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontProductResource;
use App\Models\CommerceListing;
use App\Models\InventoryReservation;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Tenant;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\FulfillmentPolicyNotConfiguredException;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Support\PublicApiResponse;
use App\Tenancy\BranchScope;
use App\Tenancy\StorefrontContext;
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

    public function index(Request $request): JsonResponse
    {
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
            ->with([
                'productCategory:id,name',
                'media' => fn ($q) => $q->orderBy('sort_order'),
            ]);

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
        $inStockByProduct = $this->batchAvailability($paginator->getCollection(), $channelId);
        // `null` على المسار الموثوق (لا شريحة رابط في COM-7-P2A) — المورد يبني
        // رابط الوسائط من المسار المناسب وفق ذلك (راجع StorefrontProductResource).
        $tenantSlug = $request->route('tenantSlug');

        // السعر لتصفّح مجهول (بلا partnerId) مطابقٌ حتماً لناتج
        // CommercePriceResolver::resolve() في هذه الحالة: لا قائمة سعر عميل
        // تُحلّ بلا partnerId، والوحدة غير محدَّدة تعني وحدة الأساس دائماً —
        // فرعا الحسم الوحيدان الممكنان هما SOURCE_PRODUCT_DEFAULT (sale_price)
        // فقط. نقرأه مباشرةً هنا لتفادي استدعاء المُحلِّل لكل صفّ (N+1)؛
        // `show()` يستدعي المُحلِّل نفسه لأن N=1 هناك. اختبارٌ مخصّص يثبّت
        // تطابق النتيجتين.
        $data = $paginator->getCollection()->map(fn (Product $product) => (new StorefrontProductResource(
            $product,
            (int) $product->sale_price,
            $currency,
            $inStockByProduct[$product->id] ?? null,
            false,
            $tenantSlug,
        ))->resolve($request))->all();

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
        // يُقرأ صراحةً من الطلب لا كوسيط مربوط بالاسم: مع وجود `{tenantSlug}`
        // غير مُعلَنة في التوقيع بجانب اعتماديات مُحقَّنة أخرى، حسم Laravel
        // لمواضع معاملات الطريق يصبح هشّاً (رُصد تجريبياً ربطه بقيمة خاطئة).
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
            ->with([
                'productCategory:id,name',
                'media' => fn ($q) => $q->orderBy('sort_order'),
            ])
            ->find($id);

        if ($product === null) {
            abort(404, 'المنتج غير موجود [not-found].');
        }

        $price = $prices->resolve($id, $channelId);

        $inStock = null;
        try {
            $warehouse = $fulfillment->resolveWarehouseFor($channelId);
            $snapshot = $availability->forWarehouse($id, $warehouse->id);
            $inStock = $snapshot->availableToSell > 0;
        } catch (FulfillmentPolicyNotConfiguredException) {
            $inStock = null;
        }

        $tenantSlug = $request->route('tenantSlug');

        $resource = new StorefrontProductResource(
            $product,
            (int) ($price->amount ?? $product->sale_price),
            $price->currency,
            $inStock,
            true,
            $tenantSlug,
        );

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

        $onHand = ProductWarehouseStock::query()
            ->where('warehouse_id', $warehouse->id)
            ->whereIn('product_id', $ids)
            ->pluck('quantity', 'product_id');

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
