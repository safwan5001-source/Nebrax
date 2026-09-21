<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ExportInventoryBalancesRequest;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Services\InventoryBalanceExportService;
use App\Services\InventoryWorkspaceQuery;
use App\Support\InventoryBalanceFilters;
use App\Support\InventoryWorkspaceFilters;
use App\Support\Inventory\MovementSourceResolver;
use App\Support\Money;
use App\Support\ReportWarehouseScope;
use App\Support\SensitiveCostPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\Response;

/**
 * تقرير المخزون — قراءة فقط. يعرض أرصدة الأصناف المتتبَّعة وقيمتها (متوسط متحرك)
 * وحركاتها. لا يولّد أي قيد محاسبي ولا يكتب في journal_*؛ القيم محسوبة من حقول
 * المنتج وحركات المخزون المسجلة مسبقاً عبر InventoryService.
 */
class InventoryController extends ApiController
{
    public function __construct(
        protected InventoryBalanceExportService $exports,
        protected InventoryWorkspaceQuery $workspaceQuery,
    ) {}

    public function workspace(Request $request): JsonResponse
    {
        $filters = $request->validate(InventoryWorkspaceFilters::rules());
        $authorizedCost = SensitiveCostPolicy::authorized($request->user());

        if (SensitiveCostPolicy::queryBlocked(
            $filters,
            $filters['sort'] ?? null,
            $authorizedCost,
            [],
            InventoryWorkspaceFilters::COST_SORT_KEYS
        )) {
            abort(403, 'فرز المخزون بحقل تكلفة يحتاج صلاحية عرض التكلفة.');
        }

        $page = $this->workspaceQuery->page($filters, $authorizedCost);
        $paginator = $page['paginator'];

        return response()->json([
            'data' => $page['rows'],
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'can_view_cost' => $page['can_view_cost'],
                'total_quantity' => $page['total_quantity'],
                'total_value' => $page['can_view_cost']
                    ? Money::toRiyal($page['total_value_minor'])
                    : null,
            ],
        ]);
    }

    /**
     * AWJ-PERF-4 — مجمَّع خفيف لقيمة المخزون فقط، للوحة التحكم.
     *
     * لا يحمّل ولا يُسلسل الكتالوج الكامل — استعلام تجميعي واحد (`SUM`) بدل
     * تحميل كل `Product` ونداء أدواته المحسوبة (`quantity_on_hand`/`avg_cost`
     * أصبحا accessors تقرآن من `inventory_states` منذ VAR-INV-1، فكل قراءة
     * منهما استعلامٌ مستقل — حمّل هذا `GET /inventory` القديم (الذي تستهلكه
     * اللوحة اليوم) عشرات آلاف الاستعلامات لكتالوج كبير).
     *
     * **الصيغة تطابق `InventoryReportService::inventoryValue()`** حرفياً
     * (المرجع الأحدث والمُصحَّح لمنتج `variant_managed` — لا يُصفَّر قيمته
     * كما يفعل `Product::avg_cost` القديم، بل يُجمَع من متغيّراته النشطة
     * الفعلية فقط، `product_variants.is_active = true`) — بلا اختراع متوسط
     * تكلفة جديد، فقط تجميع القيم المخزَّنة فعلاً.
     *
     * **نطاق المخزن (AWJ-PERF-4 — إغلاق فجوة الصلاحية):** `ReportWarehouseScope`
     * ليس فلتر عرضٍ اختيارياً — يفرض `User::allowedWarehouseIds()` كحدٍّ أمني
     * (كما في `InventoryWorkspaceQuery`/`ProductWarehouseBalanceQuery`
     * ونفس `InventoryReportService::inventoryValue()` أعلاه). مستخدمٌ مقيَّدٌ
     * بمخزن (حتى لو كان دوره `admin` ويملك `products.view_cost`) يجب ألا يرى
     * قيمة مخزونٍ خارج مخازنه المسموحة عبر هذا الملخّص. `null` = غير مقيَّد
     * (المسار غير المقيَّد يبقى كما كان: مجمَّعٌ من `inventory_states` وحدها).
     * المقيَّد: الكمية من `product_warehouse_stock` مُصفّاة بمخازنه المسموحة
     * فقط (نفس `$scopedQuantities` هناك)، والتكلفة تبقى متوسط `inventory_states`
     * العالمي بلا تغيير — لا تُخترع تكلفةٌ لكل مخزن.
     *
     * نطاق الفرع محفوظ عبر `Product::query()` نفسه (`BranchScoped` الشرطي
     * القائم على المنتج) — تماماً كسلوك `/inventory` القديم الذي تستبدله
     * اللوحة.
     */
    public function summary(Request $request): JsonResponse
    {
        $authorizedCost = SensitiveCostPolicy::authorized($request->user());

        if (! $authorizedCost) {
            return response()->json(['total_value' => null]);
        }

        $warehouseIds = ReportWarehouseScope::resolve([]);

        $totalMinor = $warehouseIds === null
            ? $this->unscopedInventoryValueMinor()
            : $this->warehouseScopedInventoryValueMinor($warehouseIds);

        return response()->json(['total_value' => Money::toRiyal($totalMinor)]);
    }

    /** مستخدمٌ غير مقيَّد بمخزن — القيمة العالمية على `inventory_states` مباشرة. */
    private function unscopedInventoryValueMinor(): int
    {
        return (int) Product::query()
            ->where('products.track_inventory', true)
            ->join('inventory_states', function ($join) {
                $join->on('inventory_states.product_id', '=', 'products.id')
                    ->whereColumn('inventory_states.tenant_id', '=', 'products.tenant_id');
            })
            ->leftJoin('product_variants', function ($join) {
                $join->on('product_variants.id', '=', 'inventory_states.product_variant_id')
                    ->whereColumn('product_variants.tenant_id', '=', 'products.tenant_id');
            })
            ->where(function ($q) {
                $q->whereNull('inventory_states.product_variant_id')
                    ->orWhere('product_variants.is_active', true);
            })
            ->selectRaw('COALESCE(SUM(inventory_states.quantity_on_hand * inventory_states.avg_cost), 0) as total_value_minor')
            ->value('total_value_minor');
    }

    /**
     * مستخدمٌ مقيَّدٌ بمخازن — الكمية من `product_warehouse_stock` ضمن
     * المخازن المسموحة، مضروبة بمتوسط `inventory_states` العالمي لنفس
     * الهويّة (بسيطة أو متغيّر) — يطابق فرع `$warehouseIds !== null` في
     * `InventoryReportService::inventoryValue()` حرفياً.
     *
     * @param  array<int, string>  $warehouseIds
     */
    private function warehouseScopedInventoryValueMinor(array $warehouseIds): int
    {
        return (int) Product::query()
            ->where('products.track_inventory', true)
            ->join('product_warehouse_stock', function ($join) use ($warehouseIds) {
                $join->on('product_warehouse_stock.product_id', '=', 'products.id')
                    ->whereColumn('product_warehouse_stock.tenant_id', '=', 'products.tenant_id')
                    ->whereIn('product_warehouse_stock.warehouse_id', $warehouseIds);
            })
            ->join('inventory_states', function ($join) {
                $join->on('inventory_states.product_id', '=', 'products.id')
                    ->whereColumn('inventory_states.tenant_id', '=', 'products.tenant_id')
                    ->where(function ($identity) {
                        $identity->whereColumn('inventory_states.product_variant_id', '=', 'product_warehouse_stock.product_variant_id')
                            ->orWhere(function ($bothSimple) {
                                $bothSimple->whereNull('inventory_states.product_variant_id')
                                    ->whereNull('product_warehouse_stock.product_variant_id');
                            });
                    });
            })
            ->leftJoin('product_variants', function ($join) {
                $join->on('product_variants.id', '=', 'inventory_states.product_variant_id')
                    ->whereColumn('product_variants.tenant_id', '=', 'products.tenant_id');
            })
            ->where(function ($q) {
                $q->whereNull('inventory_states.product_variant_id')
                    ->orWhere('product_variants.is_active', true);
            })
            ->selectRaw('COALESCE(SUM(product_warehouse_stock.quantity * inventory_states.avg_cost), 0) as total_value_minor')
            ->value('total_value_minor');
    }

    /**
     * SEC-INV-1 — إغلاق فجوة صلاحية المخزن في هذا المسار القديم (نفس فجوة
     * AWJ-PERF-4 قبل إصلاحها في `/inventory/summary`، ولم تُلمَس هنا من قبل).
     *
     * `ReportWarehouseScope` ليس فلتر عرضٍ اختيارياً — يفرض
     * `User::allowedWarehouseIds()` كحدٍّ أمني (كما في `InventoryWorkspaceQuery`/
     * `ProductWarehouseBalanceQuery`/`InventoryReportService::inventoryValue()`
     * ونفس صيغة `summary()` أعلاه). مستخدمٌ مقيَّدٌ بمخزن — حتى بدور `admin`
     * ومع `products.view_cost` — يجب ألا يرى **الكمية** (بصرف النظر عن صلاحية
     * التكلفة؛ الكمية ليست بياناً حسّاساً وتبقى ظاهرة كما هي دوماً) ولا القيمة
     * من مخازن خارج نطاقه.
     *
     * **العقد بلا تغيير:** نفس الحقول، نفس الشكل، نفس عدد الصفوف (صفٌّ واحدٌ
     * لكل منتجٍ متتبَّع كما كان). الرقم الوحيد الذي يتغيّر فعلياً لمستخدمٍ
     * مقيَّد هو **قيمة** `quantity_on_hand`/`avg_cost`/`stock_value`/`total_value`
     * نفسها — وهذا تغييرٌ أمنيٌّ مقصود، لا تغييرٌ في سياسة التكلفة: `avg_cost`
     * يبقى متوسط `Product` العالمي بلا تغيير (لا تكلفة تُخترع لكل مخزن)، وسلوك
     * منتج `variant_managed` (الكمية مجموعٌ عبر كل متغيّراته، والمتوسط صفرٌ
     * صراحةً) يبقى تماماً كما وثّقه `Product::quantityOnHand()`/`avgCost()` —
     * لم يُغيَّر بهذا الإصلاح، فقط أُخذ نطاق المخزن بعين الاعتبار عند حساب
     * الكمية المجمَّعة لكل هويّة.
     *
     * غير المقيَّد: لا تغيير إطلاقاً — نفس `$p->quantity_on_hand` مباشرة كما
     * كان قبل هذا الإصلاح.
     */
    public function index(Request $request): JsonResponse
    {
        if ($request->query('view') === 'workspace') {
            return $this->workspace($request);
        }

        $authorizedCost = SensitiveCostPolicy::authorized($request->user());
        $products = Product::where('track_inventory', true)->orderBy('name')->get();
        $scopedQuantities = $this->scopedQuantitiesByProduct($products);

        $rows = $products->map(function (Product $p) use ($scopedQuantities) {
            $quantity = $scopedQuantities === null
                ? (int) $p->quantity_on_hand
                : (int) ($scopedQuantities[$p->id] ?? 0);

            return ['product' => $p, 'quantity' => $quantity, 'value_minor' => $quantity * (int) $p->avg_cost];
        });

        $items = $rows->map(fn (array $r) => [
            'id'               => $r['product']->id,
            'sku'              => $r['product']->sku,
            'name'             => $r['product']->name,
            'unit'             => $r['product']->unit,
            'quantity_on_hand' => $r['quantity'],
            'avg_cost'         => $authorizedCost ? Money::toRiyal($r['product']->avg_cost) : null,
            'stock_value'      => $authorizedCost ? Money::toRiyal($r['value_minor']) : null,
        ])->values();

        $totalMinor = $rows->sum('value_minor');

        return response()->json([
            'data'        => $items,
            'total_value' => $authorizedCost ? Money::toRiyal($totalMinor) : null,
        ]);
    }

    /**
     * الكمية الحالية لكل منتجٍ مقاطَعةً بنطاق المخزن الفعّال — استعلامٌ واحد
     * (لا N+1)، مجموعةٌ عبر كل `product_warehouse_stock` (بسيطاً كان أم
     * متغيّراً) لكل `product_id`، تماماً كما يفعل الفرع المقيَّد في
     * `InventoryReportService::inventoryValue()`.
     *
     * @return array<string,int>|null  `null` = مستخدمٌ غير مقيَّد (بلا تصفية).
     */
    private function scopedQuantitiesByProduct(Collection $products): ?array
    {
        $warehouseIds = ReportWarehouseScope::resolve([]);
        if ($warehouseIds === null) {
            return null;
        }

        if ($products->isEmpty()) {
            return [];
        }

        return ProductWarehouseStock::query()
            ->whereIn('product_id', $products->pluck('id'))
            ->whereIn('warehouse_id', $warehouseIds)
            ->selectRaw('product_id, SUM(quantity) as qty')
            ->groupBy('product_id')
            ->pluck('qty', 'product_id')
            ->map(fn ($v) => (int) $v)
            ->all();
    }

    public function export(ExportInventoryBalancesRequest $request): Response
    {
        $filters = $request->validated();
        $scope = $filters['scope'] ?? InventoryBalanceExportService::SCOPE_FILTERED;
        $format = $filters['format'] ?? InventoryBalanceExportService::FORMAT_XLSX;
        $includeZero = ! $request->has('include_zero') || $request->boolean('include_zero');
        $locale = str_starts_with((string) $request->query('locale'), 'en') ? 'en' : 'ar';

        $authorizedCost = SensitiveCostPolicy::authorized($request->user());
        if (SensitiveCostPolicy::queryBlocked(
            $filters, $filters['sort'] ?? null, $authorizedCost,
            SensitiveCostPolicy::INVENTORY_FILTER_KEYS, SensitiveCostPolicy::INVENTORY_SORT_KEYS
        )) {
            abort(403, 'تصفية أو فرز المخزون بحقل تكلفة يحتاج صلاحية عرض التكلفة.');
        }

        $query = InventoryBalanceFilters::query();
        if ($scope === InventoryBalanceExportService::SCOPE_FILTERED) {
            InventoryBalanceFilters::apply($query, $filters);
        }
        InventoryBalanceFilters::applySort($query, $filters['sort'] ?? null);

        $filename = 'nebrax-inventory-balances-'.now()->toDateString();
        $warehouseIds = ReportWarehouseScope::resolve($filters);

        return $this->domain(fn () => $this->exports->download($query, $format, $filename, $locale, $includeZero, $authorizedCost, $warehouseIds));
    }

    public function movements(Request $request, string $productId): JsonResponse
    {
        Product::findOrFail($productId);
        $authorizedCost = SensitiveCostPolicy::authorized($request->user());

        $movements = StockMovement::where('product_id', $productId)
            ->orderByDesc('movement_date')
            ->orderByDesc('id')
            ->get();
        $sources = MovementSourceResolver::make()->resolveMany($movements, $request->user());

        $rows = $movements
            ->map(fn (StockMovement $m) => [
                'id'               => $m->id,
                'type'             => $m->type,
                'quantity'         => $m->quantity,
                'unit_cost'        => $authorizedCost ? Money::toRiyal($m->unit_cost) : null,
                'total_cost'       => $authorizedCost ? Money::toRiyal($m->total_cost) : null,
                'balance_quantity' => $m->balance_quantity,
                'movement_date'    => optional($m->movement_date)->toDateString(),
                'notes'            => $m->notes,
                'source'           => ($sources[$m->id] ?? null)?->toArray(),
            ]);

        return response()->json(['data' => $rows]);
    }
}
