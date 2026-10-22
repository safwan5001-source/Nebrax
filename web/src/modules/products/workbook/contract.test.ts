import { describe, expect, it } from 'vitest';
import { effectiveMapping, readInspection, unrecognizedColumns, workbookFormData, type WorkbookInspection } from './contract';

const sheet = (total_rows: number, columns: { index: number; header: string; suggested_field: string | null }[], present = true) => ({
  present,
  total_rows,
  columns,
});

const inspection = (products = sheet(2, [{ index: 0, header: 'Name', suggested_field: 'name' }])): WorkbookInspection => ({
  sheets: { products, barcodes: sheet(0, [], false), unit_prices: sheet(0, [], false) },
  fields: { products: [], barcodes: [], unit_prices: [] },
});

describe('workbook contract (IMP-H2-S3)', () => {
  it('readInspection يرفض أي رد ناقص الشكل بدل أن يفترض فحصاً', () => {
    expect(readInspection({})).toBeNull();
    expect(readInspection(null)).toBeNull();
    expect(readInspection({ sheets: { products: sheet(0, []) }, fields: {} })).toBeNull();
    expect(readInspection(inspection())).not.toBeNull();
  });

  it('effectiveMapping لا ترسل مطابقة إلا لورقة منتجات موجودة وفيها بيانات وأعمدة', () => {
    const mapping = { 0: 'name' };
    expect(effectiveMapping(null, mapping)).toBeUndefined();
    expect(effectiveMapping(inspection(sheet(2, [], true)), mapping)).toBeUndefined();
    expect(effectiveMapping(inspection(sheet(0, [{ index: 0, header: 'Name', suggested_field: 'name' }])), mapping)).toBeUndefined();
    expect(effectiveMapping(inspection(sheet(2, [{ index: 0, header: 'Name', suggested_field: 'name' }], false)), mapping)).toBeUndefined();
    expect(effectiveMapping(inspection(), mapping)).toBe(mapping);
  });

  it('unrecognizedColumns تتجاهل الترويسات الفارغة', () => {
    expect(
      unrecognizedColumns(sheet(1, [
        { index: 0, header: 'Barcode', suggested_field: 'barcode' },
        { index: 1, header: 'Colour', suggested_field: null },
        { index: 2, header: '', suggested_field: null },
      ]))
    ).toEqual(['Colour']);
  });

  it('workbookFormData يرسل العمود المتجاهَل صراحةً ولا يرسل مطابقة حين لا مطابقة', () => {
    const file = new File(['x'], 'w.xlsx');
    const withMapping = workbookFormData(file, { priceListId: 'pl', mapping: { 0: 'name', 1: null } });
    expect(withMapping.get('mapping[0]')).toBe('name');
    expect(withMapping.get('mapping[1]')).toBe('ignore');
    expect([...workbookFormData(file, { priceListId: 'pl' }).keys()].some((key) => key.startsWith('mapping'))).toBe(false);
  });
});
