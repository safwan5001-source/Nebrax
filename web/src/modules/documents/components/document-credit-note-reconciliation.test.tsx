// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { DocumentBody } from './document-body';
import * as styles from '../templates/template-styles';
import { buildCreditNoteDocumentModel, type SourceCreditNote, type SourceCreditNoteLine } from '../builder/from-credit-note';
import { makeDocumentQaModel } from '../qa/document-qa-fixtures';
import { DOCUMENT_ITEMS_COLUMN_IDS, DOCUMENT_TYPE_DEFAULT_ITEM_COLUMNS, getDefaultDocumentItemColumns } from '../registry/document-types';
import { getTheme } from '../themes';
import type { DocumentModel, TemplateStyle } from '../types';

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

const theme = getTheme('blue');
const formatMoney = (minor: number) => (minor / 100).toFixed(2);

const COMPOSITIONS = Object.entries(styles)
  .filter((entry): entry is [string, TemplateStyle] => entry[0].endsWith('_STYLE') && typeof entry[1] === 'object')
  .map(([name, style]) => ({ name, style }));

const line = (over: Partial<SourceCreditNoteLine>): SourceCreditNoteLine => ({
  id: 'l1', description: 'خدمة', quantity: 1, unit_price: '100.00', unit_price_before_tax: '100.00', tax_rate: 15,
  line_subtotal: '100.00', line_discount: '20.00', line_tax: '12.00', line_total: '92.00', ...over,
});
const note = (lines: SourceCreditNoteLine[], over: Partial<SourceCreditNote> = {}): SourceCreditNote => ({
  number: 'CN-1', note_date: '2026-10-11', subtotal: '80.00', tax_amount: '12.00', total: '92.00', type: 'sales', lines, ...over,
});

function render_(n: SourceCreditNote, style: TemplateStyle, lang: 'ar' | 'en') {
  locale.current = lang;
  const model: DocumentModel = buildCreditNoteDocumentModel({
    note: n, company: { name: 'نبراس', vat_number: '300000000000003' }, customer: { name: 'عميل' }, direction: lang === 'en' ? 'ltr' : 'rtl',
  });
  return render(<DocumentBody model={model} theme={theme} formatMoney={formatMoney} style={style} rootId="print-root" />);
}

const numbers = (text: string) => (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
const cellNumbers = (container: ParentNode) =>
  [...container.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((td) => td.textContent ?? ''));
const totalsText = (container: ParentNode) => container.querySelector('[data-doc-totals]')?.textContent ?? '';

describe('credit-note print — every composition, Arabic and English', () => {
  it('has compositions to cover', () => {
    expect(COMPOSITIONS.length).toBeGreaterThanOrEqual(10);
  });

  for (const { name, style } of COMPOSITIONS) {
    it(`${name}: a discounted row reconciles (qty · price · discount · net · rate · VAT · total) with identical figures in ar and en`, () => {
      const rows: number[][] = [];
      for (const lang of ['ar', 'en'] as const) {
        const { container, unmount } = render_(note([line({})]), style, lang);
        const [cells] = cellNumbers(container);
        expect(cells, `${name}:${lang}:columns`).toHaveLength(9);
        // # · وصف · كمية · سعر قبل الضريبة · خصم · صافي · نسبة · ضريبة · إجمالي
        rows.push(cells.slice(2).flatMap(numbers));
        unmount();
      }
      expect(rows[0]).toEqual([1, 100, 20, 80, 15, 12, 92]);
      expect(rows[1]).toEqual(rows[0]);
    });

    it(`${name}: the totals block prints subtotal − discount + VAT = total and the real VAT rate`, () => {
      for (const lang of ['ar', 'en'] as const) {
        const { container, unmount } = render_(note([line({})]), style, lang);
        const text = totalsText(container);
        // المجموع قبل الخصم 100، الخصم 20، الضريبة 12، الإجمالي 92 — والنسبة المعلنة 15%.
        expect(numbers(text).filter((n) => [100, 20, 12, 92].includes(n)), `${name}:${lang}`).toEqual([100, 20, 12, 92]);
        unmount();
      }
    });

    it(`${name}: a 5% note never prints the hard-coded 15% on the VAT row`, () => {
      const five = note([line({ line_discount: '0.00', line_subtotal: '100.00', line_tax: '5.00', line_total: '105.00', tax_rate: 5 })], {
        subtotal: '100.00', tax_amount: '5.00', total: '105.00',
      });
      for (const lang of ['ar', 'en'] as const) {
        const { container, unmount } = render_(five, style, lang);
        const text = totalsText(container);
        expect(text, `${name}:${lang}`).toContain('(5%)');
        expect(text, `${name}:${lang}`).not.toContain('15%');
        unmount();
      }
    });
  }
});

describe('credit-note print — rounding and historical payloads', () => {
  const multiUnit = note(
    [line({ quantity: 7, unit_price: '0.10', unit_price_before_tax: '0.09', line_subtotal: '0.61', line_discount: '0.00', line_tax: '0.09', line_total: '0.70' })],
    { subtotal: '0.61', tax_amount: '0.09', total: '0.70' },
  );

  for (const { name, style } of COMPOSITIONS) {
    it(`${name}: multi-unit rounding is explained, not hidden, in both languages`, () => {
      for (const lang of ['ar', 'en'] as const) {
        const { container, unmount } = render_(multiUnit, style, lang);
        const [cells] = cellNumbers(container);
        // الصافي 0.61 + الضريبة 0.09 = 0.70 على الصف نفسه رغم أن 7 × 0.09 = 0.63.
        expect(cells.slice(2).flatMap(numbers), `${name}:${lang}`).toEqual([7, 0.09, 0, 0.61, 15, 0.09, 0.7]);
        const noteEl = container.querySelector('[data-doc-rounding-note]');
        expect(noteEl?.textContent, `${name}:${lang}`).toBe(catalogs[lang].invoiceDoc.unit_price_rounding_note);
        unmount();
      }
    });
  }

  it('prints no rounding note when quantity × unit price is exact', () => {
    const { container } = render_(note([line({})]), styles.CLASSIC_V2_STYLE, 'en');
    expect(container.querySelector('[data-doc-rounding-note]')).toBeNull();
  });

  it('a pre-REM-02 payload still renders: unknown discount is a dash, stored totals and the legacy VAT label are untouched', () => {
    const old: SourceCreditNote = {
      number: 'CN-OLD', note_date: '2026-01-01', subtotal: '100.00', tax_amount: '15.00', total: '115.00', type: 'sales',
      lines: [{ id: 'o1', description: 'قديم', quantity: 2, unit_price: '50.00', line_tax: '15.00', line_total: '115.00' }],
    };
    for (const lang of ['ar', 'en'] as const) {
      const { container, unmount } = render_(old, styles.CLASSIC_V2_STYLE, lang);
      const [cells] = cellNumbers(container);
      expect(cells[3]).toBe('—'); // السعر قبل الضريبة غير معروف
      expect(cells[4]).toBe('—'); // الخصم غير معروف — لا يُفترض صفراً
      expect(numbers(cells[5])).toEqual([100]); // الصافي = الإجمالي − الضريبة (هوية مخزَّنة)
      expect(cells[6]).toBe('—');
      expect(totalsText(container)).toContain('15%'); // العنوان القديم كما كان
      expect(container.querySelector('[data-doc-rounding-note]')).toBeNull();
      unmount();
    }
  });
});

describe('credit-note print — other document families are unchanged', () => {
  it('only credit_note declares reconciliation columns; every other type keeps persistable columns only', () => {
    const extra = ['line_discount', 'line_net', 'tax_rate'];
    for (const [type, columns] of Object.entries(DOCUMENT_TYPE_DEFAULT_ITEM_COLUMNS)) {
      const hasExtra = columns.some((c) => extra.includes(c));
      expect(hasExtra, type).toBe(type === 'credit_note');
      if (type !== 'credit_note') {
        expect(columns.every((c) => (DOCUMENT_ITEMS_COLUMN_IDS as readonly string[]).includes(c)), type).toBe(true);
      }
    }
    expect(getDefaultDocumentItemColumns('debit_note')).toEqual(getDefaultDocumentItemColumns('tax_invoice'));
  });

  it('an invoice-shaped model renders the same columns and the original hard-coded VAT label', () => {
    for (const lang of ['ar', 'en'] as const) {
      locale.current = lang;
      const model = makeDocumentQaModel({ scenario: 'five', direction: lang === 'en' ? 'ltr' : 'rtl', showQr: false, showAssets: false });
      const { container, unmount } = render(
        <DocumentBody model={model} theme={theme} formatMoney={formatMoney} style={styles.CLASSIC_V2_STYLE} rootId="print-root" />,
      );
      const headers = [...container.querySelectorAll('thead th')].length;
      expect(headers).toBe(getDefaultDocumentItemColumns(model.type).length);
      expect(totalsText(container)).toContain('15%');
      expect(container.querySelector('[data-doc-rounding-note]')).toBeNull();
      unmount();
    }
  });
});
