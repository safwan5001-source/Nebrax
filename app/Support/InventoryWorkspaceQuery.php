<?php

namespace App\Support;

use App\Models\ProductWarehouseStock;
use Illuminate\Database\Eloquent\Builder;

/**
 * استعلام مساحة عمل المخزون — قراءة فقط، حبة Product × Warehouse.
 *
 * المصدر الكمّي: `product_warehouse_stock.quantity`.
 * المصدر التقييمي: `products.avg_cost` العالمي (لا متوسط لكل مخزن).
 * لا حجوزات ولا Available — ذلك مرحلة لاحقة.
 */
class InventoryWorkspaceQuery
{
    public const STATES = ['in_stock', 'low', 'out', 'negative'];

    public const SORTS = [
        'name' => 'products.name',
        'sku' => 'products.sku',
        'warehouse' => 'warehouses.name',
        'quantity_on_hand' => 'product_warehouse_stock.quantity',
        'avg_cost' => 'products.avg_cost',
        'stock_value' => '(product_warehouse_stock.quantity * products.avg_cost)',
        'stock_state' => 'stock_state',
    ];

    /**
     * @return array<string, array<int, string>>
     */
    public static function rules(): array
    {
        return [
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
            'branch_id' => ['sometimes', 'nullable', 'uuid'],
            'category_id' => ['sometimes', 'nullable', 'uuid'],
            'stock_state' => ['sometimes', 'nullable', 'string', 'in:'.implode(',', self::STATES)],
            'sort' => ['sometimes', 'nullable', 'string', 'max:40'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:100'],
        ];
    }

    public static function stockStateSql(): string
    {
        return <<<'SQL'
CASE
    WHEN product_warehouse_stock.quantity < 0 THEN 'negative'
    WHEN product_warehouse_stock.quantity = 0 THEN 'out'
    WHEN COALESCE(products.reorder_level, 0) > 0
         AND product_warehouse_stock.quantity <= products.reorder_level THEN 'low'
    ELSE 'in_stock'
END
SQL;
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public static function query(array $filters): Builder
    {
        $stateSql = self::stockStateSql();

        $query = ProductWarehouseStock::query()
            ->select([
                'product_warehouse_stock.id',
                'product_warehouse_stock.product_id',
                'product_warehouse_stock.warehouse_id',
                'product_warehouse_stock.quantity',
                'products.name as product_name',
                'products.sku as sku',
                'products.unit as unit',
                'products.category as category',
                'products.category_id as category_id',
                'products.reorder_level as reorder_level',
                'products.avg_cost as avg_cost',
                'warehouses.name as warehouse_name',
                'warehouses.code as warehouse_code',
                'warehouses.branch_id as branch_id',
            ])
            ->selectRaw("{$stateSql} as stock_state")
            ->join('products', 'products.id', '=', 'product_warehouse_stock.product_id')
            ->join('warehouses', 'warehouses.id', '=', 'product_warehouse_stock.warehouse_id')
            ->where('products.track_inventory', true);

        $warehouseIds = ReportWarehouseScope::resolve($filters);
        if ($warehouseIds !== null) {
            $query->whereIn('product_warehouse_stock.warehouse_id', $warehouseIds);
        }

        $branchIds = ReportBranchScope::resolve($filters);
        if ($branchIds !== null) {
            $query->whereIn('warehouses.branch_id', $branchIds);
        }

        if (filled($filters['search'] ?? null)) {
            $needle = addcslashes(mb_strtolower(trim((string) $filters['search']), 'UTF-8'), '%_\\');
            $query->whereRaw(
                "LOWER(COALESCE(products.sku, '') || ' ' || products.name || ' ' || COALESCE(products.unit, '') || ' ' || warehouses.name || ' ' || COALESCE(warehouses.code, '')) LIKE ?",
                ['%'.$needle.'%']
            );
        }

        if (filled($filters['category_id'] ?? null)) {
            $query->where('products.category_id', $filters['category_id']);
        }

        if (filled($filters['stock_state'] ?? null)) {
            $query->whereRaw("({$stateSql}) = ?", [$filters['stock_state']]);
        }

        return $query;
    }

    public static function applySort(Builder $query, ?string $sort): Builder
    {
        $sort = (string) ($sort ?? '');
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $key = ltrim($sort, '-');
        $expression = self::SORTS[$key] ?? self::SORTS['name'];

        if (in_array($key, ['stock_value', 'stock_state'], true)) {
            $query->orderByRaw("{$expression} {$direction}");
        } else {
            $query->orderBy($expression, $direction);
        }

        return $query
            ->orderBy('products.name')
            ->orderBy('warehouses.name')
            ->orderBy('product_warehouse_stock.id');
    }
}
