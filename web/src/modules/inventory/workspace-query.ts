import type { DataExplorerState } from '@/lib/data-explorer/types';

/** أعمدة يقبل الخادم الفرز بها — مطابقة لـ InventoryWorkspaceFilters::SORTS. */
export const INVENTORY_WORKSPACE_SORT_COLUMNS = [
  'name',
  'sku',
  'warehouse',
  'quantity',
  'avg_cost',
  'stock_value',
];

export const INVENTORY_WORKSPACE_COST_SORTS = ['avg_cost', 'stock_value'];

export type InventoryStockState = 'in_stock' | 'low' | 'out' | 'negative';

export interface InventoryWorkspaceRow {
  id: string;
  product_id: string;
  warehouse_id: string;
  branch_id: string | null;
  sku: string | null;
  name: string;
  unit: string;
  category_id: string | null;
  category_name: string | null;
  warehouse_name: string;
  branch_name: string | null;
  quantity: number;
  reorder_level: number | null;
  stock_state: InventoryStockState;
  avg_cost: string | null;
  stock_value: string | null;
}

export interface InventoryWorkspaceMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  can_view_cost: boolean;
  total_quantity: number;
  total_value: string | null;
}

export function inventoryWorkspaceFilterQuery(state: DataExplorerState): string {
  const params = new URLSearchParams();
  if (state.search.trim()) params.set('search', state.search.trim());
  if (state.sort) params.set('sort', state.sort);

  for (const filter of state.filters) {
    if (Array.isArray(filter.value) || String(filter.value).trim() === '') continue;
    if (['warehouse_id', 'branch_id', 'category_id', 'stock_state'].includes(filter.key)) {
      params.set(filter.key, String(filter.value));
    }
  }

  return params.toString();
}

export function inventoryWorkspaceQuery(state: DataExplorerState): string {
  const params = new URLSearchParams(inventoryWorkspaceFilterQuery(state));
  params.set('page', String(state.page ?? 1));
  params.set('per_page', String(state.perPage ?? 25));
  return params.toString();
}
