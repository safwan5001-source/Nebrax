<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CollectFuelSalePaymentRequest;
use App\Http\Requests\StoreFuelSaleRequest;
use App\Http\Requests\StoreFuelStationProductPriceRequest;
use App\Http\Resources\FuelSalePaymentMethodResource;
use App\Http\Resources\FuelSaleResource;
use App\Http\Resources\FuelStationProductPriceResource;
use App\Models\FuelProduct;
use App\Models\FuelSale;
use App\Models\FuelStation;
use App\Models\FuelStationProductPrice;
use App\Services\FuelEffectivePriceReadService;
use App\Services\FuelPriceSuggestionService;
use App\Services\FuelSaleService;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * #2016 — كل مسار بيع/تحصيل/طرق دفع/أسعار يمرّ بحارس نطاق المحطة (فرع + مخزن) على الخادم قبل أي أثر:
 * `FuelSale` BranchScoped (فرع فقط) و`FuelStation` CompanyWide، فبلا `AuthorizesFuelStationScope` كان مستخدم مقيَّد بمخزن/محطة
 * داخل الفرع نفسه يقرأ ويُنشئ ويُنهي (فاتورة + COGS + مخزون) ويحصّل (سند قبض) على محطة أخرى بمجرد معرفة المعرّف.
 * الرفض 404 موحّد، وغير المقيَّد لا يتأثر. الأسعار محروسة منذ #2010/#2019 وتبقى كما هي.
 */
class FuelSaleController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(
        private FuelSaleService $sales,
        private FuelStationProductPriceService $prices,
        private FuelStationSettingsService $settings,
        private FuelEffectivePriceReadService $effectivePrices,
        private FuelPriceSuggestionService $suggestions,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = FuelSale::query()->with(['invoice', 'paymentReceipts.payment'])->orderByDesc('created_at');
        if ($request->filled('station_id')) {
            $query->where('fuel_station_id', $request->query('station_id'));
        }
        if ($request->filled('shift_id')) {
            $query->where('fuel_shift_id', $request->query('shift_id'));
        }
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }

        // #2016: محطات المستخدم (فرع + مخزن) — `FuelSale` BranchScoped فرعاً فقط، فبلا هذا تظهر مبيعات محطة أخرى من الفرع نفسه.
        $this->restrictToAccessibleStations($query);

        return FuelSaleResource::collection($this->scopeToActiveBranch($query, $request)->paginate(50))->response();
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new FuelSaleResource($this->present($this->visibleSale($id, $request))))->response();
    }

    public function store(StoreFuelSaleRequest $request): JsonResponse
    {
        // قبل الخدمة: محطة خارج فرع/مخزن المستخدم (أو مستأجر آخر) = 404 موحّد بلا أي أثر.
        $this->accessibleStation($request->validated()['fuel_station_id']);
        $sale = $this->domain(fn () => $this->sales->createDraft($request->validated(), $request->user()));

        return (new FuelSaleResource($this->present($sale)))->response()->setStatusCode(201);
    }

    public function finalize(Request $request, string $id): JsonResponse
    {
        $sale = $this->visibleSale($id, $request);
        $finalized = $this->domain(fn () => $this->sales->finalize($sale, $request->user()));

        return (new FuelSaleResource($this->present($finalized)))->response();
    }

    public function collectPayment(CollectFuelSalePaymentRequest $request, string $id): JsonResponse
    {
        $sale = $this->visibleSale($id, $request);
        $this->domain(fn () => $this->sales->collectPayment($sale, $request->validated(), $request->user()));

        return (new FuelSaleResource($this->present($sale->fresh())))->response()->setStatusCode(201);
    }

    /** طرق التحصيل الفعالة لهذه المحطة فقط؛ لا تعتمد الواجهة على قائمة عامة ثم تُرفض لاحقاً. */
    public function paymentMethods(Request $request, string $stationId): JsonResponse
    {
        $station = $this->scopeToActiveBranch(FuelStation::query(), $request)->findOrFail($stationId);
        $this->assertRecordAccessible($station->branch_id, [$station->warehouse_id]); // #2016
        $methods = app(\App\Services\FuelStationPaymentMethods::class)->allowedFor($station);

        return FuelSalePaymentMethodResource::collection($methods)->response();
    }

    /**
     * سجل أسعار الوقود (تاريخي). نطاق المحطة يُفرض خادمياً (#1998): صفوف محطات خارج نطاق المستخدم لا تُعاد،
     * وسعر المؤسسة الافتراضي (`fuel_station_id IS NULL`) يبقى مرئياً. لا تحسم هذه القراءة السعر الفعّال —
     * استعمل `effectiveIndex` فهو المصدر نفسه الذي يستعمله البيع.
     */
    public function priceIndex(Request $request): JsonResponse
    {
        $data = $request->validate([
            'station_id' => ['nullable', 'uuid'],
            'fuel_product_id' => ['nullable', 'uuid'],
            'scope' => ['nullable', 'in:station,tenant_default'],
        ]);
        if (($data['scope'] ?? null) === 'tenant_default' && ! empty($data['station_id'])) {
            abort(422, 'لا يجمع scope=tenant_default مع station_id.');
        }

        $query = FuelStationProductPrice::query()->orderByDesc('effective_from');
        if (! empty($data['station_id'])) {
            // 404 موحّد لمحطة غير موجودة أو خارج فروع/مخازن المستخدم (عقد assertRecordAccessible).
            $this->accessibleStation($data['station_id']);
            $query->where('fuel_station_id', $data['station_id']);
        } else {
            $accessible = $this->accessibleStationsQuery();
            if ($accessible !== null) {
                $query->where(fn ($q) => $q->whereNull('fuel_station_id')->orWhereIn('fuel_station_id', $accessible));
            }
        }
        if (($data['scope'] ?? null) === 'tenant_default') {
            $query->whereNull('fuel_station_id');
        } elseif (($data['scope'] ?? null) === 'station') {
            $query->whereNotNull('fuel_station_id');
        }
        if (! empty($data['fuel_product_id'])) {
            $query->where('fuel_product_id', $data['fuel_product_id']);
        }

        return FuelStationProductPriceResource::collection($query->paginate(50))->response();
    }

    /**
     * السعر الفعّال الآن لمنتجات وقود محطة — الخادم يحسم الزمن والأولوية والضريبة (لا المتصفح).
     * نفس `FuelStationProductPriceService::resolve` الذي يعتمده إنهاء البيع. قراءة فقط.
     */
    public function effectiveIndex(Request $request): JsonResponse
    {
        $data = $request->validate([
            'station_id' => ['nullable', 'uuid'],
            'scope' => ['nullable', 'in:tenant_default'],
            'fuel_product_id' => ['nullable', 'uuid'],
        ]);
        $tenantScope = ($data['scope'] ?? null) === 'tenant_default';
        if ($tenantScope === ! empty($data['station_id'])) { // الاثنان معاً أو لا واحد منهما
            abort(422, 'حدّد station_id أو scope=tenant_default (واحداً منهما).');
        }
        $station = $tenantScope ? null : $this->accessibleStation($data['station_id']);

        $products = $this->fuelProductsFor($data['fuel_product_id'] ?? null);
        $rows = $station === null
            ? $this->effectivePrices->forTenant($products, now())
            : $this->effectivePrices->forStation($station, $products, now());

        return response()->json(['data' => $rows]);
    }

    /**
     * اقتراح أسعار لتر من بطاقة المنتج — قراءة فقط، لمن يملك `fuel.sale.price.manage`. لا ينقل شيئاً؛ الحفظ بـ`storePrice` مع `source` وإقرار صريح.
     */
    public function suggestionIndex(Request $request): JsonResponse
    {
        $data = $request->validate(['station_id' => ['nullable', 'uuid'], 'fuel_product_id' => ['nullable', 'uuid']]);
        $station = empty($data['station_id']) ? $this->organizationScopeOrFail() : $this->accessibleStation($data['station_id']);

        return response()->json(['data' => $this->suggestions->forScope($station, $this->fuelProductsFor($data['fuel_product_id'] ?? null), now())]);
    }

    /**
     * إضافة فترة سعر رسمية. النطاق يُفرض خادمياً: محطة ضمن نطاق المستخدم (404 وإلا)، أو المؤسسة لغير المقيَّد بفرع/مخزن فقط (403).
     * `source` (اقتراح بطاقة المنتج) يُعاد التحقق منه داخل المعاملة؛ `supersede` صريح؛ `idempotency_key` يمنع التكرار.
     */
    public function storePrice(StoreFuelStationProductPriceRequest $request): JsonResponse
    {
        $data = $request->validated();
        if (! empty($data['fuel_station_id'])) {
            $this->accessibleStation($data['fuel_station_id']);
        } else {
            $this->organizationScopeOrFail();
        }

        $source = $data['source'] ?? null;
        unset($data['source']);
        $beforeWrite = null;
        if ($source !== null) {
            $data['entry_source'] = FuelStationProductPrice::SOURCE_PRODUCT_CARD;
            $data['reason'] = trim('اقتراح من بطاقة المنتج (سعر وحدة اللتر) اعتمده المستخدم بإقرار أساس الضريبة. ' . ($data['reason'] ?? ''));
            $price = (int) $data['price_per_liter_minor'];
            $beforeWrite = fn (FuelProduct $fuelProduct, ?FuelStation $station) => $this->suggestions->assertConfirmed(
                $station, $fuelProduct->loadMissing('product'), $price, $source['confirm_tax_mode'] ?? null, $source['confirm_unit'] ?? null,
            );
        }

        $row = $this->domain(fn () => $this->prices->create($data, $request->user(), $beforeWrite));

        return response()->json([
            'data' => (new FuelStationProductPriceResource($row))->resolve($request),
            'meta' => ['replayed' => $row->replayed, 'superseded_price_ids' => $row->supersededIds],
        ], $row->replayed ? 200 : 201);
    }

    /** سعر المؤسسة يؤثر على كل المحطات، فلا يملكه مستخدم مقيَّد بفرع/مخزن. null = نطاق المؤسسة المسموح. */
    private function organizationScopeOrFail(): ?FuelStation
    {
        $user = request()->user();
        if ($user?->allowedBranchIds() !== null || $user?->allowedWarehouseIds() !== null) {
            abort(403, 'سعر المؤسسة لا يملكه مستخدم مقيَّد بفرع أو مخزن.');
        }

        return null;
    }

    /** @return \Illuminate\Support\Collection<int, FuelProduct> */
    private function fuelProductsFor(?string $fuelProductId)
    {
        $products = $fuelProductId !== null
            ? FuelProduct::query()->with('product')->whereKey($fuelProductId)->get()
            : FuelProduct::query()->with('product')->where('is_active', true)->orderBy('code')->get();
        if ($fuelProductId !== null && $products->isEmpty()) {
            abort(404);
        }

        return $products;
    }

    /** البيع في فروع المستخدم **و** محطته ضمن فرعه/مخزنه — وإلا 404 موحّد قبل أي قراءة أو كتابة (#2016). */
    private function visibleSale(string $id, Request $request): FuelSale
    {
        $sale = $this->scopeToActiveBranch(FuelSale::query(), $request)->findOrFail($id);
        $this->accessibleStation($sale->fuel_station_id);

        return $sale;
    }

    private function present(FuelSale $sale): FuelSale
    {
        return $sale->load(['invoice.lines', 'stockMovement', 'cogsJournalEntry', 'paymentReceipts.payment']);
    }
}
