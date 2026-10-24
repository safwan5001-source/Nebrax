import { describe, expect, it } from 'vitest';
import { spreadsheetSafe, stocktakeImportFormData, stocktakeJobOptions, stocktakeMappingGaps, suggestedStocktakeMapping } from './contract';

describe('stocktake count import contract (IMP-H7-S1c)', () => {
  it('needs a product identifier (sku/barcode/nebrax id — never the name) and the counted quantity, one column per field', () => {
    expect(stocktakeMappingGaps({ 0: 'product_name', 1: 'counted_quantity' })).toEqual({ missingIdentifier: true, missingQuantity: false, duplicate: false });
    expect(stocktakeMappingGaps({ 0: 'sku' }).missingQuantity).toBe(true);
    for (const id of ['sku', 'barcode', 'nebrax_id']) {
      expect(stocktakeMappingGaps({ 0: id, 1: 'counted_quantity' })).toEqual({ missingIdentifier: false, missingQuantity: false, duplicate: false });
    }
    expect(stocktakeMappingGaps({ 0: 'sku', 1: 'sku', 2: 'counted_quantity' }).duplicate).toBe(true);
  });

  it('sends the target stocktake, the policy and an explicit "ignore" for unmatched columns', () => {
    const form = stocktakeImportFormData(new File(['x'], 's.csv'), { stocktakeId: 'st-1', existingCountPolicy: 'overwrite', mapping: { 0: 'sku', 1: null } });
    expect([form.get('stocktake_id'), form.get('existing_count_policy'), form.get('mapping[0]'), form.get('mapping[1]')]).toEqual(['st-1', 'overwrite', 'sku', 'ignore']);
  });

  it('builds job options identical to the preview ones', () => {
    expect(stocktakeJobOptions({ stocktakeId: 'st-1', existingCountPolicy: 'error' })).toEqual({ stocktake_id: 'st-1', existing_count_policy: 'error' });
    expect(stocktakeJobOptions({ stocktakeId: 'st-1', existingCountPolicy: 'skip', mapping: { 0: 'sku' } })).toEqual({ stocktake_id: 'st-1', existing_count_policy: 'skip', mapping: { 0: 'sku' } });
  });

  it('adopts the server suggestion and neutralises spreadsheet formulas', () => {
    expect(suggestedStocktakeMapping([{ index: 0, header: 'h', samples: [], suggested_field: 'sku' }, { index: 1, header: 'x', samples: [], suggested_field: null }])).toEqual({ 0: 'sku', 1: null });
    expect(spreadsheetSafe('=1+1')).toBe("'=1+1");
  });
});
