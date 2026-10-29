import { describe, expect, it } from 'vitest';
import {
  EMPTY_STOCK_PERMIT_HEADER,
  mappingForPermitType,
  stockPermitHeaderGaps,
  stockPermitHeaderReady,
  stockPermitInspectFormData,
  stockPermitJobOptions,
  stockPermitMappingGaps,
  stockPermitPreviewFormData,
  suggestedStockPermitMapping,
  type StockPermitHeader,
} from './contract';

const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const header = (patch: Partial<StockPermitHeader> = {}): StockPermitHeader => ({ ...EMPTY_STOCK_PERMIT_HEADER, permitType: 'receipt', warehouseId: W1, ...patch });
const file = new File(['x'], 'p.csv', { type: 'text/csv' });

describe('stock permit import contract', () => {
  it('needs a type and warehouse, plus a distinct destination for a transfer', () => {
    expect(stockPermitHeaderReady(EMPTY_STOCK_PERMIT_HEADER)).toBe(false);
    expect(stockPermitHeaderReady(header())).toBe(true);
    expect(stockPermitHeaderGaps(header({ permitType: 'transfer' })).missingTarget).toBe(true);
    expect(stockPermitHeaderGaps(header({ permitType: 'transfer', targetWarehouseId: W1 })).sameWarehouse).toBe(true);
    expect(stockPermitHeaderReady(header({ permitType: 'transfer', targetWarehouseId: W2 }))).toBe(true);
    // الوجهة المتبقية في الحالة لا تُلزم غير التحويل ولا تُعدّ تعارضاً
    expect(stockPermitHeaderReady(header({ permitType: 'issue', targetWarehouseId: W1 }))).toBe(true);
  });

  it('sends the destination only for a transfer and zero-cost only for a receipt', () => {
    const issue = stockPermitPreviewFormData(file, header({ permitType: 'issue', targetWarehouseId: W2, allowZeroCost: true }));
    expect(issue.get('target_warehouse_id')).toBeNull();
    expect(issue.get('allow_zero_cost')).toBeNull();
    const transfer = stockPermitPreviewFormData(file, header({ permitType: 'transfer', targetWarehouseId: W2 }));
    expect(transfer.get('target_warehouse_id')).toBe(W2);
    const receipt = stockPermitPreviewFormData(file, header({ allowZeroCost: true, reason: ' تلف ', notes: '', permitDate: '2026-03-10' }));
    expect([receipt.get('allow_zero_cost'), receipt.get('reason'), receipt.get('notes'), receipt.get('permit_date')]).toEqual(['1', 'تلف', null, '2026-03-10']);
    expect(stockPermitPreviewFormData(file, header()).get('permit_date')).toBeNull();
  });

  it('inspects with the header required by the server and nothing else', () => {
    const form = stockPermitInspectFormData(file, header({ permitType: 'transfer', targetWarehouseId: W2, reason: 'x' }));
    expect([form.get('permit_type'), form.get('warehouse_id'), form.get('target_warehouse_id'), form.get('reason')]).toEqual(['transfer', W1, W2, null]);
  });

  it('sends ignored columns explicitly in the preview mapping', () => {
    const form = stockPermitPreviewFormData(file, header(), { 0: 'sku', 1: null });
    expect([form.get('mapping[0]'), form.get('mapping[1]')]).toEqual(['sku', 'ignore']);
  });

  it('freezes the preview-resolved date, not the empty field, into the job options', () => {
    const options = stockPermitJobOptions(header({ permitDate: '' }), '2026-03-10', { 0: 'sku', 1: null });
    expect(options).toEqual({ permit_type: 'receipt', warehouse_id: W1, permit_date: '2026-03-10', mapping: { 0: 'sku', 1: null } });
    const issue = stockPermitJobOptions(header({ permitType: 'issue', targetWarehouseId: W2, allowZeroCost: true, reason: 'تلف' }), '2026-03-10');
    expect(issue).toEqual({ permit_type: 'issue', warehouse_id: W1, permit_date: '2026-03-10', reason: 'تلف' });
    expect(stockPermitJobOptions(header({ allowZeroCost: true }), '2026-03-10').allow_zero_cost).toBe(true);
  });

  it('requires an identifier and quantity, forbids duplicates, and ties cost to the receipt', () => {
    const base = { 0: 'sku', 1: 'quantity', 2: 'unit_cost' };
    expect(stockPermitMappingGaps(base, header())).toEqual({ missingIdentifier: false, missingQuantity: false, duplicate: false, costOnNonReceipt: false, missingCost: false });
    expect(stockPermitMappingGaps({ 0: 'product_name', 1: 'quantity', 2: 'unit_cost' }, header()).missingIdentifier).toBe(true);
    expect(stockPermitMappingGaps({ 0: 'sku', 2: 'unit_cost' }, header()).missingQuantity).toBe(true);
    expect(stockPermitMappingGaps({ 0: 'sku', 1: 'sku', 2: 'quantity' }, header()).duplicate).toBe(true);
    expect(stockPermitMappingGaps(base, header({ permitType: 'issue' })).costOnNonReceipt).toBe(true);
    expect(stockPermitMappingGaps({ 0: 'sku', 1: 'quantity' }, header()).missingCost).toBe(true);
    expect(stockPermitMappingGaps({ 0: 'sku', 1: 'quantity' }, header({ allowZeroCost: true })).missingCost).toBe(false);
    expect(stockPermitMappingGaps({ 0: 'sku', 1: 'quantity' }, header({ permitType: 'issue' })).missingCost).toBe(false);
  });

  it('drops the cost column from the suggested mapping for non-receipts only', () => {
    const columns = [
      { index: 0, header: 'sku', samples: [], suggested_field: 'sku' },
      { index: 1, header: 'cost', samples: [], suggested_field: 'unit_cost' },
    ];
    expect(suggestedStockPermitMapping(columns, 'receipt')).toEqual({ 0: 'sku', 1: 'unit_cost' });
    expect(suggestedStockPermitMapping(columns, 'issue')).toEqual({ 0: 'sku', 1: null });
    expect(mappingForPermitType({ 0: 'sku', 1: 'unit_cost' }, 'transfer')).toEqual({ 0: 'sku', 1: null });
    expect(mappingForPermitType({ 0: 'sku', 1: 'unit_cost' }, 'receipt')).toEqual({ 0: 'sku', 1: 'unit_cost' });
  });
});
