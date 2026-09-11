import { describe, expect, it } from 'vitest';
import type { DataExplorerState } from '@/lib/data-explorer/types';
import { inventoryWorkspaceFilterQuery, inventoryWorkspaceQuery } from './workspace-query';

function state(overrides: Partial<DataExplorerState> = {}): DataExplorerState {
  return { search: '', sort: 'name', page: 1, perPage: 25, filters: [], ...overrides };
}

describe('inventoryWorkspaceQuery', () => {
  it('يبني بحثاً وتقسيماً وفلاتر مدعومة فقط', () => {
    const params = new URLSearchParams(inventoryWorkspaceQuery(state({
      search: 'إسمنت',
      sort: '-quantity',
      page: 2,
      perPage: 50,
      filters: [
        { key: 'warehouse_id', operator: 'eq', value: 'wh-1', label: '' },
        { key: 'avg_cost_min', operator: 'gte', value: '10', label: '' },
      ],
    })));
    expect(params.get('search')).toBe('إسمنت');
    expect(params.get('page')).toBe('2');
    expect(params.get('warehouse_id')).toBe('wh-1');
    expect(params.get('avg_cost_min')).toBeNull();
  });

  it('لا يضع تقسيماً في استعلام المرشّحات وحدها', () => {
    const params = new URLSearchParams(inventoryWorkspaceFilterQuery(state({ page: 3, perPage: 100 })));
    expect(params.get('page')).toBeNull();
  });
});
