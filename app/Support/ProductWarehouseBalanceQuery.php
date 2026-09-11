<?php

namespace App\Support;

use App\Models\ProductWarehouseStock;
use Illuminate\Database\Eloquent\Builder;

/**
 * أساس قراءة أرصدة Product × Warehouse.
 *
 * المصدر الكمي الوحيد: product_warehouse_stock.quantity.
 * لا يغيّر products.quantity_on_hand ولا متوسط التكلفة ولا القيود.
 * نطاق الرؤية = ReportBranchScope ∩ ReportWarehouseScope كما في تقرير المخازن.
 */
class ProductWarehouseBalanceQuery
{
    public static function baseQuery(): Builder
    {
        return ProductWarehouseStock::query()
            ->join('warehouses', 'warehouses.id', '=', 'product_warehouse_stock.warehouse_id')
            ->join('products', 'products.id', '=', 'product_warehouse_stock.product_id')
            ->leftJoin('branches as warehouse_branches', 'warehouse_branches.id', '=', 'warehouses.branch_id')
            ->where('products.track_inventory', true)
            ->whereColumn('products.tenant_id', 'product_warehouse_stock.tenant_id');
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public static function applyScope(Builder $query, array $filters): Builder
    {
        $branches = ReportBranchScope::resolve($filters);
        if ($branches !== null) {
            $query->whereIn('warehouses.branch_id', $branches);
        }

        $warehouses = ReportWarehouseScope::resolve($filters);
        if ($warehouses !== null) {
            $query->whereIn('product_warehouse_stock.warehouse_id', $warehouses);
        }

        return $query;
    }
}
