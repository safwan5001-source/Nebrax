<?php

namespace App\Support;

use App\Models\ProductWarehouseStock;
use Illuminate\Database\Eloquent\Builder;

/**
 * عقد تصفية وفرز مساحة عمل المخزون — حبة Product × Warehouse.
 *
 * المصدر الكمي المعتمد هنا `product_warehouse_stock.quantity` فقط.
 * `products.quantity_on_hand` يبقى الإجمالي العالمي لتقرير الأرصدة القديم
 * ولا يُخلط في صفوف هذه الشاشة.
 *
 * متوسط التكلفة يبقى عالمياً على المنتج؛ قيمة الصف = كمية المخزن × avg_cost.
 */
class InventoryWorkspaceFilters
{
    public const STOCK_STATES = ['in_stock', 'low', 'out', 'negative'];

    public const SORTS = [
        'name' => 'products.name',
        'sku' => 'products.sku',
        'warehouse' => 'warehouses.name',
        'quantity' => 'product_warehouse_stock.quantity',
        'avg_cost' => 'products.avg_cost',
        'stock_value' => 'product_warehouse_stock.quantity * products.avg_cost',
    ];

    public const COST_SORT_KEYS = ['avg_cost', 'stock_value'];

    /** @return array<string, array<int, mixed>> */
    public static function rules(): array
    {
        return [
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
            'branch_id' => ['sometimes', 'nullable', 'uuid'],
            'category_id' => ['sometimes', 'nullable', 'uuid'],
            'stock_state' => ['sometimes', 'nullable', 'string', 'in:'.implode(',', self::STOCK_STATES)],
            'sort' => ['sometimes', 'nullable', 'string', 'max:40'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:100'],
        ];
    }

    public static function query(): Builder
    {
        return ProductWarehouseStock::query()
            ->join('products', 'products.id', '=', 'product_warehouse_stock.product_id')
            ->join('warehouses', 'warehouses.id', '=', 'product_warehouse_stock.warehouse_id')
            ->leftJoin('product_categories', 'product_categories.id', '=', 'products.category_id')
            ->leftJoin('branches as warehouse_branches', 'warehouse_branches.id', '=', 'warehouses.branch_id')
            ->where('products.track_inventory', true)
            ->whereNull('products.deleted_at')
            ->whereColumn('products.tenant_id', 'product_warehouse_stock.tenant_id')
            ->whereColumn('warehouses.tenant_id', 'product_warehouse_stock.tenant_id');
    }

    /** @param  array<string, mixed>  $filters */
    public static function apply(Builder $query, array $filters): Builder
    {
        if (filled($filters['search'] ?? null)) {
            $needle = addcslashes(mb_strtolower(trim((string) $filters['search']), 'UTF-8'), '%_\\');
            $query->whereRaw(
                "LOWER(COALESCE(products.sku, '') || ' ' || products.name || ' ' || COALESCE(products.unit, '')) LIKE ?",
                ['%'.$needle.'%']
            );
        }

        $warehouseIds = ReportWarehouseScope::resolve($filters);
        if ($warehouseIds !== null) {
            $query->whereIn('product_warehouse_stock.warehouse_id', $warehouseIds);
        }

        $branchIds = ReportBranchScope::resolve($filters);
        if ($branchIds !== null) {
            $query->whereIn('warehouses.branch_id', $branchIds);
        }

        if (filled($filters['category_id'] ?? null)) {
            $query->where('products.category_id', $filters['category_id']);
        }

        $state = $filters['stock_state'] ?? null;
        if (filled($state)) {
            match ($state) {
                'negative' => $query->where('product_warehouse_stock.quantity', '<', 0),
                'out' => $query->where('product_warehouse_stock.quantity', '=', 0),
                'low' => $query
                    ->where('product_warehouse_stock.quantity', '>', 0)
                    ->whereNotNull('products.reorder_level')
                    ->where('products.reorder_level', '>', 0)
                    ->whereColumn('product_warehouse_stock.quantity', '<=', 'products.reorder_level'),
                'in_stock' => $query
                    ->where('product_warehouse_stock.quantity', '>', 0)
                    ->where(function (Builder $inner) {
                        $inner->whereNull('products.reorder_level')
                            ->orWhere('products.reorder_level', '<=', 0)
                            ->orWhereColumn('product_warehouse_stock.quantity', '>', 'products.reorder_level');
                    }),
                default => null,
            };
        }

        return $query;
    }

    public static function applySort(Builder $query, ?string $sort): Builder
    {
        $sort = (string) ($sort ?? '');
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $key = ltrim($sort, '-');
        $expression = self::SORTS[$key] ?? self::SORTS['name'];

        if ($key === 'stock_value') {
            return $query
                ->orderByRaw("{$expression} {$direction}")
                ->orderBy('products.name')
                ->orderBy('product_warehouse_stock.product_id')
                ->orderBy('product_warehouse_stock.warehouse_id');
        }

        return $query
            ->orderBy($expression, $direction)
            ->orderBy('products.name')
            ->orderBy('product_warehouse_stock.product_id')
            ->orderBy('product_warehouse_stock.warehouse_id');
    }

    public static function stockStateExpression(): string
    {
        return <<<'SQL'
CASE
    WHEN product_warehouse_stock.quantity < 0 THEN 'negative'
    WHEN product_warehouse_stock.quantity = 0 THEN 'out'
    WHEN products.reorder_level IS NOT NULL
         AND products.reorder_level > 0
         AND product_warehouse_stock.quantity <= products.reorder_level THEN 'low'
    ELSE 'in_stock'
END
SQL;
    }
}
