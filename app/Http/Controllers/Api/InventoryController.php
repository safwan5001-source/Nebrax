<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ExportInventoryBalancesRequest;
use App\Models\Product;
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

    public function index(Request $request): JsonResponse
    {
        if ($request->query('view') === 'workspace') {
            return $this->workspace($request);
        }

        $authorizedCost = SensitiveCostPolicy::authorized($request->user());
        $products = Product::where('track_inventory', true)->orderBy('name')->get();

        $items = $products->map(fn (Product $p) => [
            'id'               => $p->id,
            'sku'              => $p->sku,
            'name'             => $p->name,
            'unit'             => $p->unit,
            'quantity_on_hand' => $p->quantity_on_hand,
            'avg_cost'         => $authorizedCost ? Money::toRiyal($p->avg_cost) : null,
            'stock_value'      => $authorizedCost ? Money::toRiyal($p->quantity_on_hand * $p->avg_cost) : null,
        ])->values();

        $totalMinor = $products->sum(fn (Product $p) => $p->quantity_on_hand * $p->avg_cost);

        return response()->json([
            'data'        => $items,
            'total_value' => $authorizedCost ? Money::toRiyal($totalMinor) : null,
        ]);
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
