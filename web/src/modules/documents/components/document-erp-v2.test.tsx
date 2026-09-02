// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentBody } from './document-body';
import { ERP_STYLE, ERP_V2_STYLE, MODERN_V2_STYLE } from '../templates/template-styles';
import { makeDocumentQaModel } from '../qa/document-qa-fixtures';
import { getTheme } from '../themes';
import {
  MODERN_COLUMN_LABELS,
  isModernMoneyColumn,
  modernColumnLabel,
  modernTotalLabel,
} from '../presentation/visual-v2';
import { ERP_V2 } from '../presentation/erp-v2';
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

const theme = getTheme('gray');
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

function bilingualRoots(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-modern-bilingual="label"]')];
}

function expectIsolatedBilingual(root: Element | null | undefined, ar: string, en: string, context: string) {
  expect(root, context).toBeTruthy();
  expect(root!.querySelector('[dir="rtl"]')?.textContent, `${context}:ar`).toBe(ar);
  expect(root!.querySelector('[dir="ltr"]')?.textContent, `${context}:en`).toBe(en);
  expect(root!.textContent, `${context}:no-pipe`).not.toContain(' | ');
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

describe('ERP V2 visual composition', () => {
  it('يوسم الغلاف بتركيب erp_v2 لا erp التاريخي', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: true });
    const { container } = renderComposition(ERP_V2_STYLE, model);
    expect(container.querySelector('[data-doc-composition="erp_v2"]')).toBeTruthy();
    expect(container.querySelector('[data-doc-composition="erp"]')).toBeNull();
    expect(container.querySelector('[data-doc-keep="summary"]')).toBeTruthy();
  });

  it('لا يرسم مربعاً ملوّناً احتياطياً عند غياب الشعار', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(ERP_V2_STYLE, model);
    expect(container.querySelector('header .h-14')).toBeNull();
    expect(container.querySelector('header img')).toBeNull();
  });

  it('يرسم طرفين بحدود سوداء بلا عمود ميتا ثالث', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(ERP_V2_STYLE, model);
    expect(container.querySelectorAll('section.grid.grid-cols-2 > div')).toHaveLength(2);
    expect(container.querySelectorAll('section.grid.grid-cols-12 > div')).toHaveLength(0);
    expect(container.querySelector('[data-doc-totals="erp_v2"]')?.className).toContain('border-s-2');
    expect(container.querySelector('[data-doc-totals="erp_v2"]')?.className).not.toContain('rounded-md');
  });

  it('يرسم QR مضغوطاً بجانب الملخص', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(ERP_V2_STYLE, model);
    const qr = container.querySelector('[data-doc-keep="summary"] svg');
    expect(qr?.getAttribute('width')).toBe(String(ERP_V2.qrSizePx));
    expect(container.querySelector('header svg')).toBeNull();
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
    const { container } = renderComposition(ERP_V2_STYLE, model, FULL_LAYOUT);
    expect(container.querySelector('img[alt="stamp"]')).toBeNull();
    expect(container.querySelector('img[alt="signature"]')).toBeNull();
  });

  it('يغطي سيناريوهات 1 و5 و20 بنداً', () => {
    for (const scenario of ['single', 'five', 'twenty'] as const) {
      const model = makeDocumentQaModel({ scenario, direction: 'rtl', showQr: true, showAssets: true });
      const { container, unmount } = renderComposition(ERP_V2_STYLE, model);
      expect(container.querySelectorAll('tbody tr')).toHaveLength(model.lines.length);
      expect(container.querySelector('[data-doc-composition="erp_v2"]')).toBeTruthy();
      unmount();
    }
  });

  it('يعرض المبالغ رقمياً ووحدة ريال في الرأس عربياً', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(ERP_V2_STYLE, model);
    expect(container.querySelector('thead')?.textContent).toContain('ريال');
    expect(container.querySelector('tbody')?.textContent).not.toContain('ريال');
    expect(container.querySelector('[data-doc-totals="erp_v2"]')?.textContent).toContain('ريال');
  });

  it('يعزل التسميات الثنائية دون فاصل نصي', () => {
    locale.current = 'en';
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(ERP_V2_STYLE, model);
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
      ERP_V2_STYLE,
      makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false }),
    );
    expect(arabic.container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(arabic.container.querySelector('thead')?.textContent).toContain(modernColumnLabel('product', 'ar'));
    expect(arabic.container.querySelector('[data-doc-totals="erp_v2"]')?.textContent).toContain(modernTotalLabel('subtotal', 'ar'));
    arabic.unmount();

    locale.current = 'en';
    const english = renderComposition(
      ERP_V2_STYLE,
      makeDocumentQaModel({ scenario: 'five', direction: 'ltr', showQr: false, showAssets: false }),
    );
    expect(english.container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(english.container.querySelector('thead')?.textContent).toContain(modernColumnLabel('product', 'en'));
    expect(english.container.querySelector('[data-doc-totals="erp_v2"]')?.textContent).toContain(modernTotalLabel('grand_total', 'en'));
  });

  it('لا يغيّر تركيب ERP التاريخي: شريط هوية ومربع شعار وثلاث مناطق', () => {
    locale.current = 'en';
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(ERP_STYLE, model);
    expect(container.querySelector('[data-doc-composition="erp"]')).toBeTruthy();
    expect(container.querySelector('[data-doc-composition="erp_v2"]')).toBeNull();
    expect(container.querySelector('header .h-14')).toBeTruthy();
    expect(container.querySelector('header .h-1')).toBeTruthy();
    expect(container.querySelectorAll('section.grid.grid-cols-12 > div')).toHaveLength(3);
    expect(container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect([...container.querySelectorAll('td')].some((td) => td.className.includes('doc-brand-soft'))).toBe(true);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('110');
  });

  it('لا يحوّل Modern V2 إلى تركيب ERP', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(MODERN_V2_STYLE, model);
    expect(container.querySelector('[data-doc-composition="modern_v2"]')).toBeTruthy();
    expect(container.querySelector('[data-doc-composition="erp_v2"]')).toBeNull();
    expect(container.querySelector('[data-doc-keep="summary"] svg')?.getAttribute('width')).toBe('76');
  });
});
