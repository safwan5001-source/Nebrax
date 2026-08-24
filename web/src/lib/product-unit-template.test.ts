import { describe, expect, it } from 'vitest';
import { productUnitForTemplate } from './product-unit-template';

const templates = [
  { id: 'template-piece', name: 'قالب القطعة', base_unit: 'قطعة' },
  { id: 'template-carton', name: 'قالب الكرتون', base_unit: 'كرتون' },
];

describe('productUnitForTemplate', () => {
  it('يستبدل وحدة المنتج بوحدة الأساس للقالب المختار', () => {
    expect(productUnitForTemplate('template-carton', templates, 'قطعة')).toBe('كرتون');
  });

  it('يبقي الوحدة الحالية عند إزالة القالب أو وصول معرّف غير معروف', () => {
    expect(productUnitForTemplate('', templates, 'علبة')).toBe('علبة');
    expect(productUnitForTemplate('unknown', templates, 'علبة')).toBe('علبة');
  });
});
