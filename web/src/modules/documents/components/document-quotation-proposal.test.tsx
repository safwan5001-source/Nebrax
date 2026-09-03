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
  QUOTATION_PROPOSAL_STYLE,
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
import type { DocSectionLayoutItem, DocumentModel, TemplateStyle } from '../types';
import { getDefaultDocumentLayout } from '../registry/document-types';

const locale = { current: 'ar' };

vi.mock('next-intl', () => ({
  useLocale: () => locale.current,
  useTranslations: (namespace: string) => (key: string) => {
    if (namespace === 'documentTypes') {
      if (locale.current === 'ar') return `ع-${key}`;
      return key === 'quotation' ? 'Quotation' : 'Tax Invoice';
    }
    if (namespace === 'documentTypesAlt') {
      if (locale.current === 'ar') return key === 'quotation' ? 'Quotation' : 'Tax Invoice';
      return key === 'quotation' ? 'عرض سعر' : 'فاتورة ضريبية';
    }
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
  { key: 'notes', visible: true },
  { key: 'terms', visible: true },
  { key: 'bank', visible: true },
  { key: 'stamp', visible: true },
  { key: 'signature', visible: true },
  { key: 'footer', visible: true },
];

function quotationModel(overrides: Partial<Parameters<typeof makeDocumentQaModel>[0]> & { dueDate?: string | null } = {}): DocumentModel {
  const { dueDate, ...options } = overrides;
  const model = makeDocumentQaModel({
    documentType: 'quotation',
    scenario: 'five',
    direction: 'rtl',
    showQr: true,
    showAssets: true,
    ...options,
  });
  if (dueDate !== undefined) {
    return { ...model, meta: { ...model.meta, dueDate } };
  }
  return model;
}

function bilingualRoots(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-modern-bilingual="label"]')];
}

function expectIsolatedBilingual(root: Element | null | undefined, ar: string, en: string, context: string) {
  expect(root, context).toBeTruthy();
  expect(root!.querySelector('[dir="rtl"]')?.textContent, `${context}:ar`).toBe(ar);
  expect(root!.querySelector('[dir="ltr"]')?.textContent, `${context}:en`).toBe(en);
  expect(root!.textContent, `${context}:no-pipe`).not.toContain(' | ');
}

function renderComposition(style: TemplateStyle, model: DocumentModel, layout?: DocSectionLayoutItem[] | null, sections?: { qr?: boolean }) {
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

describe('Quotation Proposal visual composition', () => {
  it('يوسم الغلاف بتركيب quotation_proposal لا قوالب الفاتورة', () => {
    const { container } = renderComposition(QUOTATION_PROPOSAL_STYLE, quotationModel(), getDefaultDocumentLayout('quotation'));
    expect(container.querySelector('[data-doc-composition="quotation_proposal"]')).toBeTruthy();
    expect(container.querySelector('[data-doc-composition="classic"]')).toBeNull();
    expect(container.querySelector('[data-doc-keep="summary"]')).toBeTruthy();
  });

  it('لا يرسم مربعاً ملوّناً احتياطياً عند غياب الشعار ولا شريط هوية ولا QR', () => {
    const { container } = renderComposition(
      QUOTATION_PROPOSAL_STYLE,
      quotationModel({ scenario: 'single', showQr: true, showAssets: false }),
      FULL_LAYOUT,
      { qr: true },
    );
    expect(container.querySelector('header .h-14')).toBeNull();
    expect(container.querySelector('header img')).toBeNull();
    expect(container.querySelector('.h-1')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-doc-keep="summary"] svg')).toBeNull();
  });

  it('لا يعرض ZATCA QR حتى لو حُقن في النموذج', () => {
    const model: DocumentModel = {
      ...quotationModel({ showQr: false }),
      qr: { value: 'forced-zatca-payload', note: 'should not render' },
    };
    const { container } = renderComposition(QUOTATION_PROPOSAL_STYLE, model, FULL_LAYOUT, { qr: true });
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).not.toContain('should not render');
    expect(container.textContent).not.toContain('zatca');
  });

  it('يرسم طرفين بلا إطار لكل حقل وبلا بطاقة ميتا ثالثة وبلا بطاقة إجمالي ملوّنة', () => {
    const { container } = renderComposition(QUOTATION_PROPOSAL_STYLE, quotationModel({ showQr: false, showAssets: false }));
    expect(container.querySelectorAll('section.grid.grid-cols-2 > div')).toHaveLength(2);
    expect(container.querySelectorAll('div.grid.grid-cols-3 > div')).toHaveLength(0);
    const totals = container.querySelector('[data-doc-totals="quotation_proposal"]');
    expect(totals?.className).toContain('border-y');
    expect(totals?.className).not.toContain('rounded-lg');
    expect(totals?.className).not.toContain('border-s-2');
  });

  it('يطوي الحقول الاختيارية والملاحظات والبنك والشروط عند الغياب', () => {
    const model: DocumentModel = {
      ...quotationModel({ scenario: 'single', showQr: false, showAssets: false }),
      notes: null,
      terms: null,
      bank: null,
      stampUrl: null,
      signatureUrl: null,
      buyer: { name: 'عميل بلا حقول' },
      meta: { number: 'Q-1', date: '2026-08-26', dueDate: null, paymentType: null },
    };
    const { container } = renderComposition(QUOTATION_PROPOSAL_STYLE, model, FULL_LAYOUT);
    expect(container.querySelector('img[alt="stamp"]')).toBeNull();
    expect(container.querySelector('img[alt="signature"]')).toBeNull();
    expect(container.textContent).toContain('عميل بلا حقول');
  });

  it('يعرض تاريخ الصلاحية عند وجوده ويطويه عند غيابه', () => {
    const withDue = renderComposition(QUOTATION_PROPOSAL_STYLE, quotationModel({ dueDate: '2026-09-25' }));
    expect(withDue.container.querySelector('header')?.textContent).toContain('2026-09-25');
    withDue.unmount();

    const withoutDue = renderComposition(QUOTATION_PROPOSAL_STYLE, quotationModel({ dueDate: null }));
    expect(withoutDue.container.querySelector('header')?.textContent).not.toContain('2026-09-25');
  });

  it('يغطي سيناريوهات 1 و5 و20 ووصف طويل', () => {
    for (const scenario of ['single', 'five', 'twenty', 'long_content'] as const) {
      const model = quotationModel({ scenario, showQr: true, showAssets: true });
      const { container, unmount } = renderComposition(QUOTATION_PROPOSAL_STYLE, model);
      expect(container.querySelectorAll('tbody tr')).toHaveLength(model.lines.length);
      expect(container.querySelector('[data-doc-composition="quotation_proposal"]')).toBeTruthy();
      unmount();
    }
  });

  it('يحترم الأعمدة القابلة للضبط', () => {
    const layout: DocSectionLayoutItem[] = [
      { key: 'header', visible: true },
      { key: 'items', visible: true, properties: { columns: [{ id: 'description' }, { id: 'total' }] } },
      { key: 'summary', visible: true },
      { key: 'footer', visible: true },
    ];
    const { container } = renderComposition(QUOTATION_PROPOSAL_STYLE, quotationModel({ scenario: 'single' }), layout);
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers.length).toBe(2);
    expect(container.querySelectorAll('tbody td')).toHaveLength(2);
  });

  it('يخفي صف الضريبة عند الصفر ويعرض الخصم من النموذج دون إعادة حساب', () => {
    const model: DocumentModel = {
      ...quotationModel({ scenario: 'single', showQr: false, showAssets: false }),
      totals: { subtotal: 10_000, discount: 1_000, tax: 0, total: 9_000 },
    };
    const { container } = renderComposition(QUOTATION_PROPOSAL_STYLE, model);
    const totals = container.querySelector('[data-doc-totals="quotation_proposal"]');
    expect(totals?.textContent).toContain('100.00');
    expect(totals?.textContent).toContain('10.00');
    expect(totals?.textContent).toContain('90.00');
    expect(totals?.textContent).not.toContain(modernTotalLabel('vat', 'ar'));
  });

  it('يعرض المبالغ رقمياً ووحدة ريال في الرأس عربياً', () => {
    const { container } = renderComposition(QUOTATION_PROPOSAL_STYLE, quotationModel({ showQr: false, showAssets: false }));
    expect(container.querySelector('thead')?.textContent).toContain('ريال');
    expect(container.querySelector('tbody')?.textContent).not.toContain('ريال');
    expect(container.querySelector('[data-doc-totals="quotation_proposal"]')?.textContent).toContain('ريال');
  });

  it('يعزل التسميات الثنائية دون فاصل نصي ودون تكرار الأرقام', () => {
    locale.current = 'en';
    const { container } = renderComposition(QUOTATION_PROPOSAL_STYLE, quotationModel({ showQr: false, showAssets: false }));
    expectIsolatedBilingual(
      container.querySelector('h1 [data-modern-bilingual="label"]'),
      'عرض سعر',
      'Quotation',
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
      QUOTATION_PROPOSAL_STYLE,
      quotationModel({ showQr: false, showAssets: false }),
    );
    expect(arabic.container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(arabic.container.querySelector('thead')?.textContent).toContain(modernColumnLabel('product', 'ar'));
    expect(arabic.container.querySelector('h1')?.textContent).toContain('ع-quotation');
    arabic.unmount();

    locale.current = 'en';
    const english = renderComposition(
      QUOTATION_PROPOSAL_STYLE,
      quotationModel({ direction: 'ltr', showQr: false, showAssets: false }),
    );
    expect(english.container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(english.container.querySelector('thead')?.textContent).toContain(modernColumnLabel('product', 'en'));
    expect(english.container.querySelector('h1')?.textContent).toContain('Quotation');
  });

  it('لا يغيّر تركيب Classic التاريخي: ثلاث بطاقات وشريط هوية وQR 110', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(CLASSIC_STYLE, model);
    expect(container.querySelector('[data-doc-composition="classic"]')).toBeTruthy();
    expect(container.querySelector('[data-doc-composition="quotation_proposal"]')).toBeNull();
    expect(container.querySelectorAll('div.grid.grid-cols-3 > div')).toHaveLength(3);
    expect(container.querySelector('.h-1')).toBeTruthy();
    expect(container.querySelector('svg[width]')?.getAttribute('width')).toBe('110');
  });

  it('لا يغيّر تركيب Retail التاريخي', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(RETAIL_STYLE, model);
    expect(container.querySelector('[data-doc-composition="retail"]')).toBeTruthy();
    expect(container.querySelectorAll('div.grid.grid-cols-3 > div')).toHaveLength(3);
    expect(container.querySelector('.h-1')).toBeTruthy();
  });

  it('يبقي Modern V2 وERP V2 وClassic V2 وMinimal V2 وRetail V2 كما هي', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: true, showAssets: false });
    for (const [style, composition] of [
      [MODERN_V2_STYLE, 'modern_v2'],
      [ERP_V2_STYLE, 'erp_v2'],
      [CLASSIC_V2_STYLE, 'classic_v2'],
      [MINIMAL_V2_STYLE, 'minimal_v2'],
      [RETAIL_V2_STYLE, 'retail_v2'],
    ] as const) {
      const { container, unmount } = renderComposition(style, model);
      expect(container.querySelector(`[data-doc-composition="${composition}"]`)).toBeTruthy();
      expect(container.querySelector('[data-doc-composition="quotation_proposal"]')).toBeNull();
      expect(container.querySelector('[data-doc-keep="summary"] svg')).toBeTruthy();
      unmount();
    }
  });
});
