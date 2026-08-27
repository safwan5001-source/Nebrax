import { describe, expect, it } from 'vitest';
import { inventoryExportQuery, type InventoryExportState } from './export-contract';

const state: InventoryExportState = {
  search: 'إسمنت',
  sort: '-quantity_on_hand',
  filters: {
    unit: 'كيس',
    qty_min: '10',
    avg_cost_max: '50',
    stock_value_min: '100',
  },
};

const parse = (query: string): URLSearchParams => new URLSearchParams(query);

describe('عقد تصدير أرصدة المخزون', () => {
  it('يمرّر مرشّحات الشاشة كاملةً في النطاق المفلتر بلا معاملات تقسيم', () => {
    const params = parse(inventoryExportQuery(state, { scope: 'filtered', format: 'xlsx', includeZero: true, locale: 'ar' }));

    expect(params.get('scope')).toBe('filtered');
    expect(params.get('format')).toBe('xlsx');
    expect(params.get('search')).toBe('إسمنت');
    expect(params.get('sort')).toBe('-quantity_on_hand');
    expect(params.get('unit')).toBe('كيس');
    expect(params.get('qty_min')).toBe('10');
    expect(params.get('avg_cost_max')).toBe('50');
    expect(params.get('stock_value_min')).toBe('100');
    expect(params.get('page')).toBeNull();
    expect(params.get('per_page')).toBeNull();
  });

  it('يُسقط كل المرشّحات والبحث والفرز في نطاق «الكل»', () => {
    const params = parse(inventoryExportQuery(state, { scope: 'all', format: 'csv', includeZero: true, locale: 'ar' }));

    expect(params.get('scope')).toBe('all');
    expect(params.get('format')).toBe('csv');
    expect(params.get('search')).toBeNull();
    expect(params.get('sort')).toBeNull();
    expect(params.get('unit')).toBeNull();
    expect(params.get('qty_min')).toBeNull();
  });

  it('يرسل include_zero صراحةً بحالتيه', () => {
    expect(parse(inventoryExportQuery(state, { scope: 'all', format: 'csv', includeZero: true, locale: 'ar' })).get('include_zero')).toBe('1');
    expect(parse(inventoryExportQuery(state, { scope: 'all', format: 'csv', includeZero: false, locale: 'ar' })).get('include_zero')).toBe('0');
  });

  it('يطبّع اللغة إلى ar/en وحدهما', () => {
    expect(parse(inventoryExportQuery(state, { scope: 'all', format: 'csv', includeZero: true, locale: 'en-US' })).get('locale')).toBe('en');
    expect(parse(inventoryExportQuery(state, { scope: 'all', format: 'csv', includeZero: true, locale: 'ar-SA' })).get('locale')).toBe('ar');
  });

  it('يتجاهل المفاتيح الفارغة وغير المعروفة للخادم', () => {
    const params = parse(inventoryExportQuery(
      { search: '  ', filters: { unit: '  ', qty_min: '5', unknown_key: 'x' } },
      { scope: 'filtered', format: 'csv', includeZero: true, locale: 'ar' }
    ));

    expect(params.get('search')).toBeNull();
    expect(params.get('unit')).toBeNull();
    expect(params.get('qty_min')).toBe('5');
    expect(params.get('unknown_key')).toBeNull();
  });
});
