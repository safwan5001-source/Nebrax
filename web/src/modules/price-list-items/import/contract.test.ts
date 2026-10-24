import { describe, expect, it } from 'vitest';
import {
  priceListImportFormData,
  priceListJobOptions,
  priceListMappingGaps,
  spreadsheetSafe,
  suggestedPriceListMapping,
} from './contract';

describe('price list import contract (IMP-H4-S6b)', () => {
  it('requires the price column and a product identifier, and flags a field mapped twice', () => {
    expect(priceListMappingGaps({ 0: 'sku', 1: 'price' })).toEqual({ missingPrice: false, missingIdentifier: false, duplicate: false });
    expect(priceListMappingGaps({ 0: 'nebrax_id', 1: 'price' }).missingIdentifier).toBe(false);
    expect(priceListMappingGaps({ 0: 'sku', 1: null }).missingPrice).toBe(true);
    // اسم المنتج ليس معرّفاً ولا وحدةً: لا يكفي وحده.
    expect(priceListMappingGaps({ 0: 'unit_name', 1: 'price' }).missingIdentifier).toBe(true);
    expect(priceListMappingGaps({ 0: 'sku', 1: 'sku', 2: 'price' }).duplicate).toBe(true);
  });

  it('sends the same options to the preview and to the frozen job so their fingerprints match', () => {
    const options = { priceListId: 'pl-1', mode: 'upsert' as const, mapping: { 0: 'sku', 1: null, 2: 'price' } };
    const form = priceListImportFormData(new File(['x'], 'p.csv'), options);
    const job = priceListJobOptions(options);

    expect([form.get('price_list_id'), form.get('mode'), form.get('mapping[0]'), form.get('mapping[1]'), form.get('mapping[2]')]).toEqual(['pl-1', 'upsert', 'sku', 'ignore', 'price']);
    expect(job).toEqual({ price_list_id: 'pl-1', mode: 'upsert', mapping: { 0: 'sku', 1: null, 2: 'price' } });
  });

  it('omits the mapping when none was inspected and takes suggestions from the server', () => {
    expect(priceListJobOptions({ priceListId: 'pl-1', mode: 'create' })).toEqual({ price_list_id: 'pl-1', mode: 'create' });
    expect(suggestedPriceListMapping([{ index: 0, header: 'a', samples: [], suggested_field: 'sku' }, { index: 1, header: 'b', samples: [], suggested_field: null }])).toEqual({ 0: 'sku', 1: null });
  });

  it('neutralises spreadsheet formulas in the error report', () => {
    expect(spreadsheetSafe('=1+1')).toBe("'=1+1");
    expect(spreadsheetSafe('عادي')).toBe('عادي');
  });
});
