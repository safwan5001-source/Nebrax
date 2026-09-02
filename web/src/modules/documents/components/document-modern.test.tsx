// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentBody } from './document-body';
import { ERP_STYLE, MINIMAL_STYLE, MODERN_V2_STYLE } from '../templates/template-styles';
import { makeDocumentQaModel } from '../qa/document-qa-fixtures';
import { getTheme } from '../themes';
import {
  MODERN_COLUMN_LABELS,
  MODERN_FIELD_LABELS,
  MODERN_TOTAL_LABELS,
  isModernMoneyColumn,
  modernColumnLabel,
  modernFieldLabel,
  modernTotalLabel,
} from '../presentation/visual-v2';
import { DEFAULT_DOCUMENT_ITEMS_COLUMNS } from '../registry/document-types';
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

const ENGLISH_COLUMN_WORDS = /\b(Product|Description|Qty|Barcode|Tax|Subtotal|Shipping|Adjustment)\b/;

function normalizeLabel(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function bilingualRoots(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-modern-bilingual="label"]')];
}

function bilingualPair(root: Element): { ar: string; en: string } {
  return {
    ar: root.querySelector('[dir="rtl"]')?.textContent ?? '',
    en: root.querySelector('[dir="ltr"]')?.textContent ?? '',
  };
}

function findBilingual(container: ParentNode, ar: string, en: string) {
  return bilingualRoots(container).find((node) => {
    const pair = bilingualPair(node);
    return pair.ar === ar && pair.en === en;
  });
}

function expectIsolatedBilingual(root: Element | null | undefined, ar: string, en: string, context: string) {
  expect(root, context).toBeTruthy();
  expect(root!.querySelector('[dir="rtl"]')?.textContent, `${context}:ar`).toBe(ar);
  expect(root!.querySelector('[dir="ltr"]')?.textContent, `${context}:en`).toBe(en);
  expect(root!.textContent, `${context}:no-pipe`).not.toContain(' | ');
}

function expectFieldPresent(container: ParentNode, field: keyof typeof MODERN_FIELD_LABELS) {
  const pair = MODERN_FIELD_LABELS[field];
  expect(findBilingual(container, pair.ar, pair.en), String(field)).toBeTruthy();
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
  it('يوسم الغلاف بتركيب modern_v2 ويكرر قواعد الطباعة عبر data-doc-composition', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: true, showAssets: true });
    const { container } = renderComposition(MODERN_V2_STYLE, model);
    const root = container.querySelector('[data-doc-composition="modern_v2"]');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('id')).toBe('qa-print-root');
  });

  it('لا يرسم مربعاً ملوّناً احتياطياً عند غياب الشعار', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_V2_STYLE, model);
    expect(container.querySelector('header .h-14')).toBeNull();
    expect(container.querySelector('header img')).toBeNull();
  });

  it('يحد الشعار الحاضر ولا يتجاوز سقف الارتفاع', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: true });
    const { container } = renderComposition(MODERN_V2_STYLE, model);
    const img = container.querySelector('header img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('class')).toContain('max-h-9');
    expect(img?.getAttribute('style')).toContain('36px');
  });

  it('يعرض شارة المسودة والملغى فقط', () => {
    const base = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false });
    const draft = renderComposition(MODERN_V2_STYLE, { ...base, status: 'draft' });
    expect(draft.container.querySelector('[data-doc-status-notice="draft"]')).toBeTruthy();
    draft.unmount();

    const cancelled = renderComposition(MODERN_V2_STYLE, { ...base, status: 'cancelled' });
    expect(cancelled.container.querySelector('[data-doc-status-notice="cancelled"]')).toBeTruthy();
    cancelled.unmount();

    const posted = renderComposition(MODERN_V2_STYLE, { ...base, status: 'posted' });
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
    const { container } = renderComposition(MODERN_V2_STYLE, model, FULL_LAYOUT);
    expect(container.textContent).not.toContain('ملاحظات داخلية');
    expect(container.textContent).not.toContain('QA note');
    expect(container.querySelector('img[alt="stamp"]')).toBeNull();
    expect(container.querySelector('img[alt="signature"]')).toBeNull();
  });

  it('يعرض الأقسام الاختيارية عند وجودها دون بطاقة زخرفية', () => {
    const model = makeDocumentQaModel({ scenario: 'long_content', direction: 'rtl', showQr: true, showAssets: true });
    const { container } = renderComposition(MODERN_V2_STYLE, model, FULL_LAYOUT);
    expect(container.textContent).toContain('ملاحظات داخلية');
    expect(container.textContent).toContain('الشروط والأحكام');
    expect(container.textContent).toContain('البنك الأهلي السعودي');
    expect(container.querySelector('[data-doc-totals="modern_v2"]')?.className).not.toContain('rounded-md');
    expect(container.querySelector('[data-doc-keep="summary"]')).toBeTruthy();
    expect(container.querySelector('img[alt="stamp"]')).toBeTruthy();
  });

  it('يرسم QR بحجم Modern بجانب الملخص لا في الرأس', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(MODERN_V2_STYLE, model);
    const summaryQr = container.querySelector('[data-doc-keep="summary"] svg');
    expect(summaryQr).toBeTruthy();
    expect(summaryQr?.getAttribute('width')).toBe('76');
    expect(container.querySelector('header svg')).toBeNull();
  });

  it('يثبّت جدول البنود table-fixed ويلف الوصف الطويل ويحترم الأعمدة القابلة للضبط', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_V2_STYLE, model, [
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
    const { container } = renderComposition(MODERN_V2_STYLE, model);
    expectIsolatedBilingual(
      container.querySelector('h1 [data-modern-bilingual="label"]'),
      'فاتورة ضريبية',
      'Tax Invoice',
      'h1',
    );
    expect(container.querySelector('h1')?.textContent).not.toContain(' | ');
    expect(container.querySelector('h1')?.textContent).toContain('فاتورة ضريبية');
    expect(container.querySelector('h1')?.textContent).toContain('Tax Invoice');
  });

  it('يبقي هاتف المنشأة في التذييل لا في بطاقة طرف', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_V2_STYLE, model);
    const footer = container.querySelector('footer');
    const parties = container.querySelectorAll('section')[0];
    expect(footer?.textContent).toContain('+966 13 555 0101');
    expect(footer?.textContent).toContain('+966 50 555 0101');
    expect(parties?.textContent).not.toContain('+966 13 555 0101');
  });

  it('يغطي سيناريوهات 1 و5 و20+ بنداً دون كسر التركيب', () => {
    for (const scenario of ['single', 'five', 'twenty'] as const) {
      const model = makeDocumentQaModel({ scenario, direction: 'rtl', showQr: true, showAssets: true });
      const { container, unmount } = renderComposition(MODERN_V2_STYLE, model);
      expect(container.querySelectorAll('tbody tr')).toHaveLength(model.lines.length);
      expect(container.querySelector('[data-doc-composition="modern_v2"]')).toBeTruthy();
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
    expect(container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(container.textContent).not.toContain('فاتورة ضريبية | Tax Invoice');
    expect(container.textContent).not.toContain(modernFieldLabel('seller', 'bilingual'));
  });

  it('يعرض المبالغ رقمياً في الخلايا ووحدة ريال في الرأس والإجماليات عربياً', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_V2_STYLE, model);
    const thead = container.querySelector('thead');
    const tbody = container.querySelector('tbody');
    const totals = container.querySelector('[data-doc-totals="modern_v2"]');
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
    const { container } = renderComposition(MODERN_V2_STYLE, model);
    const thead = container.querySelector('thead');
    const tbody = container.querySelector('tbody');
    const totals = container.querySelector('[data-doc-totals="modern_v2"]');
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
    const { container } = renderComposition(MODERN_V2_STYLE, model);
    expectIsolatedBilingual(
      container.querySelector('h1 [data-modern-bilingual="label"]'),
      'فاتورة ضريبية',
      'Tax Invoice',
      'h1-sar',
    );
    expect(container.querySelector('thead')?.textContent).toContain('SAR');
    expect(container.querySelector('[data-doc-totals="modern_v2"]')?.textContent).toContain('SAR');
    expect(container.querySelector('[data-doc-totals="modern_v2"]')?.textContent).not.toContain('ريال');
  });

  it('يعزل تسميات Modern الثنائية في عقدتين دون خلط القيمة أو فاصل نصي', () => {
    locale.current = 'en';
    const base = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: true });
    const model: DocumentModel = {
      ...base,
      footerText: null,
      qr: base.qr ? { ...base.qr, note: null } : null,
      status: 'draft',
    };
    const { container } = renderComposition(MODERN_V2_STYLE, model, FULL_LAYOUT);
    const text = container.textContent ?? '';

    expect(text).not.toContain(' | ');
    expect(bilingualRoots(container).length).toBeGreaterThan(10);
    for (const root of bilingualRoots(container)) {
      const pair = bilingualPair(root);
      expect(pair.ar, root.textContent).not.toBe('');
      expect(pair.en, root.textContent).not.toBe('');
      expect(pair.ar).not.toBe(pair.en);
      expect(root.querySelector('[dir="rtl"]')).toBeTruthy();
      expect(root.querySelector('[dir="ltr"]')).toBeTruthy();
    }

    const visibleFields = [
      'vat_number', 'cr_number', 'national_address', 'number', 'date', 'due_date',
      'payment_type', 'credit', 'seller', 'buyer', 'city', 'notes', 'terms', 'bank',
      'signature', 'amount_words', 'zatca_note', 'footer',
    ] as const;
    for (const field of visibleFields) expectFieldPresent(container, field);

    expectIsolatedBilingual(
      container.querySelector('[data-doc-status-notice="draft"] [data-modern-bilingual="label"]'),
      'مسودة',
      'Draft',
      'status',
    );

    for (const label of container.querySelectorAll('[data-doc-info-label]')) {
      const row = label.parentElement;
      const value = row?.querySelector('[data-doc-info-value]');
      const labelNode = label.querySelector('[data-modern-bilingual="label"]');
      expect(value, 'info-value').toBeTruthy();
      expect(labelNode?.contains(value!), 'value-inside-label').toBe(false);
      expect(value!.closest('[data-modern-bilingual]')).toBeNull();
    }

    const numberPair = MODERN_FIELD_LABELS.number;
    const numberLabel = findBilingual(container, numberPair.ar, numberPair.en);
    const numberRow = numberLabel?.closest('div');
    expect(numberRow?.querySelector('[data-doc-info-value]')?.textContent).toBe(model.meta.number);
    expect(numberLabel?.textContent).not.toContain(model.meta.number);
    expect(numberRow?.querySelector('[data-doc-info-value] .num')?.getAttribute('dir')).toBe('ltr');

    const datePair = MODERN_FIELD_LABELS.date;
    const dateLabel = findBilingual(container, datePair.ar, datePair.en);
    expect(dateLabel?.closest('div')?.querySelector('[data-doc-info-value]')?.textContent).toBe(model.meta.date);

    const vatPair = MODERN_FIELD_LABELS.vat_number;
    const vatLabel = findBilingual(container, vatPair.ar, vatPair.en);
    expect(vatLabel?.closest('div')?.querySelector('[data-doc-info-value] .num')?.getAttribute('dir')).toBe('ltr');
    expect(vatLabel?.closest('div')?.querySelector('[data-doc-info-value]')?.textContent).toBe(model.seller.vatNumber);

    const addressPair = MODERN_FIELD_LABELS.national_address;
    const addressLabel = findBilingual(container, addressPair.ar, addressPair.en);
    const addressValue = addressLabel?.closest('div')?.querySelector('[data-doc-info-value]');
    expect(addressValue?.querySelector('[dir="ltr"]')).toBeNull();
    expect(addressValue?.querySelector('.num')).toBeNull();
    expect(addressValue?.textContent).toContain(model.seller.address ?? '');

    const paymentPair = MODERN_FIELD_LABELS.payment_type;
    const paymentLabel = findBilingual(container, paymentPair.ar, paymentPair.en);
    const paymentValue = paymentLabel?.closest('div')?.querySelector('[data-doc-info-value] [data-modern-bilingual="label"]');
    expectIsolatedBilingual(paymentValue, MODERN_FIELD_LABELS.credit.ar, MODERN_FIELD_LABELS.credit.en, 'payment-value');

    const headers = [...container.querySelectorAll('thead th')];
    expect(headers).toHaveLength(DEFAULT_DOCUMENT_ITEMS_COLUMNS.length);
    headers.forEach((th, index) => {
      const column = DEFAULT_DOCUMENT_ITEMS_COLUMNS[index];
      if (column === 'number') {
        expect(th.querySelector('[data-modern-bilingual]')).toBeNull();
        expect(normalizeLabel(th.textContent)).toBe('#');
        return;
      }
      const pair = MODERN_COLUMN_LABELS[column];
      const en = isModernMoneyColumn(column) ? `${pair.en} (SAR)` : pair.en;
      expectIsolatedBilingual(th.querySelector('[data-modern-bilingual="label"]'), pair.ar, en, `th:${column}`);
      if (isModernMoneyColumn(column)) {
        expect(th.querySelector('[dir="rtl"]')?.textContent).not.toContain('SAR');
        expect(th.querySelector('[dir="ltr"]')?.textContent).toContain('SAR');
      } else {
        expect(th.textContent).not.toContain('SAR');
      }
    });
    expect(container.querySelector('tbody')?.textContent).not.toContain('SAR');
    expect(container.querySelector('tbody')?.textContent).not.toContain('ريال');

    const totalRows = [...container.querySelectorAll('[data-doc-totals="modern_v2"] > div')];
    for (const key of ['subtotal', 'discount', 'shipping', 'adjustment', 'vat', 'grand_total'] as const) {
      const pair = MODERN_TOTAL_LABELS[key];
      const row = totalRows.find((node) => node.querySelector('[dir="rtl"]')?.textContent === pair.ar);
      expect(row, key).toBeTruthy();
      expectIsolatedBilingual(row!.querySelector('[data-modern-bilingual="label"]'), pair.ar, pair.en, `total:${key}`);
      const amount = row!.querySelector('.num');
      expect(amount, `${key}:amount`).toBeTruthy();
      expect(amount!.closest('[data-modern-bilingual]')).toBeNull();
      expect(row!.className).toContain('items-start');
    }

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
    const { container } = renderComposition(MODERN_V2_STYLE, model, [
      { key: 'header', visible: true },
      { key: 'items', visible: true, properties: { columns: [{ id: 'product' }, { id: 'description', label: 'بيان البند' }, { id: 'total' }] } },
      { key: 'summary', visible: true },
    ]);
    const headers = [...container.querySelectorAll('thead th')];
    expect(headers.some((node) => normalizeLabel(node.textContent) === 'بيان البند')).toBe(true);
    expectIsolatedBilingual(
      headers.find((node) => node.querySelector('[dir="rtl"]')?.textContent === MODERN_COLUMN_LABELS.product.ar)
        ?.querySelector('[data-modern-bilingual="label"]'),
      MODERN_COLUMN_LABELS.product.ar,
      MODERN_COLUMN_LABELS.product.en,
      'custom-product',
    );
    expectIsolatedBilingual(
      headers.find((node) => node.querySelector('[dir="rtl"]')?.textContent === MODERN_COLUMN_LABELS.total.ar)
        ?.querySelector('[data-modern-bilingual="label"]'),
      MODERN_COLUMN_LABELS.total.ar,
      `${MODERN_COLUMN_LABELS.total.en} (SAR)`,
      'custom-total',
    );
    expect(headers.some((node) => (node.textContent ?? '').includes('Description'))).toBe(false);
  });

  it('يبقي العربية والإنجليزية المنفردتين بلا فاصل ثنائي ولا وسم عزل', () => {
    const arabic = renderComposition(
      MODERN_V2_STYLE,
      makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false }),
    );
    const arabicHead = arabic.container.querySelector('thead')?.textContent ?? '';
    const arabicTotals = arabic.container.querySelector('[data-doc-totals="modern_v2"]')?.textContent ?? '';
    expect(arabic.container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(arabicHead).toContain(modernColumnLabel('product', 'ar'));
    expect(arabicHead).not.toContain(' | ');
    expect(arabicHead).not.toMatch(ENGLISH_COLUMN_WORDS);
    expect(arabicTotals).toContain(modernTotalLabel('subtotal', 'ar'));
    expect(arabicTotals).not.toContain(' | ');
    expect(arabicTotals).not.toContain('Subtotal');
    arabic.unmount();

    locale.current = 'en';
    const english = renderComposition(
      MODERN_V2_STYLE,
      makeDocumentQaModel({ scenario: 'five', direction: 'ltr', showQr: false, showAssets: false }),
    );
    const englishHead = english.container.querySelector('thead')?.textContent ?? '';
    const englishTotals = english.container.querySelector('[data-doc-totals="modern_v2"]')?.textContent ?? '';
    expect(english.container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(englishHead).toContain(modernColumnLabel('product', 'en'));
    expect(englishHead).not.toContain(' | ');
    expect(englishHead).not.toContain('المنتج');
    expect(englishTotals).toContain(modernTotalLabel('grand_total', 'en'));
    expect(englishTotals).not.toContain(' | ');
    expect(englishTotals).not.toContain('الإجمالي شامل الضريبة');
  });

  it('لا يلوّث ERP أو Minimal بعقد السطرين الثنائيين حتى مع locale=en واتجاه RTL', () => {
    locale.current = 'en';
    const quotation = makeDocumentQaModel({
      documentType: 'quotation',
      scenario: 'five',
      direction: 'rtl',
      showQr: false,
      showAssets: false,
    });
    const erp = renderComposition(ERP_STYLE, quotation);
    expect(erp.container.querySelector('[data-doc-composition="erp"]')).toBeTruthy();
    expect(erp.container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(erp.container.querySelector('h1')?.textContent).toBe('Tax Invoice');
    expect(erp.container.textContent).not.toContain(' | ');
    erp.unmount();

    const invoice = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const minimal = renderComposition(MINIMAL_STYLE, invoice);
    expect(minimal.container.querySelector('[data-doc-composition="minimal"]')).toBeTruthy();
    expect(minimal.container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(minimal.container.textContent).not.toContain(' | ');
  });

  it('يرصف الملخص بـ flex وjustify-between بلا فراغ شبكة', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(MODERN_V2_STYLE, model);
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
