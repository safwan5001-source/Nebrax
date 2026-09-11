<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ExportInventoryBalancesRequest;
use App\Models\Product;
use App\Models\StockMovement;
use App\Services\InventoryBalanceExportService;
use App\Support\InventoryBalanceFilters;
use App\Support\InventoryWorkspaceQuery;
use App\Support\Money;
use App\Support\ReportWarehouseScope;
use App\Support\SensitiveCostPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class InventoryController extends ApiController
{
    public function __construct(protected InventoryBalanceExportService $exports) {}

    public function index(Request $request): JsonResponse
    {
        $authorizedCost = SensitiveCostPolicy::authorized($request->user());
        $products = Product::where('track_inventory', true)->orderBy('name')->get();
        $items = $products->map(fn (Product $p) => [
            'id' => $p->id,
            'sku' => $p->sku,
            'name' => $p->name,
            'unit' => $p->unit,
            'quantity_on_hand' => $p->quantity_on_hand,
            'avg_cost' => $authorizedCost ? Money::toRiyal($p->avg_cost) : null,
            'stock_value' => $authorizedCost ? Money::toRiyal($p->quantity_on_hand * $p->avg_cost) : null,
        ])->values();
        $totalMinor = $products->sum(fn (Product $p) => $p->quantity_on_hand * $p->avg_cost);

        return response()->json([
            'data' => $items,
            'total_value' => $authorizedCost ? Money::toRiyal($totalMinor) : null,
        ]);
    }

    public function workspace(Request $request): JsonResponse
    {
        $filters = $request->validate(InventoryWorkspaceQuery::rules());
        $authorizedCost = SensitiveCostPolicy::authorized($request->user());
        if (SensitiveCostPolicy::queryBlocked(
            $filters,
            $filters['sort'] ?? null,
            $authorizedCost,
            SensitiveCostPolicy::INVENTORY_FILTER_KEYS,
            SensitiveCostPolicy::INVENTORY_SORT_KEYS
        )) {
            abort(403, 'تصفية أو فرز المخزون بحقل تكلفة يحتاج صلاحية عرض التكلفة.');
        }
        $perPage = (int) ($filters['per_page'] ?? 25);
        $query = InventoryWorkspaceQuery::query($filters);
        InventoryWorkspaceQuery::applySort($query, $filters['sort'] ?? null);
        $page = $query->paginate($perPage)->withQueryString();
        $rows = $page->getCollection()->map(function ($row) use ($authorizedCost) {
            $quantity = (int) $row->quantity;
            $avgCost = (int) $row->avg_cost;
            return [
                'id' => $row->id,
                'product_id' => $row->product_id,
                'warehouse_id' => $row->warehouse_id,
                'branch_id' => $row->branch_id,
                'name' => $row->product_name,
                'sku' => $row->sku,
                'unit' => $row->unit,
                'category' => $row->category,
                'category_id' => $row->category_id,
                'warehouse' => $row->warehouse_name,
                'warehouse_code' => $row->warehouse_code,
                'quantity_on_hand' => $quantity,
                'reorder_level' => $row->reorder_level === null ? null : (int) $row->reorder_level,
                'stock_state' => (string) $row->stock_state,
                'avg_cost' => $authorizedCost ? Money::toRiyal($avgCost) : null,
                'stock_value' => $authorizedCost ? Money::toRiyal($quantity * $avgCost) : null,
            ];
        })->values();

        return response()->json([
            'data' => $rows,
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
                'cost_visible' => $authorizedCost,
            ],
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
        $rows = StockMovement::where('product_id', $productId)
            ->orderByDesc('movement_date')
            ->orderByDesc('id')
            ->get()
            ->map(fn (StockMovement $m) => [
                'id' => $m->id,
                'type' => $m->type,
                'quantity' => $m->quantity,
                'unit_cost' => $authorizedCost ? Money::toRiyal($m->unit_cost) : null,
                'total_cost' => $authorizedCost ? Money::toRiyal($m->total_cost) : null,
                'balance_quantity' => $m->balance_quantity,
                'movement_date' => optional($m->movement_date)->toDateString(),
                'notes' => $m->notes,
            ]);

        return response()->json(['data' => $rows]);
    }
}
