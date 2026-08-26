import { describe, expect, it } from 'vitest';
import {
  type ColumnMapping,
  type OpeningField,
  type PreviewRow,
  fieldLabel,
  importFormData,
  issueReportRows,
  mappingGaps,
  mappingReady,
  suggestedMapping,
} from './contract';

const fields: OpeningField[] = [
  { key: 'nebrax_id', label_ar: 'معرّف نبراكس', label_en: 'Nebrax ID', type: 'text', required: false },
  { key: 'sku', label_ar: 'رمز الصنف', label_en: 'SKU', type: 'text', required: false },
  { key: 'barcode', label_ar: 'الباركود', label_en: 'Barcode', type: 'text', required: false },
  { key: 'warehouse', label_ar: 'المخزن', label_en: 'Warehouse', type: 'text', required: false },
  { key: 'opening_quantity', label_ar: 'الكمية', label_en: 'Quantity', type: 'quantity', required: true },
  { key: 'opening_unit_cost', label_ar: 'تكلفة الوحدة', label_en: 'Unit cost', type: 'money', required: true },
];

const complete: ColumnMapping = {
  0: 'sku',
  1: 'warehouse',
  2: 'opening_quantity',
  3: 'opening_unit_cost',
};

describe('عقد الأرصدة الافتتاحية', () => {
  it('يعتبر المطابقة جاهزة حين تغطّي المعرّفين والحقلين المطلوبين', () => {
    expect(mappingReady(complete, fields)).toBe(true);
    expect(mappingGaps(complete, fields)).toEqual({
      missingRequired: [],
      missingProduct: false,
      missingWarehouse: false,
      duplicate: false,
    });
  });

  it('يرفض مطابقة بلا معرّف صنف', () => {
    const gaps = mappingGaps({ ...complete, 0: null }, fields);
    expect(gaps.missingProduct).toBe(true);
    expect(mappingReady({ ...complete, 0: null }, fields)).toBe(false);
  });

  it('يرفض مطابقة بلا مخزن — والمخزن ليس اختيارياً هنا', () => {
    const gaps = mappingGaps({ ...complete, 1: null }, fields);
    expect(gaps.missingWarehouse).toBe(true);
  });

  it('يقبل الباركود ومعرّف نبراكس بديلين عن رمز الصنف', () => {
    expect(mappingReady({ ...complete, 0: 'barcode' }, fields)).toBe(true);
    expect(mappingReady({ ...complete, 0: 'nebrax_id' }, fields)).toBe(true);
  });

  it('يسمّي كل حقل مطلوب غير مربوط', () => {
    const gaps = mappingGaps({ 0: 'sku', 1: 'warehouse' }, fields);
    expect(gaps.missingRequired.map((field) => field.key)).toEqual(['opening_quantity', 'opening_unit_cost']);
  });

  it('يرصد عمودين مربوطين بالحقل نفسه', () => {
    expect(mappingGaps({ ...complete, 4: 'sku' }, fields).duplicate).toBe(true);
  });

  it('يحوّل اقتراح الخادم إلى حالة قابلة للتحرير', () => {
    expect(
      suggestedMapping([
        { index: 0, header: 'رمز الصنف', samples: [], suggested_field: 'sku' },
        { index: 1, header: 'عمود غامض', samples: [], suggested_field: null },
      ])
    ).toEqual({ 0: 'sku', 1: null });
  });

  it('يبني FormData بأسماء المعاملات التي يقرؤها الخادم', () => {
    const file = new File(['x'], 'openings.csv', { type: 'text/csv' });
    const form = importFormData(file, {
      openingDate: '2026-01-01',
      allowZeroCost: true,
      notes: 'افتتاح',
      mapping: { 0: 'sku', 1: null },
    });

    expect(form.get('opening_date')).toBe('2026-01-01');
    expect(form.get('allow_zero_cost')).toBe('1');
    expect(form.get('notes')).toBe('افتتاح');
    expect(form.get('mapping[0]')).toBe('sku');
    // العمود المتجاهَل يُرسَل صراحةً كي لا تعود المطابقة التلقائية فتربطه.
    expect(form.get('mapping[1]')).toBe('ignore');
  });

  it('لا يرسل السماح بتكلفة صفر ما لم يُفعّل صراحةً', () => {
    const form = importFormData(new File(['x'], 'o.csv'), { openingDate: '2026-01-01' });
    expect(form.get('allow_zero_cost')).toBeNull();
  });

  it('يبني تقرير الأخطاء من الصفوف الفاشلة وحدها، سطراً لكل مشكلة', () => {
    const rows: PreviewRow[] = [
      {
        row: 2, status: 'valid', sku: 'A', barcode: null, product_name: 'صنف', warehouse: 'WH-1',
        quantity: 1, unit_cost: '1.00', total_cost: '1.00', notes: null, issues: [],
      },
      {
        row: 3, status: 'error', sku: 'B', barcode: null, product_name: null, warehouse: 'WH-1',
        quantity: null, unit_cost: null, total_cost: null, notes: null,
        issues: [
          { code: 'product_not_found', field: 'sku', value: 'B', message: 'غير موجود' },
          { code: 'invalid_quantity', field: 'opening_quantity', value: 'x', message: 'كمية غير صالحة' },
        ],
      },
    ];

    expect(issueReportRows(rows)).toEqual([
      [3, 'B', 'WH-1', 'product_not_found', 'sku', 'غير موجود'],
      [3, 'B', 'WH-1', 'invalid_quantity', 'opening_quantity', 'كمية غير صالحة'],
    ]);
  });

  it('يعرض التسمية بلغة الواجهة', () => {
    const quantity = fields[4];
    expect(fieldLabel(quantity, 'ar')).toBe('الكمية');
    expect(fieldLabel(quantity, 'en')).toBe('Quantity');
  });
});
