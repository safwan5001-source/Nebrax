import type { DataExplorerState } from '@/lib/data-explorer/types';

export const INVENTORY_WORKSPACE_SORT_COLUMNS = [
  'name', 'sku', 'warehouse', 'quantity_on_hand', 'avg_cost', 'stock_value', 'stock_state',
];

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
