import { describe, expect, it } from 'vitest';
import {
  parseOptionalTaxRate,
  purchaseImportFormData,
  purchaseJobOptions,
  purchaseMappingGaps,
  spreadsheetSafe,
  suggestedPurchaseMapping,
  type PurchaseImportField,
  type PurchaseImportOptions,
} from './contract';

const field = (key: string, required = false): PurchaseImportField => ({ key, label_ar: key, label_en: key, type: 'text', required });
const fields = [field('supplier_invoice_ref', true), field('purchase_date', true), field('quantity', true), field('unit_price', true), field('supplier_code'), field('sku'), field('barcode'), field('product_id')];
const base: PurchaseImportOptions = { defaultSupplierId: '', defaultPaymentType: '', defaultTaxRate: null, taxInclusive: '', warehouseId: '' };
const full = { 0: 'supplier_invoice_ref', 1: 'purchase_date', 2: 'quantity', 3: 'unit_price', 4: 'sku', 5: 'supplier_code' };

describe('purchase import contract (IMP-H5-S4b)', () => {
  it('needs the invoice reference, date, quantity and price, a supplier source and a product identifier', () => {
    expect(purchaseMappingGaps({ 0: 'quantity' }, fields, base).missingRequired.map((f) => f.key)).toEqual(['supplier_invoice_ref', 'purchase_date', 'unit_price']);
    expect(purchaseMappingGaps(full, fields, base)).toEqual({ missingRequired: [], missingSupplier: false, missingProduct: false, duplicate: false });
    const noSupplier = { 0: 'supplier_invoice_ref', 1: 'purchase_date', 2: 'quantity', 3: 'unit_price', 4: 'sku' };
    expect(purchaseMappingGaps(noSupplier, fields, base).missingSupplier).toBe(true);
    expect(purchaseMappingGaps(noSupplier, fields, { ...base, defaultSupplierId: 's-1' }).missingSupplier).toBe(false);
    const noProduct = { 0: 'supplier_invoice_ref', 1: 'purchase_date', 2: 'quantity', 3: 'unit_price', 4: 'supplier_code' };
    expect(purchaseMappingGaps(noProduct, fields, base).missingProduct).toBe(true);
    for (const key of ['sku', 'barcode', 'product_id']) expect(purchaseMappingGaps({ ...noProduct, 5: key }, fields, base).missingProduct, key).toBe(false);
    expect(purchaseMappingGaps({ 0: 'sku', 1: 'sku' }, fields, base).duplicate).toBe(true);
  });

  it('sends only what the user set — blank preferences stay absent so the server resolves and freezes them', () => {
    const empty = purchaseImportFormData(new File(['x'], 'p.csv'), base);
    for (const key of ['default_supplier_id', 'default_payment_type', 'default_tax_rate', 'tax_inclusive', 'warehouse_id']) expect(empty.has(key), key).toBe(false);

    const form = purchaseImportFormData(new File(['x'], 'p.csv'), { ...base, defaultSupplierId: 's-1', defaultPaymentType: 'credit', defaultTaxRate: 0, taxInclusive: 'no', warehouseId: 'w-1', mapping: { 0: 'sku', 1: null } });
    expect(form.get('default_supplier_id')).toBe('s-1');
    expect(form.get('default_payment_type')).toBe('credit');
    expect(form.get('default_tax_rate')).toBe('0');
    expect(form.get('tax_inclusive')).toBe('0');
    expect(form.get('warehouse_id')).toBe('w-1');
    expect(form.get('mapping[0]')).toBe('sku');
    expect(form.get('mapping[1]')).toBe('ignore');
    expect(purchaseImportFormData(new File(['x'], 'p.csv'), { ...base, taxInclusive: 'yes' }).get('tax_inclusive')).toBe('1');
  });

  it('builds job options identical to the preview ones (booleans typed, blanks omitted)', () => {
    expect(purchaseJobOptions(base)).toEqual({});
    expect(purchaseJobOptions({ ...base, defaultSupplierId: 's-1', defaultPaymentType: 'cash', defaultTaxRate: 0, taxInclusive: 'no', warehouseId: 'w-1', mapping: { 0: 'sku' } })).toEqual({
      default_supplier_id: 's-1', default_payment_type: 'cash', default_tax_rate: 0, tax_inclusive: false, warehouse_id: 'w-1', mapping: { 0: 'sku' },
    });
  });

  it('adopts the server suggestion and neutralises spreadsheet formulas', () => {
    expect(suggestedPurchaseMapping([{ index: 0, header: 'h', samples: [], suggested_field: 'sku' }, { index: 1, header: 'x', samples: [], suggested_field: null }])).toEqual({ 0: 'sku', 1: null });
    expect(spreadsheetSafe('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(spreadsheetSafe('عادي')).toBe('عادي');
  });

  it('treats a blank tax rate as "use the tenant preference" and accepts only whole Latin-digit rates 0–100', () => {
    expect(parseOptionalTaxRate('')).toBeNull();
    for (const ok of ['0', '5', '15', '100']) expect(parseOptionalTaxRate(ok)).toBe(Number(ok));
    for (const bad of ['101', '1e1', '0x10', '5.0', '5.', ' 5', '-1', '١٥', '1000']) expect(parseOptionalTaxRate(bad), bad).toBeUndefined();
  });
});
