// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentBody } from './document-body';
import { ERP_STYLE, MINIMAL_STYLE, MODERN_STYLE } from '../templates/template-styles';
import { makeDocumentQaModel } from '../qa/document-qa-fixtures';
import { getTheme } from '../themes';
import {
  modernColumnLabel,
  modernFieldLabel,
  modernMoneyColumnHeader,
  modernTotalLabel,
} from '../presentation/visual-v2';
import type { DocSectionLayoutItem, DocumentModel, TemplateStyle } from '../types';

const locale = { current: 'ar' };

vi.mock('next-intl', () => ({
  useLocale: () => locale.current,
  useTranslations: (namespace: string) => (key: string) => {
    if (namespace === 'documentTypes') return locale.current === 'ar' ? `ع-${key}` : 'Tax Invoice';
    if (namespace === 'documentTypesAlt') return locale.current === 'ar' ? 'Tax Invoice' : 'فاتورة ضريبية';
    return key;
  },
}));

const theme = getTheme('blue');
const formatMoney = (minor: number) => String(minor);

const FULL_LAYOUT: DocSectionLayoutItem[] = [
  { key: 'header', visible: true },
  { key: 'parties', visible: true },
  { key: 'items', visible: true },
  { key: 'summary', visible: true },
  { key: 'amountWords', visible: true },
  { key: 'notes', visible: true },
  { key: 'terms', visible: true },
  { key: 'bank', visible: true },
  { key: 'stamp', visible: true },
  { key: 'signature', visible: true },
  { key: 'footer', visible: true },
];

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;
const LATIN_SCRIPT = /[A-Za-z]/;
const ENGLISH_COLUMN_WORDS = /\b(Product|Description|Qty|Barcode|Tax|Subtotal|Shipping|Adjustment)\b/;

function normalizeLabel(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function expectBilingualLabel(text: string | null | undefined, context: string) {
  const value = normalizeLabel(text);
  expect(value, context).not.toBe('');
  expect(value, `${context}:separator`).toContain(' | ');
  expect(value, `${context}:arabic`).toMatch(ARABIC_SCRIPT);
  expect(value, `${context}:latin`).toMatch(LATIN_SCRIPT);
}

function renderComposition(style: TemplateStyle, model: DocumentModel, layout?: DocSectionLayoutItem[] | null) {
  return render(
    <DocumentBody
      model={model}
      theme={theme}
      formatMoney={formatMoney}
      style={style}
      layout={layout}
      rootId="qa-print-root"
    />,
  );
}

afterEach(() => {
  cleanup();
  locale.current = 'ar';
});

describe('Modern V2 visual composition', () => {
  it('يوسم الغلاف بتركيب modern ويكرر قواعد الطباعة عبر data-doc-composition', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: true, showAssets: true });
    const { container } = renderComposition(MODERN_STYLE, model);
    const root = container.querySelector('[data-doc-composition="modern"]');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('id')).toBe('qa-print-root');
  });

  it('لا يرسم مربعاً ملوّناً احتياطياً عند غياب الشعار', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model);
    expect(container.querySelector('header .h-14')).toBeNull();
    expect(container.querySelector('header img')).toBeNull();
  });

  it('يحد الشعار الحاضر ولا يتجاوز سقف الارتفاع', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: true });
    const { container } = renderComposition(MODERN_STYLE, model);
    const img = container.querySelector('header img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('class')).toContain('max-h-9');
    expect(img?.getAttribute('style')).toContain('36px');
  });

  it('يعرض شارة المسودة والملغى فقط', () => {
    const base = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false });
    const draft = renderComposition(MODERN_STYLE, { ...base, status: 'draft' });
    expect(draft.container.querySelector('[data-doc-status-notice="draft"]')).toBeTruthy();
    draft.unmount();

    const cancelled = renderComposition(MODERN_STYLE, { ...base, status: 'cancelled' });
    expect(cancelled.container.querySelector('[data-doc-status-notice="cancelled"]')).toBeTruthy();
    cancelled.unmount();

    const posted = renderComposition(MODERN_STYLE, { ...base, status: 'posted' });
    expect(posted.container.querySelector('[data-doc-status-notice]')).toBeNull();
  });

  it('يطوي الملاحظات والبنك والشروط والختم والتوقيع عند الغياب', () => {
    const model: DocumentModel = {
      ...makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false }),
      notes: null,
      terms: null,
      bank: null,
      stampUrl: null,
      signatureUrl: null,
    };
    const { container } = renderComposition(MODERN_STYLE, model, FULL_LAYOUT);
    expect(container.textContent).not.toContain('ملاحظات داخلية');
    expect(container.textContent).not.toContain('QA note');
    expect(container.querySelector('img[alt="stamp"]')).toBeNull();
    expect(container.querySelector('img[alt="signature"]')).toBeNull();
  });

  it('يعرض الأقسام الاختيارية عند وجودها دون بطاقة زخرفية', () => {
    const model = makeDocumentQaModel({ scenario: 'long_content', direction: 'rtl', showQr: true, showAssets: true });
    const { container } = renderComposition(MODERN_STYLE, model, FULL_LAYOUT);
    expect(container.textContent).toContain('ملاحظات داخلية');
    expect(container.textContent).toContain('الشروط والأحكام');
    expect(container.textContent).toContain('البنك الأهلي السعودي');
    expect(container.querySelector('[data-doc-totals="modern"]')?.className).not.toContain('rounded-md');
    expect(container.querySelector('[data-doc-keep="summary"]')).toBeTruthy();
    expect(container.querySelector('img[alt="stamp"]')).toBeTruthy();
  });

  it('يرسم QR بحجم Modern بجانب الملخص لا في الرأس', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model);
    const summaryQr = container.querySelector('[data-doc-keep="summary"] svg');
    expect(summaryQr).toBeTruthy();
    expect(summaryQr?.getAttribute('width')).toBe('76');
    expect(container.querySelector('header svg')).toBeNull();
  });

  it('يثبّت جدول البنود table-fixed ويلف الوصف الطويل ويحترم الأعمدة القابلة للضبط', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model, [
      { key: 'header', visible: true },
      { key: 'items', visible: true, properties: { columns: [{ id: 'product' }, { id: 'description', label: 'بيان البند' }, { id: 'total' }] } },
      { key: 'summary', visible: true },
      { key: 'footer', visible: true },
    ]);
    const table = container.querySelector('table');
    expect(table?.className).toContain('table-fixed');
    expect(container.textContent).toContain('بيان البند');
    expect(container.textContent).not.toContain('qty');
    const descriptionCell = container.querySelector('td.break-words');
    expect(descriptionCell?.textContent?.length).toBeGreaterThan(40);
  });

  it('يركب عنواناً ثنائي اللغة عند اختلاف الاتجاه عن لغة الواجهة', () => {
    locale.current = 'en';
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model);
    expect(container.querySelector('h1')?.textContent).toBe('فاتورة ضريبية | Tax Invoice');
  });

  it('يبقي هاتف المنشأة في التذييل لا في بطاقة طرف', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model);
    const footer = container.querySelector('footer');
    const parties = container.querySelectorAll('section')[0];
    expect(footer?.textContent).toContain('+966 13 555 0101');
    expect(footer?.textContent).toContain('+966 50 555 0101');
    expect(parties?.textContent).not.toContain('+966 13 555 0101');
  });

  it('يغطي سيناريوهات 1 و5 و20+ بنداً دون كسر التركيب', () => {
    for (const scenario of ['single', 'five', 'twenty'] as const) {
      const model = makeDocumentQaModel({ scenario, direction: 'rtl', showQr: true, showAssets: true });
      const { container, unmount } = renderComposition(MODERN_STYLE, model);
      expect(container.querySelectorAll('tbody tr')).toHaveLength(model.lines.length);
      expect(container.querySelector('[data-doc-composition="modern"]')).toBeTruthy();
      unmount();
    }
  });

  it('لا يغيّر تركيب ERP: شريط هوية ومربع شعار احتياطي وثلاث مناطق أطراف', () => {
    locale.current = 'en';
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(ERP_STYLE, model);
    expect(container.querySelector('[data-doc-composition="erp"]')).toBeTruthy();
    expect(container.querySelector('header .h-14')).toBeTruthy();
    expect(container.querySelectorAll('section.grid.grid-cols-12 > div')).toHaveLength(3);
    expect(container.querySelector('h1')?.textContent).toBe('Tax Invoice');
    expect(container.textContent).not.toContain('فاتورة ضريبية | Tax Invoice');
    expect(container.textContent).not.toContain(modernFieldLabel('seller', 'bilingual'));
  });

  it('يعرض المبالغ رقمياً في الخلايا ووحدة ريال في الرأس والإجماليات عربياً', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model);
    const thead = container.querySelector('thead');
    const tbody = container.querySelector('tbody');
    const totals = container.querySelector('[data-doc-totals="modern"]');
    expect(thead?.textContent).toContain('ريال');
    expect(thead?.textContent).not.toContain('SAR');
    expect(tbody?.textContent).not.toContain('ريال');
    expect(tbody?.textContent).not.toContain('SAR');
    expect(tbody?.textContent).not.toContain('﷼');
    expect(totals?.textContent).toContain('ريال');
    expect(totals?.textContent).not.toContain('SAR');
    expect(totals?.textContent).not.toContain('﷼');
  });

  it('يعرض SAR في الإنجليزية دون ريال في الرأس أو الإجماليات', () => {
    locale.current = 'en';
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'ltr', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model);
    const thead = container.querySelector('thead');
    const tbody = container.querySelector('tbody');
    const totals = container.querySelector('[data-doc-totals="modern"]');
    expect(thead?.textContent).toContain('SAR');
    expect(thead?.textContent).not.toContain('ريال');
    expect(tbody?.textContent).not.toContain('ريال');
    expect(tbody?.textContent).not.toContain('SAR');
    expect(tbody?.textContent).not.toContain('﷼');
    expect(totals?.textContent).toContain('SAR');
    expect(totals?.textContent).not.toContain('ريال');
    expect(totals?.textContent).not.toContain('﷼');
  });

  it('يعرض SAR في الوضع الثنائي دون ريال', () => {
    locale.current = 'en';
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model);
    expect(container.querySelector('h1')?.textContent).toBe('فاتورة ضريبية | Tax Invoice');
    expect(container.querySelector('thead')?.textContent).toContain('SAR');
    expect(container.querySelector('[data-doc-totals="modern"]')?.textContent).toContain('SAR');
    expect(container.querySelector('[data-doc-totals="modern"]')?.textContent).not.toContain('ريال');
  });

  it('يطبق العربية | English على كل تسميات Modern الظاهرة في الوضع الثنائي', () => {
    locale.current = 'en';
    const base = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: true });
    const model: DocumentModel = {
      ...base,
      footerText: null,
      qr: base.qr ? { ...base.qr, note: null } : null,
      status: 'draft',
    };
    const { container } = renderComposition(MODERN_STYLE, model, FULL_LAYOUT);
    const text = container.textContent ?? '';

    const expected = [
      modernFieldLabel('vat_number', 'bilingual'),
      modernFieldLabel('cr_number', 'bilingual'),
      modernFieldLabel('national_address', 'bilingual'),
      modernFieldLabel('number', 'bilingual'),
      modernFieldLabel('date', 'bilingual'),
      modernFieldLabel('due_date', 'bilingual'),
      modernFieldLabel('payment_type', 'bilingual'),
      modernFieldLabel('credit', 'bilingual'),
      modernFieldLabel('seller', 'bilingual'),
      modernFieldLabel('buyer', 'bilingual'),
      modernFieldLabel('city', 'bilingual'),
      modernFieldLabel('notes', 'bilingual'),
      modernFieldLabel('terms', 'bilingual'),
      modernFieldLabel('bank', 'bilingual'),
      modernFieldLabel('signature', 'bilingual'),
      modernFieldLabel('amount_words', 'bilingual'),
      modernFieldLabel('zatca_note', 'bilingual'),
      modernFieldLabel('footer', 'bilingual'),
    ];
    expect(container.querySelector('[data-doc-status-notice="draft"]')?.textContent).toBe('مسودة | Draft');
    for (const label of expected) {
      expect(text, label).toContain(label);
    }

    const headers = [...container.querySelectorAll('thead th')].map((node) => normalizeLabel(node.textContent));
    expect(headers).toContain('#');
    for (const column of ['product', 'description', 'product_code', 'barcode', 'quantity'] as const) {
      expect(headers).toContain(modernColumnLabel(column, 'bilingual'));
    }
    for (const column of ['unit_price', 'price_before_tax', 'tax', 'total'] as const) {
      expect(headers).toContain(modernMoneyColumnHeader(modernColumnLabel(column, 'bilingual'), 'SAR', 'bilingual'));
    }
    for (const header of headers) {
      if (header === '#') {
        expect(header).not.toContain(' | ');
        continue;
      }
      expectBilingualLabel(header, `thead:${header}`);
    }

    const totalLabels = [...container.querySelectorAll('[data-doc-totals="modern"] > div > span:first-child')]
      .map((node) => normalizeLabel(node.textContent));
    for (const key of ['subtotal', 'discount', 'shipping', 'adjustment', 'vat', 'grand_total'] as const) {
      expect(totalLabels).toContain(modernTotalLabel(key, 'bilingual'));
    }
    for (const label of totalLabels) expectBilingualLabel(label, `totals:${label}`);

    expect(text.split(model.meta.number).length - 1).toBe(1);
    expect(text.split(model.meta.date).length - 1).toBe(1);
    expect(text.split(model.buyer.vatNumber ?? '').length - 1).toBe(1);
    expect(text).not.toContain(`${model.seller.vatNumber} | ${model.seller.vatNumber}`);
    expect(text).not.toContain(`${model.meta.number} | ${model.meta.number}`);
    expect(text).not.toContain(`${model.meta.date} | ${model.meta.date}`);
    expect(text).toContain(model.seller.name);
    expect(text).toContain(model.lines[0]?.productName ?? '');
    expect(text).not.toContain('Nebrax QA Trading Company');
    expect(text).not.toContain('Enterprise service line 1');
  });

  it('يبقي التسمية المخصّصة كما خُزنت ولا يترجم بيانات الأعمال في الوضع الثنائي', () => {
    locale.current = 'en';
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model, [
      { key: 'header', visible: true },
      { key: 'items', visible: true, properties: { columns: [{ id: 'product' }, { id: 'description', label: 'بيان البند' }, { id: 'total' }] } },
      { key: 'summary', visible: true },
    ]);
    const headers = [...container.querySelectorAll('thead th')].map((node) => normalizeLabel(node.textContent));
    expect(headers).toContain('بيان البند');
    expect(headers).toContain(modernColumnLabel('product', 'bilingual'));
    expect(headers).toContain(modernMoneyColumnHeader(modernColumnLabel('total', 'bilingual'), 'SAR', 'bilingual'));
    expect(headers.some((header) => header.includes('Description'))).toBe(false);
  });

  it('يبقي العربية والإنجليزية المنفردتين بلا فاصل ثنائي', () => {
    const arabic = renderComposition(
      MODERN_STYLE,
      makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false }),
    );
    const arabicHead = arabic.container.querySelector('thead')?.textContent ?? '';
    const arabicTotals = arabic.container.querySelector('[data-doc-totals="modern"]')?.textContent ?? '';
    expect(arabicHead).toContain(modernColumnLabel('product', 'ar'));
    expect(arabicHead).not.toContain(' | ');
    expect(arabicHead).not.toMatch(ENGLISH_COLUMN_WORDS);
    expect(arabicTotals).toContain(modernTotalLabel('subtotal', 'ar'));
    expect(arabicTotals).not.toContain(' | ');
    expect(arabicTotals).not.toContain('Subtotal');
    arabic.unmount();

    locale.current = 'en';
    const english = renderComposition(
      MODERN_STYLE,
      makeDocumentQaModel({ scenario: 'five', direction: 'ltr', showQr: false, showAssets: false }),
    );
    const englishHead = english.container.querySelector('thead')?.textContent ?? '';
    const englishTotals = english.container.querySelector('[data-doc-totals="modern"]')?.textContent ?? '';
    expect(englishHead).toContain(modernColumnLabel('product', 'en'));
    expect(englishHead).not.toContain(' | ');
    expect(englishHead).not.toContain('المنتج');
    expect(englishTotals).toContain(modernTotalLabel('grand_total', 'en'));
    expect(englishTotals).not.toContain(' | ');
    expect(englishTotals).not.toContain('الإجمالي شامل الضريبة');
  });

  it('يرصف الملخص بـ flex وjustify-between بلا فراغ شبكة', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model);
    const summary = container.querySelector('[data-doc-keep="summary"]');
    expect(summary?.className).toContain('justify-between');
    expect(summary?.className).toContain('flex');
    expect(summary?.className).not.toContain('grid-cols-12');
    expect(summary?.className).not.toContain('col-start-8');
  });

  it('لا يحوّل Minimal إلى بطاقات ولا يضيف شارة للمرحّل', () => {
    const model = {
      ...makeDocumentQaModel({ scenario: 'single', direction: 'ltr', showQr: false, showAssets: false }),
      status: 'posted',
    };
    const { container } = renderComposition(MINIMAL_STYLE, model);
    expect(container.querySelector('[data-doc-composition="minimal"]')).toBeTruthy();
    expect(container.querySelector('[data-doc-status-notice]')).toBeNull();
  });
});
