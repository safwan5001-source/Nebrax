import { describe, expect, it } from 'vitest';
import {
  IDENTIFIER_FIELDS,
  fieldLabel,
  importFormData,
  mappingGaps,
  reportRows,
  suggestedMapping,
  type ImportField,
  type InspectedColumn,
  type PreviewRow,
} from './contract';

function field(key: string, extra: Partial<ImportField> = {}): ImportField {
  return {
    key,
    label_ar: `عربي ${key}`,
    label_en: `English ${key}`,
    type: 'text',
    required: false,
    clearable: true,
    update_locked: false,
    writable: true,
    ...extra,
  };
}

const fields: ImportField[] = [
  field('nebrax_id', { type: 'identifier', writable: false, clearable: false, update_locked: true }),
  field('sku', { clearable: false }),
  field('name', { required: true, clearable: false }),
  field('type', { required: true, clearable: false, update_locked: true, type: 'enum' }),
  field('sale_price', { required: true, clearable: false, type: 'money' }),
  field('barcode'),
];

describe('mappingGaps', () => {
  it('يطالب بالحقول المطلوبة في وضع الإنشاء', () => {
    const gaps = mappingGaps({ 0: 'sku', 1: 'barcode' }, fields, 'create');

    expect(gaps.missingRequired.map((item) => item.key)).toEqual(['name', 'type', 'sale_price']);
    expect(gaps.missingIdentifier).toBe(false);
    expect(gaps.duplicate).toBe(false);
  });

  it('لا يطالب بالحقول المطلوبة في وضع التحديث', () => {
    const gaps = mappingGaps({ 0: 'sku', 1: 'barcode' }, fields, 'update');

    expect(gaps.missingRequired).toEqual([]);
    expect(gaps.missingIdentifier).toBe(false);
  });

  it('يرفض التحديث بلا معرّف — والاسم ليس معرّفاً', () => {
    const gaps = mappingGaps({ 0: 'name', 1: 'barcode' }, fields, 'update');

    expect(gaps.missingIdentifier).toBe(true);
    expect(IDENTIFIER_FIELDS).not.toContain('name');
  });

  it('يقبل معرّف نبراكس بديلاً عن رمز الصنف', () => {
    expect(mappingGaps({ 0: 'nebrax_id' }, fields, 'update').missingIdentifier).toBe(false);
  });

  it('يطالب الدمج بالمطلوب وبالمعرّف معاً', () => {
    const gaps = mappingGaps({ 0: 'name', 1: 'type', 2: 'sale_price' }, fields, 'upsert');

    expect(gaps.missingRequired).toEqual([]);
    expect(gaps.missingIdentifier).toBe(true);
  });

  it('يكشف ربط عمودين بالحقل نفسه', () => {
    expect(mappingGaps({ 0: 'name', 1: 'name' }, fields, 'create').duplicate).toBe(true);
  });

  it('يتجاهل الأعمدة غير المربوطة', () => {
    const gaps = mappingGaps({ 0: 'sku', 1: null, 2: null }, fields, 'update');

    expect(gaps.duplicate).toBe(false);
    expect(gaps.missingIdentifier).toBe(false);
  });
});

describe('suggestedMapping', () => {
  it('ينقل اقتراح الخادم كما هو بما فيه الأعمدة الغامضة', () => {
    const columns: InspectedColumn[] = [
      { index: 0, header: 'Product Name', samples: ['قهوة'], suggested_field: 'name' },
      { index: 1, header: 'Mystery', samples: [''], suggested_field: null },
    ];

    expect(suggestedMapping(columns)).toEqual({ 0: 'name', 1: null });
  });
});

describe('importFormData', () => {
  it('يرسل الملف والوضع والسياسات', () => {
    const file = new File(['sku,name'], 'products.csv', { type: 'text/csv' });
    const form = importFormData(file, {
      mode: 'upsert',
      blankPolicy: 'clear',
      masterDataPolicy: 'match_or_error',
    });

    expect(form.get('mode')).toBe('upsert');
    expect(form.get('blank_policy')).toBe('clear');
    expect(form.get('master_data_policy')).toBe('match_or_error');
    expect((form.get('file') as File).name).toBe('products.csv');
  });

  it('يرسل العمود المتجاهَل صراحةً كي لا تعود المطابقة التلقائية', () => {
    const file = new File([''], 'products.csv');
    const form = importFormData(file, { mapping: { 0: 'sku', 1: null } });

    expect(form.get('mapping[0]')).toBe('sku');
    expect(form.get('mapping[1]')).toBe('ignore');
  });

  it('لا يرسل مفاتيح لم تُطلب', () => {
    const form = importFormData(new File([''], 'p.csv'));

    expect(form.get('mode')).toBeNull();
    expect(form.get('blank_policy')).toBeNull();
    expect(form.get('mapping[0]')).toBeNull();
  });
});

describe('reportRows', () => {
  it('يسطّح صفوف النتيجة إلى تقرير قابل للتنزيل', () => {
    const rows: PreviewRow[] = [
      {
        row: 2, action: 'error', status: 'error', valid: false,
        sku: 'SKU-1', name: 'قهوة', type: 'good', barcode: null,
        messages: ['رمز SKU مكرر', 'الباركود مستخدم'],
      },
    ];

    expect(reportRows(rows)).toEqual([[2, 'SKU-1', 'قهوة', 'error', 'error', 'رمز SKU مكرر — الباركود مستخدم']]);
  });
});

describe('fieldLabel', () => {
  it('يختار التسمية بحسب اللغة النشطة', () => {
    expect(fieldLabel(field('sku'), 'ar')).toBe('عربي sku');
    expect(fieldLabel(field('sku'), 'en')).toBe('English sku');
  });
});
