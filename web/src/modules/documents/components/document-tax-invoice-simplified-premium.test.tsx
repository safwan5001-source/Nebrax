// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TaxInvoicePremium, TaxInvoiceSimplifiedPremium, premiumLayoutWithSku } from '../templates/tax-invoice-premium';
import { getTemplate, listTemplatesForDocumentType, TEMPLATES } from '../registry/templates';
import { makeDocumentQaModel } from '../qa/document-qa-fixtures';
import { getTheme } from '../themes';
import { formatModernAmount } from '../presentation/visual-v2';
import { PREMIUM_SIMPLIFIED, premiumDefaultColumns, premiumMetaTiles, premiumMinRows, premiumResolveColumns } from '../presentation/tax-invoice-premium';
import { buildInvoiceDocumentModel, issueTimeAst, type SourceInvoice } from '../builder/from-invoice';
import type { DocSectionLayoutItem, DocumentLine, DocumentModel } from '../types';

const locale = { current: 'ar' };

vi.mock('next-intl', () => ({
  useLocale: () => locale.current,
  useTranslations: (namespace: string) => (key: string) => {
    if (namespace === 'documentTypes') return locale.current === 'ar' ? 'فاتورة ضريبية مبسطة' : 'Simplified Tax Invoice';
    if (namespace === 'documentTypesAlt') return locale.current === 'ar' ? 'Simplified Tax Invoice' : 'فاتورة ضريبية مبسطة';
    return key;
  },
}));

const theme = getTheme('green');
const formatMoney = (minor: number) => String(minor);
const sample = (direction: 'rtl' | 'ltr' = 'rtl'): DocumentModel => makeDocumentQaModel({ documentType: 'simplified_tax_invoice', scenario: 'simplified_sample', direction, showQr: true, showAssets: true });

type Props = Parameters<typeof TaxInvoiceSimplifiedPremium>[0];
const renderSimplified = (model: DocumentModel, layout?: DocSectionLayoutItem[] | null, sections?: Props['sections']) => render(
  <TaxInvoiceSimplifiedPremium model={model} theme={theme} formatMoney={formatMoney} layout={layout} sections={sections} rootId="qa-print-root" />,
);
const heads = (container: HTMLElement) => [...container.querySelectorAll('thead th')].map((th) => th.getAttribute('data-premium-col'));
const line = (over: Partial<DocumentLine> = {}): DocumentLine => ({ ...sample().lines[0], ...over });

afterEach(() => { cleanup(); locale.current = 'ar'; });

describe('tax-invoice-simplified-premium-v1 registration', () => {
  it('is a distinct simplified-only identity reusing the Premium engine; the full template is untouched', () => {
    const simplified = getTemplate('tax-invoice-simplified-premium-v1');
    expect(simplified.id).toBe('tax-invoice-simplified-premium-v1');
    expect(simplified.component).toBe(TaxInvoiceSimplifiedPremium);
    expect(simplified.documentTypes).toEqual(['simplified_tax_invoice']);
    expect(simplified.supportedPaper).toEqual(['a4', 'letter', 'legal']);
    const full = getTemplate('tax-invoice-premium-v1');
    expect(full.component).toBe(TaxInvoicePremium);
    expect(full.documentTypes).toEqual(['tax_invoice', 'simplified_tax_invoice']);
    expect(Object.values(TEMPLATES).filter((t) => t.id !== simplified.id).every((t) => t.component !== TaxInvoiceSimplifiedPremium)).toBe(true);
  });

  it('is offered for simplified invoices only — never for full tax invoices or other documents', () => {
    expect(listTemplatesForDocumentType('simplified_tax_invoice').map((t) => t.id)).toContain('tax-invoice-simplified-premium-v1');
    expect(listTemplatesForDocumentType('tax_invoice').map((t) => t.id)).not.toContain('tax-invoice-simplified-premium-v1');
    expect(listTemplatesForDocumentType('quotation').map((t) => t.id)).not.toContain('tax-invoice-simplified-premium-v1');
  });

  it('stays presentation-only (no network/tenant/accounting) with no copied reference data or demo branding', () => {
    const dir = resolve(__dirname, '..');
    for (const file of ['templates/tax-invoice-premium.tsx', 'presentation/tax-invoice-premium.ts']) {
      const source = readFileSync(resolve(dir, file), 'utf8');
      expect(source, file).not.toMatch(/from '@\/lib\/api'|fetch\(|tenant|LedgerService|zatca|data:image|Nebrax QA|عربة نبراس|DEMO-S/i);
    }
  });
});

describe('tax-invoice-simplified-premium-v1 rendering', () => {
  it('renders the simplified structure from real model data (RTL)', () => {
    const { container } = renderSimplified(sample());
    const root = container.querySelector('[data-doc-composition="tax_invoice_premium"]')!;
    expect(root).toBeTruthy();
    expect(root.querySelector('[data-premium-header]')?.getAttribute('data-premium-variant')).toBe('simplified');
    expect(root.querySelector('[data-premium-header] h1')?.textContent).toBe('فاتورة ضريبية مبسطة');
    expect(root.querySelector('[data-premium-header]')?.textContent).toContain('Simplified Tax Invoice');
    expect([...root.querySelectorAll('[data-premium-meta-tile]')].map((n) => n.getAttribute('data-premium-meta-tile'))).toEqual(['invoice_no', 'issue_date', 'issue_time', 'payment_terms']);
    expect(root.querySelector('[data-premium-meta-tile="issue_time"]')?.textContent).toContain('14:35');
    expect(root.querySelector('[data-premium-party="seller"]')?.textContent).toContain('310122393500003');
    expect(root.querySelector('[data-premium-party="seller"] [data-premium-party-grid]')).toBeTruthy();
    expect(root.querySelector('[data-premium-customer-name]')?.textContent).toBe('عميل نقدي');
    expect(root.querySelector('[data-premium-qr] svg')).toBeTruthy();
    expect(root.querySelector('[data-premium-footer]')?.textContent).toContain('0500000000');
  });

  it('has no buyer party card and no signature/stamp boxes by default', () => {
    const { container } = renderSimplified(sample());
    expect(container.querySelector('[data-premium-party="buyer"]')).toBeNull();
    expect(container.querySelector('[data-premium-signatures]')).toBeNull();
  });

  it('default columns: No · Item · Unit · Qty · Unit price · VAT (rate in the header) · Total — no discount/taxable/rate columns', () => {
    const { container } = renderSimplified(sample());
    expect(heads(container)).toEqual(['number', 'product', 'unit', 'quantity', 'price_before_tax', 'tax', 'total']);
    const labels = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(labels.join('|')).toContain('ضريبة 15%');
    expect(labels.join('|')).toContain('Total incl. VAT');
    expect(labels.join('|')).not.toMatch(/الخصم|الخاضع|نسبة الضريبة/);
  });

  it('prints stored line values and totals verbatim — nothing is recomputed', () => {
    const model = sample();
    const { container } = renderSimplified(model);
    const rows = [...container.querySelectorAll('[data-premium-row="line"]')];
    expect(rows).toHaveLength(model.lines.length);
    model.lines.forEach((l, i) => {
      expect(rows[i].textContent).toContain(formatModernAmount(l.total, 'SAR'));
      expect(rows[i].textContent).toContain(formatModernAmount(l.tax, 'SAR'));
    });
    const text = (key: string) => container.querySelector(`[data-premium-total-row="${key}"]`)!.textContent!;
    expect(text('subtotal')).toContain(formatModernAmount(model.totals.subtotal, 'SAR'));
    expect(text('subtotal')).toContain('الإجمالي قبل الضريبة');
    expect(text('vat')).toContain(formatModernAmount(model.totals.tax, 'SAR'));
    expect(container.querySelector('[data-premium-grand-total]')!.textContent).toContain(formatModernAmount(model.totals.total, 'SAR'));
    // إجمالي معدَّل في المصدر يُطبع كما هو (لا إصلاح صامت).
    cleanup();
    const tampered = { ...model, totals: { ...model.totals, total: model.totals.total + 777 } };
    expect(renderSimplified(tampered).container.querySelector('[data-premium-grand-total]')!.textContent).toContain(formatModernAmount(tampered.totals.total, 'SAR'));
  });

  it('the stored totals reconcile with the lines in the sample (subtotal + VAT = total, rows sum to totals)', () => {
    const m = sample();
    expect(m.lines.reduce((s, l) => s + (l.netAmount ?? 0), 0)).toBe(m.totals.subtotal);
    expect(m.lines.reduce((s, l) => s + l.tax, 0)).toBe(m.totals.tax);
    expect(m.totals.subtotal + m.totals.tax).toBe(m.totals.total);
    m.lines.forEach((l) => expect((l.netAmount ?? 0) + l.tax).toBe(l.total));
  });

  it('amount in words sits inside the totals row (reference), derived from the stored total, no separate section', () => {
    const { container } = renderSimplified(sample());
    expect(container.querySelector('[data-premium-summary] [data-premium-words]')?.textContent).toContain('فقط لا غير');
    expect(container.querySelectorAll('[data-premium-words]')).toHaveLength(1);
    expect(container.querySelector('section[data-premium-words]')).toBeNull();
  });

  it('with the summary hidden the amount in words becomes its own section (never lost)', () => {
    const layout: DocSectionLayoutItem[] = ['header', 'parties', 'items', 'amountWords', 'footer'].map((key) => ({ key: key as DocSectionLayoutItem['key'], visible: true }));
    const { container } = renderSimplified(sample(), layout);
    expect(container.querySelector('section[data-premium-words]')).toBeTruthy();
    expect(container.querySelector('[data-premium-summary]')).toBeNull();
  });

  it('LTR: English labels, dir=ltr, same structure', () => {
    locale.current = 'en';
    const { container } = renderSimplified(sample('ltr'));
    const root = container.querySelector('[data-doc-composition="tax_invoice_premium"]')!;
    expect(root.getAttribute('dir')).toBe('ltr');
    expect(root.querySelector('[data-premium-header] h1')?.textContent).toBe('Simplified Tax Invoice');
    expect(root.querySelector('[data-premium-customer-name]')?.textContent).toBe('Walk-in customer');
    expect(heads(container as HTMLElement)).toEqual(['number', 'product', 'unit', 'quantity', 'price_before_tax', 'tax', 'total']);
  });

  it('a saved studio layout wins: signature and stamp can be shown, sections reordered/hidden', () => {
    const layout: DocSectionLayoutItem[] = ['header', 'parties', 'items', 'summary', 'signature', 'stamp', 'footer'].map((key) => ({ key: key as DocSectionLayoutItem['key'], visible: true }));
    const img = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E';
    const { container } = renderSimplified({ ...sample(), signatureUrl: img, stampUrl: img }, layout);
    expect(container.querySelector('[data-premium-signatures]')).toBeTruthy();
    expect(container.querySelectorAll('[data-premium-sign-box] img').length).toBeGreaterThan(0);
  });
});

describe('simplified: buyer and seller data gaps (nothing is invented)', () => {
  it('customer is optional: no name / placeholder dash → no customer bar, no buyer fields forced', () => {
    for (const name of ['', '   ', '—']) {
      const { container } = renderSimplified({ ...sample(), buyer: { name } });
      expect(container.querySelector('[data-premium-customer]'), JSON.stringify(name)).toBeNull();
      expect(container.querySelector('[data-premium-party="buyer"]')).toBeNull();
      cleanup();
    }
  });

  it('shows the buyer VAT number only when the source has one', () => {
    const withVat = renderSimplified({ ...sample(), buyer: { name: 'شركة', vatNumber: '300000000000003' } });
    expect(withVat.container.querySelector('[data-premium-customer-vat]')?.textContent).toContain('300000000000003');
    cleanup();
    expect(renderSimplified(sample()).container.querySelector('[data-premium-customer-vat]')).toBeNull();
  });

  it('seller with only a name: no empty rows, no placeholders, nothing crashes', () => {
    const model: DocumentModel = { ...sample(), seller: { name: 'منشأة' } };
    const { container } = renderSimplified(model);
    const rows = [...container.querySelectorAll('[data-premium-party="seller"] [data-premium-party-row]')].filter((r) => r.getAttribute('data-premium-party-row'));
    expect(rows.map((r) => r.getAttribute('data-premium-party-row'))).toEqual(['trade_name']);
    expect(container.textContent).not.toMatch(/NaN|undefined|null/);
  });

  it('seller without address/phone/CR keeps the VAT row; no orphaned grid cells with content', () => {
    const { container } = renderSimplified({ ...sample(), seller: { name: 'منشأة', vatNumber: '310122393500003' } });
    const filled = [...container.querySelectorAll('[data-premium-party="seller"] [data-premium-party-row]')].map((r) => r.getAttribute('data-premium-party-row')).filter(Boolean);
    expect(filled).toEqual(['trade_name', 'vat_no']);
  });

  it('seller without a logo shows the establishment name; without time/QR/notes those blocks are absent', () => {
    const model: DocumentModel = { ...sample(), seller: { ...sample().seller, logoUrl: null }, meta: { number: 'X-1', date: '2026-11-20', paymentType: null }, qr: null, notes: null, terms: null };
    const { container } = renderSimplified(model);
    expect(container.querySelector('[data-premium-seller-name]')).toBeTruthy();
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect([...container.querySelectorAll('[data-premium-meta-tile]')].map((n) => n.getAttribute('data-premium-meta-tile'))).toEqual(['invoice_no', 'issue_date']);
    expect(container.querySelector('[data-premium-qr]')).toBeNull();
    expect(container.querySelector('[data-premium-card="notes"]')).toBeNull();
    expect(container.querySelector('[data-premium-words]')).toBeTruthy();
  });
});

describe('simplified: table length', () => {
  it('short invoice (1 line) is padded to the minimum with numbered empty rows', () => {
    const model = { ...sample(), lines: [sample().lines[0]] };
    const { container } = renderSimplified(model);
    expect(container.querySelectorAll('[data-premium-row="line"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-premium-row="filler"]')).toHaveLength(PREMIUM_SIMPLIFIED.minTableRows - 1);
    expect(premiumMinRows('simplified')).toBe(PREMIUM_SIMPLIFIED.minTableRows);
  });

  it('long invoice (40 lines) has no filler rows and keeps every line', () => {
    const lines = Array.from({ length: 40 }, (_, i) => line({ id: `m${i}` }));
    const { container } = renderSimplified({ ...sample(), lines });
    expect(container.querySelectorAll('[data-premium-row="line"]')).toHaveLength(40);
    expect(container.querySelectorAll('[data-premium-row="filler"]')).toHaveLength(0);
  });

  it('no lines at all: only numbered empty rows, no crash', () => {
    const { container } = renderSimplified({ ...sample(), lines: [] });
    expect(container.querySelectorAll('[data-premium-row="filler"]')).toHaveLength(PREMIUM_SIMPLIFIED.minTableRows);
    expect(container.textContent).not.toMatch(/NaN|undefined|null/);
  });
});

describe('simplified: product code (SKU) under the item name', () => {
  const skuLayout = premiumLayoutWithSku('simplified');
  const skus = (container: HTMLElement) => [...container.querySelectorAll('[data-premium-sku]')].map((n) => n.textContent);

  it('hidden by default', () => {
    expect(skus(renderSimplified(sample()).container)).toHaveLength(0);
  });

  it('enabled: shown under the name inside the item cell (no extra column), skipped for missing and duplicated codes', () => {
    const { container } = renderSimplified(sample(), skuLayout);
    expect(heads(container as HTMLElement)).toEqual(['number', 'product', 'unit', 'quantity', 'price_before_tax', 'tax', 'total']);
    const shown = skus(container as HTMLElement);
    // 8 أصناف: واحد بلا رمز (ماء) وآخر مكرر في الوصف (خبز) ⇒ 6 رموز.
    expect(shown).toHaveLength(6);
    expect(shown[0]).toContain('COF-250');
    const cell = container.querySelector('[data-premium-sku]')!.closest('td')!;
    expect(cell.textContent).toContain(sample().lines[0].productName!);
    expect(cell.parentElement!.querySelectorAll('td')).toHaveLength(7);
  });

  it('enabled does not change any amount', () => {
    const model = sample();
    const strip = (container: HTMLElement) => [...container.querySelectorAll('[data-premium-row="line"] td:nth-child(n+4), [data-premium-totals]')].map((n) => n.textContent).join('|');
    const off = strip(renderSimplified(model).container);
    cleanup();
    expect(strip(renderSimplified(model, skuLayout).container)).toBe(off);
  });
});

describe('simplified column resolution', () => {
  const lines = sample().lines;

  it('a positive line discount adds the discount column so the numbers reconcile', () => {
    expect(premiumDefaultColumns(lines, 'simplified').map((c) => c.id)).not.toContain('line_discount');
    const discounted = lines.map((l, i) => (i === 0 ? { ...l, lineDiscount: 500 } : l));
    expect(premiumDefaultColumns(discounted, 'simplified').map((c) => c.id)).toContain('line_discount');
  });

  it('mixed tax rates add a rate column and drop the single-rate header', () => {
    const mixed = lines.map((l, i) => (i === 0 ? { ...l, taxRate: 0 } : l));
    const cols = premiumResolveColumns(mixed, null, 'simplified').columns;
    expect(cols.map((c) => c.id)).toContain('tax_rate');
    expect(cols.find((c) => c.id === 'tax')!.label).toBeUndefined();
  });

  it('saved studio columns: order/labels kept, owned unit column added, no taxable/rate injection, saved label beats the default', () => {
    const saved = [{ id: 'number' as const }, { id: 'product' as const }, { id: 'quantity' as const }, { id: 'price_before_tax' as const }, { id: 'tax' as const, label: 'VAT' }, { id: 'total' as const }];
    const cols = premiumResolveColumns(lines, saved, 'simplified').columns;
    expect(cols.map((c) => c.id)).toEqual(['number', 'product', 'unit', 'quantity', 'price_before_tax', 'tax', 'total']);
    expect(cols.find((c) => c.id === 'tax')!.label).toEqual({ ar: 'VAT', en: 'VAT' });
  });

  it('saved studio columns keep the rate column for mixed tax rates (an unrelated studio edit never drops it)', () => {
    const mixed = lines.map((l, i) => (i === 0 ? { ...l, taxRate: 0 } : l));
    const saved = [{ id: 'number' as const }, { id: 'product' as const }, { id: 'quantity' as const }, { id: 'price_before_tax' as const }, { id: 'tax' as const }, { id: 'total' as const }, { id: 'product_code' as const }];
    const cols = premiumResolveColumns(mixed, saved, 'simplified').columns.map((c) => c.id);
    expect(cols).toEqual(['number', 'product', 'unit', 'quantity', 'price_before_tax', 'tax_rate', 'tax', 'total']);
    // نسبة موحَّدة: لا عمود نسبة (تظهر في عنوان الضريبة).
    expect(premiumResolveColumns(lines, saved, 'simplified').columns.map((c) => c.id)).not.toContain('tax_rate');
    // عمود نسبة محفوظ صراحةً لا يتكرر.
    const withRate = [...saved.slice(0, 4), { id: 'tax_rate' as const }, ...saved.slice(4)];
    expect(premiumResolveColumns(mixed, withRate, 'simplified').columns.filter((c) => c.id === 'tax_rate')).toHaveLength(1);
  });

  it('the full variant is untouched by the new parameter (defaults identical)', () => {
    expect(premiumDefaultColumns(lines).map((c) => c.id)).toEqual(premiumDefaultColumns(lines, 'full').map((c) => c.id));
    expect(premiumMetaTiles({ ...sample(), type: 'tax_invoice' }).map((t) => t.key)).not.toContain('issue_time');
  });
});

describe('simplified totals rows keep their honesty', () => {
  it('with an invoice discount the subtotal is NOT relabelled "total before VAT"', () => {
    const base = sample();
    const model: DocumentModel = { ...base, totals: { ...base.totals, discount: 1000, total: base.totals.total - 1000 } };
    const { container } = renderSimplified(model);
    expect(container.querySelector('[data-premium-total-row="subtotal"]')!.textContent).toContain('المجموع قبل الضريبة');
    expect(container.querySelector('[data-premium-total-row="subtotal"]')!.textContent).not.toContain('الإجمالي قبل الضريبة');
    expect(container.querySelector('[data-premium-total-row="discount"]')).toBeTruthy();
  });
});

describe('Premium V1.2 (full invoice) is unaffected', () => {
  const full = (type: DocumentModel['type'] = 'tax_invoice') => ({
    ...makeDocumentQaModel({ scenario: 'reference_sample', direction: 'rtl', showQr: true, showAssets: true }),
    type,
  });

  it('keeps buyer card, due date, signatures, ten-column default, standalone amount-in-words section and 7 filler floor', () => {
    const { container } = render(<TaxInvoicePremium model={full()} theme={theme} formatMoney={formatMoney} rootId="qa-print-root" />);
    expect(container.querySelector('[data-premium-header]')?.getAttribute('data-premium-variant')).toBe('full');
    expect(container.querySelector('[data-premium-party="buyer"]')).toBeTruthy();
    expect(container.querySelector('[data-premium-customer]')).toBeNull();
    expect(container.querySelector('[data-premium-signatures]')).toBeTruthy();
    expect(container.querySelector('section[data-premium-words]')).toBeTruthy();
    expect([...container.querySelectorAll('[data-premium-meta-tile]')].map((n) => n.getAttribute('data-premium-meta-tile'))).toEqual(['invoice_no', 'issue_date', 'due_date', 'payment_terms']);
    expect(heads(container as HTMLElement)).toHaveLength(10);
  });

  it('a simplified-typed document rendered by the FULL template keeps the full design and ignores meta.time', () => {
    const model = { ...full('simplified_tax_invoice'), meta: { number: 'S-1', date: '2026-11-20', time: '14:35', paymentType: 'cash' as const } };
    const { container } = render(<TaxInvoicePremium model={model} theme={theme} formatMoney={formatMoney} rootId="qa-print-root" />);
    expect(container.querySelector('[data-premium-party="buyer"]')).toBeTruthy();
    expect(container.querySelector('[data-premium-meta-tile="issue_time"]')).toBeNull();
  });
});

describe('issue time source (meta.time)', () => {
  it('converts the stored UTC instant to Saudi time (UTC+3), never uses the browser zone', () => {
    expect(issueTimeAst('2026-11-20T11:35:00Z')).toBe('14:35');
    expect(issueTimeAst('2026-11-20T21:30:00Z')).toBe('00:30');
    expect(issueTimeAst('2026-11-20T11:35:00.123Z')).toBe('14:35');
    expect(issueTimeAst('2026-11-20T14:35:00+03:00')).toBe('14:35');
  });

  it('missing or malformed instants give no time (never invented)', () => {
    for (const v of [null, undefined, '', '  ', 'not-a-date', '2026-11-20', '14:35', '2026-13-45T99:99:00Z']) expect(issueTimeAst(v as string | null | undefined), String(v)).toBeNull();
  });

  const source = (over: Partial<SourceInvoice> = {}): SourceInvoice => ({
    number: 'INV-1', invoice_date: '2026-11-20', payment_type: 'cash', subtotal: '100.00', tax_amount: '15.00', total: '115.00',
    lines: [{ id: 'l1', description: 'x', quantity: 1, unit_price: '100.00', tax_rate: 15, line_tax: '15.00', line_total: '115.00' }],
    ...over,
  });
  const build = (invoice: SourceInvoice) => buildInvoiceDocumentModel({ invoice, company: { name: 'S' }, customer: { name: 'C' }, qr: null, direction: 'rtl' });

  it('the builder adds meta.time only when the source carries issued_at — legacy shape is byte-identical otherwise', () => {
    expect(build(source({ issued_at: '2026-11-20T11:35:00Z' })).meta.time).toBe('14:35');
    const legacy = build(source());
    expect('time' in legacy.meta).toBe(false);
    expect(legacy.meta).toEqual({ number: 'INV-1', date: '2026-11-20', dueDate: null, paymentType: 'cash' });
    expect('time' in build(source({ issued_at: null })).meta).toBe(false);
  });
});
