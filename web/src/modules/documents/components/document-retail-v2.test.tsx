// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentBody } from './document-body';
import {
  CLASSIC_STYLE,
  CLASSIC_V2_STYLE,
  ERP_V2_STYLE,
  MINIMAL_V2_STYLE,
  MODERN_V2_STYLE,
  RETAIL_STYLE,
  RETAIL_V2_STYLE,
} from '../templates/template-styles';
import { makeDocumentQaModel } from '../qa/document-qa-fixtures';
import { getTheme } from '../themes';
import {
  MODERN_COLUMN_LABELS,
  isModernMoneyColumn,
  modernColumnLabel,
  modernTotalLabel,
} from '../presentation/visual-v2';
import { RETAIL_V2 } from '../presentation/retail-v2';
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
  { key: 'barcode', visible: true },
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

function bilingualRoots(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-modern-bilingual="label"]')];
}

function expectIsolatedBilingual(root: Element | null | undefined, ar: string, en: string, context: string) {
  expect(root, context).toBeTruthy();
  expect(root!.querySelector('[dir="rtl"]')?.textContent, `${context}:ar`).toBe(ar);
  expect(root!.querySelector('[dir="ltr"]')?.textContent, `${context}:en`).toBe(en);
  expect(root!.textContent, `${context}:no-pipe`).not.toContain(' | ');
}

function renderComposition(style: TemplateStyle, model: DocumentModel, layout?: DocSectionLayoutItem[] | null, sections?: { barcode?: boolean }) {
  return render(
    <DocumentBody
      model={model}
      theme={theme}
      formatMoney={formatMoney}
      style={style}
      layout={layout}
      sections={sections}
      rootId="qa-print-root"
    />,
  );
}

afterEach(() => {
  cleanup();
  locale.current = 'ar';
});

describe('Retail V2 visual composition', () => {
  it('يوسم الغلاف بتركيب retail_v2 لا retail التاريخي', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: true });
    const { container } = renderComposition(RETAIL_V2_STYLE, model);
    expect(container.querySelector('[data-doc-composition="retail_v2"]')).toBeTruthy();
    expect(container.querySelector('[data-doc-composition="retail"]')).toBeNull();
    expect(container.querySelector('[data-doc-keep="summary"]')).toBeTruthy();
  });

  it('لا يرسم مربعاً ملوّناً احتياطياً عند غياب الشعار ولا شريط هوية', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(RETAIL_V2_STYLE, model);
    expect(container.querySelector('header .h-14')).toBeNull();
    expect(container.querySelector('header img')).toBeNull();
    expect(container.querySelector('.h-1')).toBeNull();
  });

  it('يرسم طرفين بلا إطار وبلا بطاقة ميتا ثالثة وبلا بطاقة إجماليات رمادية', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(RETAIL_V2_STYLE, model);
    expect(container.querySelectorAll('section.grid.grid-cols-2 > div')).toHaveLength(2);
    expect(container.querySelectorAll('div.grid.grid-cols-3 > div')).toHaveLength(0);
    const totals = container.querySelector('[data-doc-totals="retail_v2"]');
    expect(totals?.className).toContain('border-y');
    expect(totals?.className).not.toContain('rounded-lg');
    expect(totals?.className).not.toContain('border-s-2');
    expect(totals?.className).not.toContain('border-black');
  });

  it('يرسم QR 66px بجانب الملخص وباركود المستند عند تفعيله', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(RETAIL_V2_STYLE, model, FULL_LAYOUT, { barcode: true });
    const qr = container.querySelector('[data-doc-keep="summary"] svg');
    expect(qr?.getAttribute('width')).toBe(String(RETAIL_V2.qrSizePx));
    expect(container.querySelector('header svg')).toBeNull();
    expect(container.querySelector('svg[aria-label]')).toBeTruthy();
  });

  it('يطوي الملاحظات والبنك والشروط عند الغياب', () => {
    const model: DocumentModel = {
      ...makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false }),
      notes: null,
      terms: null,
      bank: null,
      stampUrl: null,
      signatureUrl: null,
    };
    const { container } = renderComposition(RETAIL_V2_STYLE, model, FULL_LAYOUT);
    expect(container.querySelector('img[alt="stamp"]')).toBeNull();
    expect(container.querySelector('img[alt="signature"]')).toBeNull();
  });

  it('يغطي سيناريوهات 1 و5 و20 ووصف طويل', () => {
    for (const scenario of ['single', 'five', 'twenty', 'long_content'] as const) {
      const model = makeDocumentQaModel({ scenario, direction: 'rtl', showQr: true, showAssets: true });
      const { container, unmount } = renderComposition(RETAIL_V2_STYLE, model);
      expect(container.querySelectorAll('tbody tr')).toHaveLength(model.lines.length);
      expect(container.querySelector('[data-doc-composition="retail_v2"]')).toBeTruthy();
      unmount();
    }
  });

  it('يعرض المبالغ رقمياً ووحدة ريال في الرأس عربياً', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(RETAIL_V2_STYLE, model);
    expect(container.querySelector('thead')?.textContent).toContain('ريال');
    expect(container.querySelector('tbody')?.textContent).not.toContain('ريال');
    expect(container.querySelector('[data-doc-totals="retail_v2"]')?.textContent).toContain('ريال');
  });

  it('يعزل التسميات الثنائية دون فاصل نصي', () => {
    locale.current = 'en';
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(RETAIL_V2_STYLE, model);
    expectIsolatedBilingual(
      container.querySelector('h1 [data-modern-bilingual="label"]'),
      'فاتورة ضريبية',
      'Tax Invoice',
      'h1',
    );
    expect(container.textContent).not.toContain(' | ');
    expect(bilingualRoots(container).length).toBeGreaterThan(8);
    const unitHeader = [...container.querySelectorAll('thead th')].find((th) => (
      th.querySelector('[dir="rtl"]')?.textContent === MODERN_COLUMN_LABELS.total.ar
    ));
    expectIsolatedBilingual(
      unitHeader?.querySelector('[data-modern-bilingual="label"]'),
      MODERN_COLUMN_LABELS.total.ar,
      `${MODERN_COLUMN_LABELS.total.en} (SAR)`,
      'th-total',
    );
    expect(isModernMoneyColumn('total')).toBe(true);
  });

  it('يبقي العربية والإنجليزية المنفردتين بلا وسم عزل', () => {
    const arabic = renderComposition(
      RETAIL_V2_STYLE,
      makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false }),
    );
    expect(arabic.container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(arabic.container.querySelector('thead')?.textContent).toContain(modernColumnLabel('product', 'ar'));
    expect(arabic.container.querySelector('[data-doc-totals="retail_v2"]')?.textContent).toContain(modernTotalLabel('subtotal', 'ar'));
    arabic.unmount();

    locale.current = 'en';
    const english = renderComposition(
      RETAIL_V2_STYLE,
      makeDocumentQaModel({ scenario: 'five', direction: 'ltr', showQr: false, showAssets: false }),
    );
    expect(english.container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(english.container.querySelector('thead')?.textContent).toContain(modernColumnLabel('product', 'en'));
    expect(english.container.querySelector('[data-doc-totals="retail_v2"]')?.textContent).toContain(modernTotalLabel('grand_total', 'en'));
  });

  it('لا يغيّر تركيب Retail التاريخي: ثلاث بطاقات وشريط هوية وQR 110', () => {
    locale.current = 'en';
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(RETAIL_STYLE, model, FULL_LAYOUT, { barcode: true });
    expect(container.querySelector('[data-doc-composition="retail"]')).toBeTruthy();
    expect(container.querySelector('[data-doc-composition="retail_v2"]')).toBeNull();
    expect(container.querySelectorAll('div.grid.grid-cols-3 > div')).toHaveLength(3);
    expect(container.querySelector('.h-1')).toBeTruthy();
    expect(container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(container.querySelector('[data-doc-keep="summary"]')).toBeNull();
    expect(container.querySelector('svg[width]')?.getAttribute('width')).toBe('110');
    expect(container.querySelector('svg[aria-label]')).toBeTruthy();
  });

  it('يبقي Classic التاريخي على نفس الـ fallback المشترك: ثلاث بطاقات وشريط هوية', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(CLASSIC_STYLE, model);
    expect(container.querySelector('[data-doc-composition="classic"]')).toBeTruthy();
    expect(container.querySelectorAll('div.grid.grid-cols-3 > div')).toHaveLength(3);
    expect(container.querySelector('.h-1')).toBeTruthy();
    expect(container.querySelector('svg[width]')?.getAttribute('width')).toBe('110');
  });

  it('لا يحوّل عائلات V2 السابقة إلى تركيب Retail', () => {
    const modern = renderComposition(
      MODERN_V2_STYLE,
      makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false }),
    );
    expect(modern.container.querySelector('[data-doc-composition="modern_v2"]')).toBeTruthy();
    expect(modern.container.querySelector('[data-doc-composition="retail_v2"]')).toBeNull();
    expect(modern.container.querySelector('[data-doc-keep="summary"] svg')?.getAttribute('width')).toBe('76');
    modern.unmount();

    const erp = renderComposition(
      ERP_V2_STYLE,
      makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false }),
    );
    expect(erp.container.querySelector('[data-doc-composition="erp_v2"]')).toBeTruthy();
    expect(erp.container.querySelector('[data-doc-keep="summary"] svg')?.getAttribute('width')).toBe('64');
    erp.unmount();

    const classic = renderComposition(
      CLASSIC_V2_STYLE,
      makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false }),
    );
    expect(classic.container.querySelector('[data-doc-composition="classic_v2"]')).toBeTruthy();
    expect(classic.container.querySelector('[data-doc-keep="summary"] svg')?.getAttribute('width')).toBe('70');
    classic.unmount();

    const minimal = renderComposition(
      MINIMAL_V2_STYLE,
      makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false }),
    );
    expect(minimal.container.querySelector('[data-doc-composition="minimal_v2"]')).toBeTruthy();
    expect(minimal.container.querySelector('[data-doc-keep="summary"] svg')?.getAttribute('width')).toBe('60');
  });
});
