import { describe, expect, it } from 'vitest';
import { hasMappedField, mergePresetMapping, presetColumnsFromMapping } from './mapping-presets';

const allowed = new Set(['sku', 'quantity', 'unit_cost', 'barcode']);
const match = (mapping: Record<number, string | null>, unmatched: number[]) => ({ mapping, matched: Object.keys(mapping).length - unmatched.length, unmatched });

describe('mapping presets (pure logic)', () => {
  it('saves the current mapping in file-column order, with ignored columns as no field', () => {
    const columns = [{ index: 0, header: 'رمز' }, { index: 1, header: 'الكمية' }, { index: 2, header: 'ملاحظة' }];
    expect(presetColumnsFromMapping(columns, { 0: 'sku', 1: 'quantity', 2: null })).toEqual([
      { header: 'رمز', field: 'sku' }, { header: 'الكمية', field: 'quantity' }, { header: 'ملاحظة', field: null },
    ]);
    expect(presetColumnsFromMapping(columns, {})).toEqual([{ header: 'رمز', field: null }, { header: 'الكمية', field: null }, { header: 'ملاحظة', field: null }]);
  });

  it('detects whether a mapping has anything worth saving', () => {
    expect(hasMappedField({ 0: null, 1: null })).toBe(false);
    expect(hasMappedField({ 0: null, 1: 'sku' })).toBe(true);
    expect(hasMappedField({})).toBe(false);
  });

  it('a matched column takes the saved field; an unmatched column keeps its current mapping', () => {
    const merged = mergePresetMapping({ 0: 'barcode', 1: null, 2: 'unit_cost' }, match({ 0: 'sku', 1: 'quantity', 2: null }, [2]), allowed);
    expect(merged.mapping).toEqual({ 0: 'sku', 1: 'quantity', 2: 'unit_cost' });
    expect(merged.applied).toBe(2);
    expect(merged.dropped).toBe(0);
  });

  it('drops a saved field the current file contract does not know instead of sending it to the server', () => {
    const merged = mergePresetMapping({ 0: 'sku', 1: 'quantity' }, match({ 0: 'legacy_field', 1: 'quantity' }, []), allowed);
    expect(merged.mapping).toEqual({ 0: null, 1: 'quantity' });
    expect(merged.dropped).toBe(1);
    expect(merged.applied).toBe(1);
  });

  it('never leaves one field on two columns: the saved binding wins over an automatic suggestion on an unmatched column', () => {
    // العمود 2 غير مطابق لكن اقتراحه التلقائي sku؛ المحفوظ يربط sku بالعمود 0
    const merged = mergePresetMapping({ 0: null, 1: null, 2: 'sku' }, match({ 0: 'sku', 1: 'quantity', 2: null }, [2]), allowed);
    expect(merged.mapping).toEqual({ 0: 'sku', 1: 'quantity', 2: null });
  });

  it('a matched column saved as ignored clears its current suggestion', () => {
    const merged = mergePresetMapping({ 0: 'sku', 1: 'quantity' }, match({ 0: null, 1: 'quantity' }, []), allowed);
    expect(merged.mapping).toEqual({ 0: null, 1: 'quantity' });
    expect(merged.applied).toBe(1);
  });
});
