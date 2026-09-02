import { describe, expect, it } from 'vitest';
import { usesMonospaceValue } from './doc-items-table';
import {
  MODERN_ITEMS_ROW_CLASS,
  MODERN_ITEMS_TABLE_CLASS,
  modernItemsColumnWidthClass,
  modernItemsValueCellClass,
} from '../../presentation/visual-v2';

describe('usesMonospaceValue', () => {
  it('يبقي اسم المنتج ووصفه على خط الواجهة الداعم للعربية', () => {
    expect(usesMonospaceValue('product')).toBe(false);
    expect(usesMonospaceValue('description')).toBe(false);
  });

  it('يحافظ على الخط الأحادي للأرقام والأكواد', () => {
    expect(usesMonospaceValue('number')).toBe(true);
    expect(usesMonospaceValue('product_code')).toBe(true);
    expect(usesMonospaceValue('barcode')).toBe(true);
    expect(usesMonospaceValue('quantity')).toBe(true);
    expect(usesMonospaceValue('unit_price')).toBe(true);
    expect(usesMonospaceValue('tax')).toBe(true);
    expect(usesMonospaceValue('total')).toBe(true);
  });
});

describe('Modern items table presentation', () => {
  it('يثبّت عرضاً ثابتاً بلا overflow أفقي وبدون تناوب ملوّن', () => {
    expect(MODERN_ITEMS_TABLE_CLASS).toContain('table-fixed');
    expect(MODERN_ITEMS_ROW_CLASS).not.toMatch(/bg-|brand-soft/);
  });

  it('يلف الوصف بأمان ويبقي الأرقام في سطر واحد', () => {
    expect(modernItemsValueCellClass('description')).toContain('break-words');
    expect(modernItemsValueCellClass('product')).toContain('min-w-0');
    expect(modernItemsValueCellClass('quantity')).toContain('whitespace-nowrap');
    expect(modernItemsColumnWidthClass('number')).toBe('w-[4%]');
  });
});
