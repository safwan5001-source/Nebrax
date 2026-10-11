// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { DocumentBody } from './document-body';
import { TaxReceiptThermal58, TaxReceiptThermal80 } from '../templates/thermal-receipt';
import { CLASSIC_V2_STYLE } from '../templates/template-styles';
import { buildCreditNoteDocumentModel, type SourceCreditNote, type SourceCreditNoteLine } from '../builder/from-credit-note';
import { classicItemsColumnWidthClass } from '../presentation/classic-v2';
import { erpItemsColumnWidthClass } from '../presentation/erp-v2';
import { minimalItemsColumnWidthClass } from '../presentation/minimal-v2';
import { purchaseOrderItemsColumnWidthClass } from '../presentation/purchase-order-formal';
import { quotationItemsColumnWidthClass } from '../presentation/quotation-proposal';
import { retailItemsColumnWidthClass } from '../presentation/retail-v2';
import { modernItemsColumnWidthClass } from '../presentation/visual-v2';
import { makeCreditNoteQaNote } from '../qa/credit-note-qa-fixtures';
import { getTheme } from '../themes';
import type { DocItemsColumn, DocSectionLayoutItem, DocumentModel } from '../types';
import { getDefaultDocumentLayout } from '../registry/document-types';

const locale = { current: 'ar' as 'ar' | 'en' };
const catalogs = { ar, en } as unknown as Record<'ar' | 'en', Record<string, Record<string, string>>>;

vi.mock('next-intl', () => ({
  useLocale: () => locale.current,
  useTranslations: (namespace: string) => (key: string) => catalogs[locale.current][namespace]?.[key] ?? key,
}));

afterEach(() => {
  cleanup();
  locale.current = 'ar';
});

const theme = getTheme('black');
const formatMoney = (minor: number) => (minor / 100).toFixed(2);
const model = (n: SourceCreditNote, lang: 'ar' | 'en'): DocumentModel =>
  buildCreditNoteDocumentModel({ note: n, company: { name: 'نبراس' }, customer: { name: 'عميل' }, direction: lang === 'en' ? 'ltr' : 'rtl' });

const line = (over: Partial<SourceCreditNoteLine>): SourceCreditNoteLine => ({
  id: 'l1', description: 'خدمة', quantity: 1, unit_price: '100.00', unit_price_before_tax: '100.00', tax_rate: 15,
  line_subtotal: '100.00', line_discount: '20.00', line_tax: '12.00', line_total: '92.00', ...over,
});
const note = (lines: SourceCreditNoteLine[], over: Partial<SourceCreditNote> = {}): SourceCreditNote => ({
  number: 'CN-1', note_date: '2026-10-11', subtotal: '80.00', tax_amount: '12.00', total: '92.00', type: 'sales', lines, ...over,
});

/** صفوف الإجماليات في الإيصال الحراري: آخر قسم بعد الخط المتقطع الثاني. */
function thermalTotals(container: HTMLElement) {
  const rows = [...container.querySelectorAll('.space-y-0\\.5')].at(-1)?.children ?? [];
  return [...rows].map((row) => ({
    label: row.children[0]?.textContent ?? '',
    value: Number((row.children[1]?.textContent ?? '').replace(/[^\d.]/g, '')),
    negative: (row.children[1]?.textContent ?? '').includes('−'),
  }));
}

describe('thermal credit note (58 / 80 mm) reconciles', () => {
  for (const [name, Template] of [['80mm', TaxReceiptThermal80], ['58mm', TaxReceiptThermal58]] as const) {
    for (const lang of ['ar', 'en'] as const) {
      it(`${name} ${lang}: discounted note prints subtotal − discount + VAT = total (was 100 + 12 ≠ 92)`, () => {
        locale.current = lang;
        const { container } = render(<Template model={model(note([line({})]), lang)} theme={theme} formatMoney={formatMoney} rootId="print-root" />);
        const totals = thermalTotals(container);
        expect(totals.map((t) => t.value)).toEqual([100, 20, 12, 92]);
        expect(totals[1].negative).toBe(true);
        expect(totals[0].value - totals[1].value + totals[2].value).toBe(totals[3].value);
        expect(totals[1].label).toBe(catalogs[lang].purchaseForm.discount);
      });

      it(`${name} ${lang}: header discount over several lines reconciles`, () => {
        locale.current = lang;
        const { container } = render(<Template model={model(makeCreditNoteQaNote('header_discount'), lang)} theme={theme} formatMoney={formatMoney} rootId="print-root" />);
        const v = thermalTotals(container).map((t) => t.value);
        expect(v).toEqual([400, 35, 54.76, 419.76]);
        expect(v[0] - v[1] + v[2]).toBeCloseTo(v[3], 2);
      });

      it(`${name} ${lang}: a 5% note labels the VAT row 5%, never the hard-coded 15%`, () => {
        locale.current = lang;
        const five = note([line({ line_discount: '0.00', line_tax: '5.00', line_total: '105.00', tax_rate: 5 })], { subtotal: '100.00', tax_amount: '5.00', total: '105.00' });
        const { container } = render(<Template model={model(five, lang)} theme={theme} formatMoney={formatMoney} rootId="print-root" />);
        const label = thermalTotals(container)[1].label;
        expect(label).toContain('(5%)');
        expect(label).not.toContain('15%');
      });

      it(`${name} ${lang}: a rounded unit price carries the explanatory note; an exact one does not`, () => {
        locale.current = lang;
        const rounded = render(<Template model={model(makeCreditNoteQaNote('rounding'), lang)} theme={theme} formatMoney={formatMoney} rootId="print-root" />);
        expect(rounded.container.querySelector('[data-doc-rounding-note]')?.textContent).toBe(catalogs[lang].invoiceDoc.unit_price_rounding_note);
        rounded.unmount();
        const exact = render(<Template model={model(makeCreditNoteQaNote('inclusive'), lang)} theme={theme} formatMoney={formatMoney} rootId="print-root" />);
        expect(exact.container.querySelector('[data-doc-rounding-note]')).toBeNull();
      });
    }
  }

  it('no discount ⇒ the receipt keeps exactly its three total rows (historical and undiscounted notes unchanged)', () => {
    for (const scenario of ['inclusive', 'historical', 'vat5'] as const) {
      const { container, unmount } = render(<TaxReceiptThermal80 model={model(makeCreditNoteQaNote(scenario), 'ar')} theme={theme} formatMoney={formatMoney} rootId="print-root" />);
      expect(thermalTotals(container), scenario).toHaveLength(3);
      unmount();
    }
  });

  it('historical payload on thermal keeps the original 15% label and stored totals', () => {
    const { container } = render(<TaxReceiptThermal80 model={model(makeCreditNoteQaNote('historical'), 'en')} theme={theme} formatMoney={formatMoney} rootId="print-root" />);
    const totals = thermalTotals(container);
    expect(totals[1].label).toContain('15%');
    expect(totals.map((t) => t.value)).toEqual([100, 15, 115]);
  });
});

describe('saved layouts without the discount column', () => {
  const layoutWith = (columns: DocItemsColumn[]): DocSectionLayoutItem[] =>
    getDefaultDocumentLayout('credit_note').map((item) => (item.key === 'items' ? { ...item, properties: { ...item.properties, columns } } : item));
  const generic: DocItemsColumn[] = [{ id: 'number' }, { id: 'description' }, { id: 'quantity' }, { id: 'unit_price' }, { id: 'tax' }, { id: 'total' }];

  it('explains that unit prices are before discount and line totals after it (row 100.00 · 12.00 · 92.00 was unexplained)', () => {
    for (const lang of ['ar', 'en'] as const) {
      locale.current = lang;
      const { container, unmount } = render(
        <DocumentBody model={model(note([line({})]), lang)} theme={getTheme('blue')} formatMoney={formatMoney} style={CLASSIC_V2_STYLE} layout={layoutWith(generic)} rootId="print-root" />,
      );
      expect(container.querySelector('[data-doc-discount-note]')?.textContent, lang).toBe(catalogs[lang].invoiceDoc.line_discount_note);
      unmount();
    }
  });

  it('stays silent when the layout already shows the discount column, when nothing was discounted, and for invoices', () => {
    locale.current = 'en';
    const withColumn = render(
      <DocumentBody model={model(note([line({})]), 'en')} theme={getTheme('blue')} formatMoney={formatMoney} style={CLASSIC_V2_STYLE} layout={layoutWith([...generic, { id: 'line_discount' } as DocItemsColumn])} rootId="print-root" />,
    );
    expect(withColumn.container.querySelector('[data-doc-discount-note]')).toBeNull();
    withColumn.unmount();

    const none = render(
      <DocumentBody model={model(makeCreditNoteQaNote('inclusive'), 'en')} theme={getTheme('blue')} formatMoney={formatMoney} style={CLASSIC_V2_STYLE} layout={layoutWith(generic)} rootId="print-root" />,
    );
    expect(none.container.querySelector('[data-doc-discount-note]')).toBeNull();
  });
});

describe('credit-note column widths', () => {
  it('give the VAT-rate column at least 6% in every composition so its Arabic header is not split mid-word', () => {
    const widths = [classicItemsColumnWidthClass, erpItemsColumnWidthClass, minimalItemsColumnWidthClass, purchaseOrderItemsColumnWidthClass, quotationItemsColumnWidthClass, retailItemsColumnWidthClass, modernItemsColumnWidthClass]
      .map((fn) => Number(fn('tax_rate').replace(/[^\d]/g, '')));
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(6);
  });
});
