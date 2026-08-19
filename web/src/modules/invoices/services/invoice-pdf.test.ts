import { describe, expect, it } from 'vitest';
import type { DocSectionLayoutItem } from '@/modules/documents/types';
import { getInvoicePdfOrientation, resolvePdfBlockContent } from './invoice-pdf';

const visibleTerms = (staticContent?: string): DocSectionLayoutItem[] => [
  { key: 'terms', visible: true, properties: staticContent === undefined ? undefined : { static_content: staticContent } },
  { key: 'bank', visible: false },
];

describe('تخطيط جدول PDF المتجهي', () => {
  it('يستخدم A4 أفقياً مع ترتيب الأعمدة الكامل', () => {
    expect(getInvoicePdfOrientation([
      { id: 'number' }, { id: 'product_code' }, { id: 'barcode' }, { id: 'product' },
      { id: 'description' }, { id: 'unit_price' }, { id: 'quantity' },
      { id: 'price_before_tax' }, { id: 'tax' }, { id: 'total' },
    ])).toBe('landscape');
  });

  it('يبقي الجداول المختصرة على A4 رأسي', () => {
    expect(getInvoicePdfOrientation([{ id: 'description' }, { id: 'quantity' }, { id: 'total' }])).toBe('portrait');
  });
});

describe('محتوى كتل PDF المتجهية', () => {
  it('يستخدم المحتوى الثابت للمراجعة المنشورة قبل القيمة الديناميكية', () => {
    expect(resolvePdfBlockContent(visibleTerms('يُسدَّد خلال 30 يوماً'), 'terms', 'قيمة حية أحدث'))
      .toBe('يُسدَّد خلال 30 يوماً');
  });

  it('لا يعرض كتلة مخفية حتى لو وُجدت قيمة ديناميكية', () => {
    expect(resolvePdfBlockContent(visibleTerms(), 'bank', 'IBAN SA0000000000000000000000')).toBeNull();
  });

  it('يعامل المحتوى الثابت الفارغ كتعطيل صريح ولا يتراجع للقيمة الديناميكية', () => {
    expect(resolvePdfBlockContent(visibleTerms('   '), 'terms', 'قيمة حية أحدث')).toBeNull();
  });

  it('يعرض القيمة الديناميكية فقط عند ظهور الكتلة وغياب محتواها الثابت', () => {
    expect(resolvePdfBlockContent(visibleTerms(), 'terms', 'قيمة متوافقة')).toBe('قيمة متوافقة');
  });
});
