<?php

namespace App\Services;

use App\Support\InventoryWorkspaceFilters;
use App\Support\Money;
use App\Support\SensitiveCostPolicy;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

/**
 * استعلام مساحة عمل المخزون — قراءة فقط من الأرصدة الموجودة.
 * لا يكتب في المخزون ولا في القيود ولا يغيّر متوسط التكلفة.
 */
class InventoryWorkspaceQuery
{
    /**
     * @param  array<string, mixed>  $filters
     * @return array{
     *     paginator: LengthAwarePaginator,
     *     rows: Collection<int, array<string, mixed>>,
     *     total_quantity: int,
     *     total_value_minor: int,
     *     can_view_cost: bool
     * }
     */
    public function page(array $filters, bool $canViewCost): array
    {
        $query = InventoryWorkspaceFilters::query();
        InventoryWorkspaceFilters::apply($query, $filters);
        InventoryWorkspaceFilters::applySort($query, $filters['sort'] ?? null);

        $totals = $this->totals($query);

        $query->select([
            'product_warehouse_stock.product_id',
            'product_warehouse_stock.warehouse_id',
            'product_warehouse_stock.quantity',
            'products.sku',
            'products.name as product_name',
            'products.unit',
            'products.category_id',
            'products.reorder_level',
            'products.avg_cost',
            'product_categories.name as category_name',
            'warehouses.name as warehouse_name',
            'warehouses.branch_id',
            'warehouse_branches.name as branch_name',
        ])->selectRaw(InventoryWorkspaceFilters::stockStateExpression().' as stock_state');

        $perPage = (int) ($filters['per_page'] ?? 25);
        $paginator = $query->paginate($perPage);

        $rows = $paginator->getCollection()->map(
            fn ($row) => $this->mapRow($row, $canViewCost)
        );

        $paginator->setCollection($rows);

        return [
            'paginator' => $paginator,
            'rows' => $rows->values(),
            'total_quantity' => $totals['quantity'],
            'total_value_minor' => $totals['value_minor'],
            'can_view_cost' => $canViewCost,
        ];
    }

    /**
     * @param  \Illuminate\Database\Eloquent\Builder  $query
     * @return array{quantity: int, value_minor: int}
     */
    private function totals($query): array
    {
        $aggregate = (clone $query)
            ->reorder()
            ->toBase()
            ->cloneWithout(['columns', 'orders', 'limit', 'offset'])
            ->cloneWithoutBindings(['select', 'order'])
            ->selectRaw('COALESCE(SUM(product_warehouse_stock.quantity), 0) as qty')
            ->selectRaw('COALESCE(SUM(product_warehouse_stock.quantity * products.avg_cost), 0) as value_minor')
            ->first();

        return [
            'quantity' => (int) ($aggregate->qty ?? 0),
            'value_minor' => (int) ($aggregate->value_minor ?? 0),
        ];
    }

    /**
     * @param  object  $row
     * @return array<string, mixed>
     */
    private function mapRow(object $row, bool $canViewCost): array
    {
        $quantity = (int) $row->quantity;
        $avgCost = (int) $row->avg_cost;

        $mapped = [
            'id' => $row->product_id.':'.$row->warehouse_id,
            'product_id' => (string) $row->product_id,
            'warehouse_id' => (string) $row->warehouse_id,
            'branch_id' => $row->branch_id === null ? null : (string) $row->branch_id,
            'sku' => $row->sku === null ? null : (string) $row->sku,
            'name' => (string) $row->product_name,
            'unit' => (string) $row->unit,
            'category_id' => $row->category_id === null ? null : (string) $row->category_id,
            'category_name' => $row->category_name === null ? null : (string) $row->category_name,
            'warehouse_name' => (string) $row->warehouse_name,
            'branch_name' => $row->branch_name === null ? null : (string) $row->branch_name,
            'quantity' => $quantity,
            'reorder_level' => $row->reorder_level === null ? null : (int) $row->reorder_level,
            'stock_state' => (string) $row->stock_state,
            'avg_cost' => $canViewCost ? Money::toRiyal($avgCost) : null,
            'stock_value' => $canViewCost ? Money::toRiyal($quantity * $avgCost) : null,
        ];

        return SensitiveCostPolicy::redactRow(
            $mapped,
            $canViewCost,
            SensitiveCostPolicy::INVENTORY_REPORT_FIELDS
        );
    }
}
