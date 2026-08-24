import { describe, expect, it } from 'vitest';
import {
  parseExplorerState,
  removeFilter,
  replaceFilter,
  serializeExplorerState,
} from './url-state';
import type { DataExplorerState } from './types';

describe('data explorer URL state', () => {
  it('round-trips search, filters, sort and pagination', () => {
    const state: DataExplorerState = {
      search: 'INV-1004',
      filters: [
        { key: 'status', operator: 'eq', value: 'overdue' },
        { key: 'branch_id', operator: 'in', value: ['1', '2'] },
        { key: 'has_balance', operator: 'eq', value: true },
      ],
      sort: '-due_date',
      page: 3,
      perPage: 50,
    };

    const parsed = parseExplorerState(serializeExplorerState(state));

    expect(parsed).toEqual(state);
  });

  it('omits empty search and the default first page', () => {
    const params = serializeExplorerState({ search: '   ', filters: [], page: 1 });

    expect(params.has('q')).toBe(false);
    expect(params.has('page')).toBe(false);
  });

  it('replaces a filter by key without disturbing other filters', () => {
    const result = replaceFilter(
      [
        { key: 'status', operator: 'eq', value: 'draft' },
        { key: 'branch', operator: 'eq', value: '1' },
      ],
      { key: 'status', operator: 'eq', value: 'posted' }
    );

    expect(result).toEqual([
      { key: 'branch', operator: 'eq', value: '1' },
      { key: 'status', operator: 'eq', value: 'posted' },
    ]);
  });

  it('removes only the selected filter', () => {
    const result = removeFilter(
      [
        { key: 'status', operator: 'eq', value: 'posted' },
        { key: 'customer', operator: 'eq', value: '42' },
      ],
      'status'
    );

    expect(result).toEqual([{ key: 'customer', operator: 'eq', value: '42' }]);
  });
});
