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
  premiumTotalsRows,
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
    expect(premiumMetaTiles(model).map((t) => t.key)).toEqual(['invoice_no', 'issue_date', 'due_date', 'payment']);
    const lean = { ...model, meta: { number: 'A', date: '2026-01-01', dueDate: null, paymentType: null } };
    expect(premiumMetaTiles(lean).map((t) => t.key)).toEqual(['invoice_no', 'issue_date']);
  });
});
