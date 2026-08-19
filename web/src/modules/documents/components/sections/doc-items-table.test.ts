import { describe, expect, it } from 'vitest';
import { usesMonospaceValue } from './doc-items-table';

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
