import { describe, expect, it } from 'vitest';
import { getTheme } from '../themes';
import { makeDocumentQaModel } from '../qa/document-qa-fixtures';
import type { DocumentLine, DocumentModel } from '../types';
import {
  PREMIUM_COLUMN_LABELS,
  mixHex,
  premiumColumnWidths,
  premiumDefaultColumns,
  premiumMetaTiles,
  premiumPalette,
  premiumResolveColumns,
  premiumSkuLine,
  premiumTotalsRows,
  PREMIUM_STUDIO_DEFAULT_COLUMNS,
} from './tax-invoice-premium';

const reference = (): DocumentModel => makeDocumentQaModel({ scenario: 'reference_sample', direction: 'rtl', showQr: true, showAssets: true });
const line = (over: Partial<DocumentLine> = {}): DocumentLine => ({ id: 'l', description: 'x', quantity: 1, unitPrice: 100, tax: 15, total: 115, ...over });

describe('premium palette', () => {
  it('mixes hex colours and leaves non-hex input untouched', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('rgb(1,2,3)', '#ffffff', 0.5)).toBe('rgb(1,2,3)');
  });

  it('uses the deep green + lime identity for the green theme and derives deep from the brand for the others', () => {
    expect(premiumPalette(getTheme('green'))).toMatchObject({ deep: '#0b3d2e', accent: '#c6f221' });
    const blue = premiumPalette(getTheme('blue'));
    expect(blue.deep).toBe(mixHex('#1e40af', '#000000', 0.45));
    // لا `color-mix` ولا var() في القيم: مصدّر PDF لا يفسّرها.
    for (const value of Object.values(blue)) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('derives an accent for a custom theme from its own brand', () => {
    const custom = premiumPalette(getTheme('custom', { brand: '#336699', brandContrast: '#ffffff', brandSoft: '#eef2ff' }));
    expect(custom.accent).toBe(mixHex('#336699', '#ffffff', 0.7));
  });
});

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrastOnWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

describe('premium palette legibility', () => {
  it('secondary (muted) text reaches WCAG AA 4.5:1 on white for every selectable theme', () => {
    for (const id of ['green', 'blue', 'orange', 'purple', 'gray', 'black'] as const) {
      const { muted } = premiumPalette(getTheme(id));
      expect(contrastOnWhite(muted), id).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('premium columns', () => {
  it('shows the reference columns (unit, discount, taxable, rate) when the source provides them', () => {
    const ids = premiumDefaultColumns(reference().lines).map((c) => c.id);
    expect(ids).toEqual(['number', 'product', 'unit', 'quantity', 'price_before_tax', 'line_discount', 'line_net', 'tax_rate', 'tax', 'total']);
    // السعر قبل الضريبة يُسمّى «سعر الوحدة» كالمرجع.
    expect(premiumDefaultColumns(reference().lines).find((c) => c.id === 'price_before_tax')?.label).toEqual(PREMIUM_COLUMN_LABELS.unit_price);
  });

  it('drops columns the source cannot fill instead of inventing values (legacy payload)', () => {
    const ids = premiumDefaultColumns([line()]).map((c) => c.id);
    expect(ids).toEqual(['number', 'product', 'quantity', 'unit_price', 'tax', 'total']);
  });

  it('treats an unknown discount (null) differently from a known zero', () => {
    expect(premiumDefaultColumns([line({ lineDiscount: null })]).map((c) => c.id)).not.toContain('line_discount');
    expect(premiumDefaultColumns([line({ lineDiscount: 0 })]).map((c) => c.id)).toContain('line_discount');
  });

  it('normalises widths to 100% for any visible subset', () => {
    for (const lines of [reference().lines, [line()]]) {
      const sum = premiumColumnWidths(premiumDefaultColumns(lines)).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(100, 6);
    }
  });
});

describe('premium totals rows (no independent recompute)', () => {
  it('shows subtotal, discount, derived taxable, VAT in order — the derived row equals subtotal − discount only', () => {
    const model = reference();
    const rows = premiumTotalsRows(model);
    expect(rows.map((r) => r.key)).toEqual(['subtotal', 'discount', 'taxable', 'vat']);
    expect(rows.find((r) => r.key === 'taxable')?.amount).toBe(model.totals.subtotal - (model.totals.discount ?? 0));
    expect(rows.find((r) => r.key === 'vat')?.amount).toBe(model.totals.tax);
  });

  it('omits the taxable row when the stored totals do not reconcile, or shipping/adjustment exist', () => {
    const base = reference();
    expect(premiumTotalsRows({ ...base, totals: { ...base.totals, total: base.totals.total + 1 } }).map((r) => r.key)).not.toContain('taxable');
    expect(premiumTotalsRows({ ...base, totals: { ...base.totals, shipping: 500, total: base.totals.total + 500 } }).map((r) => r.key)).toEqual(['subtotal', 'discount', 'shipping', 'vat']);
    expect(premiumTotalsRows({ ...base, totals: { ...base.totals, adjustment: -5 } }).map((r) => r.key)).toContain('adjustment');
  });

  it('has no discount/taxable rows for an undiscounted invoice', () => {
    const base = reference();
    const totals = { ...base.totals, discount: undefined, total: base.totals.subtotal + base.totals.tax };
    expect(premiumTotalsRows({ ...base, totals }).map((r) => r.key)).toEqual(['subtotal', 'vat']);
  });
});

describe('premium meta tiles', () => {
  it('lists number, issue date, due date and payment; omits what the source lacks (supply date is not invented)', () => {
    const model = reference();
    expect(premiumMetaTiles(model).map((t) => t.key)).toEqual(['invoice_no', 'issue_date', 'due_date', 'payment_terms']);
    const lean = { ...model, meta: { number: 'A', date: '2026-01-01', dueDate: null, paymentType: null } };
    expect(premiumMetaTiles(lean).map((t) => t.key)).toEqual(['invoice_no', 'issue_date']);
  });
});

describe('premiumSkuLine (product code under the name)', () => {
  const sku = (over: Partial<DocumentLine>) => premiumSkuLine({ productName: 'طماطم', description: 'خضار', productCode: 'TOM-001', ...over });

  it('returns the trimmed stored code', () => {
    expect(sku({ productCode: '  TOM-001 ' })).toBe('TOM-001');
  });

  it('is hidden when the code is missing, empty or whitespace (no empty line)', () => {
    expect(sku({ productCode: null })).toBeNull();
    expect(sku({ productCode: undefined })).toBeNull();
    expect(sku({ productCode: '' })).toBeNull();
    expect(sku({ productCode: '   ' })).toBeNull();
  });

  it('keeps a very long code (wrapping is the renderer\'s job)', () => {
    const long = 'LET-WHITE-ICEBERG-12-CTN-SA-2026-LONG-CODE-0005';
    expect(sku({ productCode: long })).toBe(long);
  });

  it('is hidden when the code already appears in the name or description (case-insensitive, token-bounded)', () => {
    expect(sku({ description: 'Potato POT-004', productCode: 'POT-004' })).toBeNull();
    expect(sku({ productName: 'بطاطس POT-004 (10 كجم)', productCode: 'POT-004' })).toBeNull();
    expect(sku({ description: 'potato pot-004', productCode: 'POT-004' })).toBeNull();
    expect(sku({ productName: 'TOM-001', productCode: 'TOM-001' })).toBeNull();
  });

  it('does not treat a code embedded inside another token as a duplicate', () => {
    expect(sku({ productName: 'ليمون 10 كجم', description: '', productCode: '1' })).toBe('1');
    expect(sku({ description: 'XPOT-0045', productCode: 'POT-004' })).toBe('POT-004');
  });
});

describe('premiumResolveColumns (studio-saved columns vs the template-owned ones)', () => {
  const lines = reference().lines;
  const ids = (saved?: Parameters<typeof premiumResolveColumns>[1]) => premiumResolveColumns(lines, saved).columns.map((c) => c.id);

  it('keeps the ten data-derived columns and no SKU when nothing is saved (default look unchanged)', () => {
    const resolved = premiumResolveColumns(lines, null);
    expect(resolved.skuInName).toBe(false);
    expect(resolved.columns.map((c) => c.id)).toEqual(premiumDefaultColumns(lines).map((c) => c.id));
    expect(resolved.columns).toHaveLength(10);
  });

  it('the studio default for this template has the SKU off and yields the same ten columns', () => {
    expect(PREMIUM_STUDIO_DEFAULT_COLUMNS).not.toContain('product_code');
    const resolved = premiumResolveColumns(lines, PREMIUM_STUDIO_DEFAULT_COLUMNS.map((id) => ({ id })));
    expect(resolved.skuInName).toBe(false);
    expect(resolved.columns.map((c) => c.id)).toEqual(premiumDefaultColumns(lines).map((c) => c.id));
  });

  it('product_code folds into the name cell without adding a column (still ten columns)', () => {
    const resolved = premiumResolveColumns(lines, [...PREMIUM_STUDIO_DEFAULT_COLUMNS, 'product_code'].map((id) => ({ id })));
    expect(resolved.skuInName).toBe(true);
    expect(resolved.columns).toHaveLength(10);
    expect(resolved.columns.some((c) => c.id === 'product_code')).toBe(false);
  });

  it('keeps saved order, labels and alignment, and re-inserts the template-owned detail columns', () => {
    const resolved = premiumResolveColumns(lines, [{ id: 'number' }, { id: 'product' }, { id: 'quantity', label: 'العدد', alignment: 'center' }, { id: 'total' }]);
    const got = resolved.columns.map((c) => c.id);
    expect(got.indexOf('number')).toBeLessThan(got.indexOf('product'));
    expect(got).toEqual(expect.arrayContaining(['unit', 'line_discount', 'line_net', 'tax_rate']));
    expect(got.indexOf('unit')).toBeLessThan(got.indexOf('quantity'));
    const qty = resolved.columns.find((c) => c.id === 'quantity')!;
    expect(qty.alignment).toBe('center');
    expect(qty.label).toEqual({ ar: 'العدد', en: 'العدد' });
  });

  it('folds the contract-required description column into the name cell when a product column exists (no duplicate column)', () => {
    const got = ids([{ id: 'number' }, { id: 'product' }, { id: 'description' }, { id: 'quantity' }, { id: 'total' }]);
    expect(got).not.toContain('description');
    expect(got).toContain('product');
    // وبلا عمود صنف يبقى الوصف عموداً ويحمل الرمز.
    const only = premiumResolveColumns(lines, [{ id: 'number' }, { id: 'description' }, { id: 'product_code' }, { id: 'total' }]);
    expect(only.columns.map((c) => c.id)).toContain('description');
    expect(only.skuInName).toBe(true);
  });

  it('never drops a requested SKU: without a name/description column it stays a standalone column', () => {
    const resolved = premiumResolveColumns(lines, [{ id: 'number' }, { id: 'product_code' }, { id: 'total' }]);
    expect(resolved.skuInName).toBe(false);
    expect(resolved.columns.some((c) => c.id === 'product_code')).toBe(true);
  });

  it('hides unit/discount/net/VAT% columns when no line carries that data', () => {
    const bare = [line({ unit: undefined, lineDiscount: undefined, netAmount: undefined, taxRate: undefined })];
    const got = premiumResolveColumns(bare, [{ id: 'description' }, { id: 'total' }]).columns.map((c) => c.id);
    expect(got).toEqual(['description', 'total']);
    expect(ids()).toHaveLength(10);
  });
});
