import { describe, expect, it } from 'vitest';
import type { DataExplorerState } from '@/lib/data-explorer/types';
import {
  inventoryWorkspaceFilterQuery,
  inventoryWorkspacePath,
  inventoryWorkspaceQuery,
  stockStateLabel,
} from './workspace-query';

function state(overrides: Partial<DataExplorerState> = {}): DataExplorerState {
  return { search: '', sort: 'name', page: 1, perPage: 25, filters: [], ...overrides };
}

describe('inventoryWorkspaceQuery', () => {
  it('يثبّت view=workspace ويبني بحثاً وتقسيماً وفلاتر مدعومة فقط', () => {
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
    expect(params.get('view')).toBe('workspace');
    expect(params.get('search')).toBe('إسمنت');
    expect(params.get('page')).toBe('2');
    expect(params.get('per_page')).toBe('50');
    expect(params.get('warehouse_id')).toBe('wh-1');
    expect(params.get('avg_cost_min')).toBeNull();
  });

  it('يضع view=workspace حتى في استعلام المرشّحات', () => {
    const params = new URLSearchParams(inventoryWorkspaceFilterQuery(state({ page: 3, perPage: 100 })));
    expect(params.get('view')).toBe('workspace');
    expect(params.get('page')).toBeNull();
  });

  it('يبني مسار الواجهة البرمجية الكامل', () => {
    expect(inventoryWorkspacePath(state())).toBe('/inventory?view=workspace&sort=name&page=1&per_page=25');
  });

  it('يترجم حالة المخزون حسب اللغة', () => {
    expect(stockStateLabel('low', 'ar')).toBe('منخفض');
    expect(stockStateLabel('low', 'en')).toBe('Low');
  });
});
