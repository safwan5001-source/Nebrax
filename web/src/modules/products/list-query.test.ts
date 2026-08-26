import { describe, expect, it } from 'vitest';
import type { DataExplorerState } from '@/lib/data-explorer/types';
import { PRODUCT_SORT_COLUMNS, productFilterQuery, productQuery } from './list-query';

function state(overrides: Partial<DataExplorerState> = {}): DataExplorerState {
  return { search: '', sort: 'name', page: 1, perPage: 25, filters: [], ...overrides } as DataExplorerState;
}

describe('productFilterQuery', () => {
  it('لا يحمل معاملات التقسيم إطلاقاً', () => {
    const params = new URLSearchParams(productFilterQuery(state({ page: 4, perPage: 100 })));

    expect(params.get('page')).toBeNull();
    expect(params.get('per_page')).toBeNull();
    expect(params.get('sort')).toBe('name');
  });

  it('يمرّر البحث والفلاتر المعرّفية والحالية', () => {
    const params = new URLSearchParams(
      productFilterQuery(
        state({
          search: '  قهوة  ',
          filters: [
            { key: 'category_id', operator: 'eq', value: 'c1', label: '' },
            { key: 'type', operator: 'eq', value: 'good', label: '' },
            { key: 'is_active', operator: 'eq', value: '1', label: '' },
            { key: 'stock_state', operator: 'eq', value: 'low', label: '' },
          ],
        } as Partial<DataExplorerState>)
      )
    );

    expect(params.get('search')).toBe('قهوة');
    expect(params.get('category_id')).toBe('c1');
    expect(params.get('type')).toBe('good');
    expect(params.get('is_active')).toBe('1');
    expect(params.get('stock_state')).toBe('low');
  });

  it('يحوّل فلاتر المبالغ إلى صيغة المُشغِّل التي يفهمها الخادم', () => {
    const params = new URLSearchParams(
      productFilterQuery(
        state({
          filters: [
            { key: 'sale_price', operator: 'gte', value: '20', label: '' },
            { key: 'purchase_price', operator: 'lte', value: '99.5', label: '' },
          ],
        } as Partial<DataExplorerState>)
      )
    );

    expect(params.get('sale_price_gte')).toBe('20');
    expect(params.get('purchase_price_lte')).toBe('99.5');
  });

  it('يسقط الفلاتر الفارغة أو متعدّدة القيم', () => {
    const params = new URLSearchParams(
      productFilterQuery(
        state({
          filters: [
            { key: 'type', operator: 'eq', value: '   ', label: '' },
            { key: 'category_id', operator: 'eq', value: ['a', 'b'], label: '' },
          ],
        } as Partial<DataExplorerState>)
      )
    );

    expect(params.get('type')).toBeNull();
    expect(params.get('category_id')).toBeNull();
  });
});

describe('productQuery', () => {
  it('يضيف التقسيم فوق المرشّحات نفسها', () => {
    const explorer = state({ page: 3, perPage: 50, search: 'قهوة' });
    const list = new URLSearchParams(productQuery(explorer));
    const filters = new URLSearchParams(productFilterQuery(explorer));

    expect(list.get('page')).toBe('3');
    expect(list.get('per_page')).toBe('50');
    expect(list.get('search')).toBe(filters.get('search'));
    expect(list.get('sort')).toBe(filters.get('sort'));
  });
});

describe('PRODUCT_SORT_COLUMNS', () => {
  it('يطابق أعمدة الفرز التي يقبلها الخادم ولا يعد بغيرها', () => {
    expect(PRODUCT_SORT_COLUMNS).toEqual(['sku', 'name', 'sale_price', 'purchase_price', 'quantity_on_hand']);
    expect(PRODUCT_SORT_COLUMNS).not.toContain('barcode');
    expect(PRODUCT_SORT_COLUMNS).not.toContain('type');
  });
});
