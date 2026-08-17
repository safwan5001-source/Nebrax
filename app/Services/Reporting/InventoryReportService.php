<?php

namespace App\Services\Reporting;

use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\StockPermit;
use App\Models\Stocktake;
use App\Tenancy\BranchScope;
use Illuminate\Database\Eloquent\Builder;
use RuntimeException;

/**
 * تقارير المخزون التحليلية — قراءة فقط من دفتر المخزون والمستندات المرحّلة.
 *
 * قيمة المخزون لقطة حالية على مستوى الصنف لأن المتوسط المتحرك والقيمة محفوظان
 * عالمياً في المنتج. أما أرصدة المخازن فكمّية حصراً، لأن توزيع قيمة محاسبية على
 * المخزن غير جزء من نموذج نبراكس. الحركات والأذون والجرد لا تعرض المسودات.
 */
class InventoryReportService
{
    public const VIEWS = ['value', 'warehouses', 'movements', 'operations', 'stocktakes'];

    public const MOVEMENT_TYPES = ['in', 'out'];

    /** @return array{view:string,rows:array<int,array<string,mixed>>,totals:array<string,int>,scope:array<string,mixed>} */
    public function report(string $view, array $filters = []): array
    {
        if (! in_array($view, self::VIEWS, true)) {
            throw new RuntimeException("نوع تقرير مخزون غير معروف: {$view}");
        }

        $result = match ($view) {
            'value'      => $this->inventoryValue($filters),
            'warehouses' => $this->warehouseBalances($filters),
            'movements'  => $this->movements($filters),
            'operations' => $this->operations($filters),
            'stocktakes' => $this->stocktakes($filters),
        };

        return [
            'view' => $view,
            'rows' => $result['rows'],
            'totals' => $result['totals'],
            'scope' => [
                'source' => match ($view) {
                    'value' => 'current_tracked_products',
                    'warehouses' => 'warehouse_stock_quantities',
                    'movements' => 'posted_stock_movements',
                    'operations' => 'posted_stock_permits',
                    'stocktakes' => 'posted_stocktakes',
                },
                'snapshot' => in_array($view, ['value', 'warehouses'], true),
            ],
        ];
    }

    /** المنتجات المتتبعة فقط؛ بلا اختيار فروع = لقطة مجمعة لكل المستأجر. */
    private function trackedProducts(array $filters): Builder
    {
        $query = Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('products.track_inventory', true);

        if (! empty($filters['product_id'])) {
            $query->where('products.id', $filters['product_id']);
        }
        if (! empty($filters['hide_zero'])) {
            $query->where('products.quantity_on_hand', '!=', 0);
        }

        return $query;
    }

    /** @return array{rows:array<int,array<string,mixed>>,totals:array<string,int>} */
    private function inventoryValue(array $filters): array
    {
        $rows = $this->trackedProducts($filters)
            ->orderBy('products.name')
            ->get(['id', 'sku', 'name', 'unit', 'quantity_on_hand', 'reorder_level', 'avg_cost', 'sale_price'])
            ->map(fn (Product $product) => [
                'key' => (string) $product->id,
                'sku' => $product->sku,
                'label' => $product->name,
                'unit' => $product->unit,
                'quantity' => (int) $product->quantity_on_hand,
                'reorder_level' => $product->reorder_level === null ? null : (int) $product->reorder_level,
                'avg_cost' => (int) $product->avg_cost,
                'stock_value' => (int) $product->quantity_on_hand * (int) $product->avg_cost,
            ])->all();

        return [
            'rows' => $rows,
            'totals' => [
                'products' => count($rows),
                'quantity' => array_sum(array_column($rows, 'quantity')),
                'stock_value' => array_sum(array_column($rows, 'stock_value')),
            ],
        ];
    }

    /** @return array{rows:array<int,array<string,mixed>>,totals:array<string,int>} */
    private function warehouseBalances(array $filters): array
    {
        $query = ProductWarehouseStock::query()
            ->join('warehouses', 'warehouses.id', '=', 'product_warehouse_stock.warehouse_id')
            ->join('products', 'products.id', '=', 'product_warehouse_stock.product_id')
            ->leftJoin('branches as warehouse_branches', 'warehouse_branches.id', '=', 'warehouses.branch_id')
            ->where('products.track_inventory', true)
            ->whereColumn('products.tenant_id', 'product_warehouse_stock.tenant_id')
            ->select([
                'product_warehouse_stock.product_id as bucket_key',
                'product_warehouse_stock.warehouse_id',
                'product_warehouse_stock.quantity',
                'products.sku',
                'products.name as bucket_label',
                'products.unit',
                'warehouses.name as warehouse_label',
                'warehouse_branches.name as branch_label',
            ]);

        if (! empty($filters['product_id'])) {
            $query->where('product_warehouse_stock.product_id', $filters['product_id']);
        }
        if (! empty($filters['warehouse_id'])) {
            $query->where('product_warehouse_stock.warehouse_id', $filters['warehouse_id']);
        }
        $this->applyWarehouseBranchFilter($query, $filters, 'warehouses.branch_id');
        if (! empty($filters['hide_zero'])) {
            $query->where('product_warehouse_stock.quantity', '!=', 0);
        }

        $rows = $query->orderBy('warehouses.name')->orderBy('products.name')->get()
            ->map(fn ($row) => [
                'key' => (string) $row->bucket_key,
                'warehouse_id' => (string) $row->warehouse_id,
                'warehouse' => (string) $row->warehouse_label,
                'branch' => $row->branch_label === null ? null : (string) $row->branch_label,
                'sku' => $row->sku === null ? null : (string) $row->sku,
                'label' => (string) $row->bucket_label,
                'unit' => (string) $row->unit,
                'quantity' => (int) $row->quantity,
            ])->all();

        return [
            'rows' => $rows,
            'totals' => [
                'items' => count($rows),
                'warehouses' => count(array_unique(array_column($rows, 'warehouse_id'))),
                'quantity' => array_sum(array_column($rows, 'quantity')),
            ],
        ];
    }

    /** @return array{rows:array<int,array<string,mixed>>,totals:array<string,int>} */
    private function movements(array $filters): array
    {
        $query = StockMovement::query()
            ->join('products', 'products.id', '=', 'stock_movements.product_id')
            ->leftJoin('warehouses', 'warehouses.id', '=', 'stock_movements.warehouse_id')
            ->leftJoin('branches as movement_branches', 'movement_branches.id', '=', 'stock_movements.branch_id')
            ->where('products.track_inventory', true)
            ->whereColumn('products.tenant_id', 'stock_movements.tenant_id')
            ->select([
                'stock_movements.id as movement_id',
                'stock_movements.type',
                'stock_movements.quantity',
                'stock_movements.unit_cost',
                'stock_movements.total_cost',
                'stock_movements.balance_quantity',
                'stock_movements.movement_date',
                'stock_movements.notes',
                'products.id as bucket_key',
                'products.sku',
                'products.name as bucket_label',
                'products.unit',
                'warehouses.name as warehouse_label',
                'movement_branches.name as branch_label',
            ]);

        $this->applyHistoricalFilters($query, $filters, 'stock_movements.movement_date');
        if (! empty($filters['product_id'])) {
            $query->where('stock_movements.product_id', $filters['product_id']);
        }
        if (! empty($filters['warehouse_id'])) {
            $query->where('stock_movements.warehouse_id', $filters['warehouse_id']);
        }
        $this->applyWarehouseBranchFilter($query, $filters, 'stock_movements.branch_id');
        if (! empty($filters['movement_type'])) {
            $query->where('stock_movements.type', $filters['movement_type']);
        }

        $rows = $query->orderByDesc('stock_movements.movement_date')->orderByDesc('stock_movements.id')->get()
            ->map(fn ($row) => [
                'key' => (string) $row->movement_id,
                'date' => (string) $row->movement_date,
                'type' => (string) $row->type,
                'sku' => $row->sku === null ? null : (string) $row->sku,
                'label' => (string) $row->bucket_label,
                'unit' => (string) $row->unit,
                'warehouse' => $row->warehouse_label === null ? null : (string) $row->warehouse_label,
                'branch' => $row->branch_label === null ? null : (string) $row->branch_label,
                'quantity' => (int) $row->quantity,
                'unit_cost' => (int) $row->unit_cost,
                'total_cost' => (int) $row->total_cost,
                'balance_quantity' => (int) $row->balance_quantity,
                'notes' => $row->notes === null ? null : (string) $row->notes,
            ])->all();

        return [
            'rows' => $rows,
            'totals' => [
                'movements' => count($rows),
                'in_quantity' => array_sum(array_map(fn (array $row) => $row['type'] === 'in' ? $row['quantity'] : 0, $rows)),
                'out_quantity' => array_sum(array_map(fn (array $row) => $row['type'] === 'out' ? $row['quantity'] : 0, $rows)),
                'in_cost' => array_sum(array_map(fn (array $row) => $row['type'] === 'in' ? $row['total_cost'] : 0, $rows)),
                'out_cost' => array_sum(array_map(fn (array $row) => $row['type'] === 'out' ? $row['total_cost'] : 0, $rows)),
                'total_cost' => array_sum(array_column($rows, 'total_cost')),
            ],
        ];
    }

    /** @return array{rows:array<int,array<string,mixed>>,totals:array<string,int>} */
    private function operations(array $filters): array
    {
        $query = StockPermit::query()
            ->leftJoin('warehouses as source_warehouses', 'source_warehouses.id', '=', 'stock_permits.warehouse_id')
            ->leftJoin('warehouses as target_warehouses', 'target_warehouses.id', '=', 'stock_permits.target_warehouse_id')
            ->leftJoin('branches as source_branches', 'source_branches.id', '=', 'source_warehouses.branch_id')
            ->leftJoin('branches as target_branches', 'target_branches.id', '=', 'target_warehouses.branch_id')
            ->where('stock_permits.status', 'posted')
            ->select([
                'stock_permits.id',
                'stock_permits.number',
                'stock_permits.type',
                'stock_permits.permit_date',
                'stock_permits.total_cost',
                'source_warehouses.name as warehouse_label',
                'target_warehouses.name as target_warehouse_label',
                'source_branches.name as branch_label',
                'target_branches.name as target_branch_label',
            ]);

        $this->applyHistoricalFilters($query, $filters, 'stock_permits.permit_date');
        if (! empty($filters['product_id'])) {
            $query->whereHas('lines', fn (Builder $lines) => $lines->where('product_id', $filters['product_id']));
        }
        if (! empty($filters['warehouse_id'])) {
            $query->where(function (Builder $warehouses) use ($filters) {
                $warehouses->where('stock_permits.warehouse_id', $filters['warehouse_id'])
                    ->orWhere('stock_permits.target_warehouse_id', $filters['warehouse_id']);
            });
        }
        if (! empty($filters['operation_type'])) {
            $query->where('stock_permits.type', $filters['operation_type']);
        }
        $this->applyOperationBranchFilter($query, $filters);

        $rows = $query->withCount('lines')->withSum('lines as quantity', 'quantity')
            ->orderByDesc('stock_permits.permit_date')->orderByDesc('stock_permits.id')->get()
            ->map(fn (StockPermit $permit) => [
                'key' => (string) $permit->id,
                'number' => (string) $permit->number,
                'date' => $permit->permit_date?->toDateString(),
                'type' => (string) $permit->type,
                'warehouse' => $permit->warehouse_label === null ? null : (string) $permit->warehouse_label,
                'target_warehouse' => $permit->target_warehouse_label === null ? null : (string) $permit->target_warehouse_label,
                'branch' => $permit->branch_label === null ? null : (string) $permit->branch_label,
                'target_branch' => $permit->target_branch_label === null ? null : (string) $permit->target_branch_label,
                'lines' => (int) $permit->lines_count,
                'quantity' => (int) ($permit->quantity ?? 0),
                'total_cost' => (int) $permit->total_cost,
            ])->all();

        return [
            'rows' => $rows,
            'totals' => [
                'operations' => count($rows),
                'lines' => array_sum(array_column($rows, 'lines')),
                'quantity' => array_sum(array_column($rows, 'quantity')),
                'total_cost' => array_sum(array_column($rows, 'total_cost')),
            ],
        ];
    }

    /** @return array{rows:array<int,array<string,mixed>>,totals:array<string,int>} */
    private function stocktakes(array $filters): array
    {
        $query = Stocktake::query()
            ->leftJoin('warehouses', 'warehouses.id', '=', 'stocktakes.warehouse_id')
            ->leftJoin('branches as warehouse_branches', 'warehouse_branches.id', '=', 'warehouses.branch_id')
            ->leftJoin('stocktake_lines', function ($join) use ($filters) {
                $join->on('stocktake_lines.stocktake_id', '=', 'stocktakes.id')
                    ->whereNotNull('stocktake_lines.counted_quantity');
                if (! empty($filters['product_id'])) {
                    $join->where('stocktake_lines.product_id', '=', $filters['product_id']);
                }
            })
            ->where('stocktakes.status', 'posted')
            ->selectRaw('stocktakes.id, stocktakes.number, stocktakes.stocktake_date, warehouses.name as warehouse_label, warehouse_branches.name as branch_label, COUNT(stocktake_lines.id) as counted_lines, COALESCE(SUM(stocktake_lines.counted_quantity - stocktake_lines.system_quantity), 0) as quantity_difference, COALESCE(SUM(stocktake_lines.difference_value), 0) as difference_value')
            ->groupBy('stocktakes.id', 'stocktakes.number', 'stocktakes.stocktake_date', 'warehouses.name', 'warehouse_branches.name');

        $this->applyHistoricalFilters($query, $filters, 'stocktakes.stocktake_date');
        if (! empty($filters['warehouse_id'])) {
            $query->where('stocktakes.warehouse_id', $filters['warehouse_id']);
        }
        $this->applyWarehouseBranchFilter($query, $filters, 'warehouses.branch_id');
        if (! empty($filters['product_id'])) {
            $query->whereNotNull('stocktake_lines.id');
        }

        $rows = $query->orderByDesc('stocktakes.stocktake_date')->orderByDesc('stocktakes.id')->get()
            ->map(fn ($row) => [
                'key' => (string) $row->id,
                'number' => (string) $row->number,
                'date' => (string) $row->stocktake_date,
                'warehouse' => $row->warehouse_label === null ? null : (string) $row->warehouse_label,
                'branch' => $row->branch_label === null ? null : (string) $row->branch_label,
                'counted_lines' => (int) $row->counted_lines,
                'quantity_difference' => (int) $row->quantity_difference,
                'difference_value' => (int) $row->difference_value,
            ])->all();

        return [
            'rows' => $rows,
            'totals' => [
                'stocktakes' => count($rows),
                'counted_lines' => array_sum(array_column($rows, 'counted_lines')),
                'quantity_difference' => array_sum(array_column($rows, 'quantity_difference')),
                'difference_value' => array_sum(array_column($rows, 'difference_value')),
            ],
        ];
    }

    private function applyHistoricalFilters(Builder $query, array $filters, string $dateColumn): void
    {
        if (! empty($filters['from'])) {
            $query->whereDate($dateColumn, '>=', $filters['from']);
        }
        if (! empty($filters['to'])) {
            $query->whereDate($dateColumn, '<=', $filters['to']);
        }
    }

    private function applyWarehouseBranchFilter(Builder $query, array $filters, string $column): void
    {
        $branches = array_values(array_filter((array) ($filters['branch_id'] ?? [])));
        if ($branches !== []) {
            $query->whereIn($column, $branches);
        }
    }

    /** التحويل يُرى من فرع المصدر أو الوجهة؛ ليس وثيقة أحادية الفرع. */
    private function applyOperationBranchFilter(Builder $query, array $filters): void
    {
        $branches = array_values(array_filter((array) ($filters['branch_id'] ?? [])));
        if ($branches === []) {
            return;
        }

        $query->where(function (Builder $branchQuery) use ($branches) {
            $branchQuery->whereIn('source_warehouses.branch_id', $branches)
                ->orWhereIn('target_warehouses.branch_id', $branches);
        });
    }
}
