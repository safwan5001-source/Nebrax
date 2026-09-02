// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentBody } from './document-body';
import { MODERN_STYLE, MODERN_V2_STYLE } from '../templates/template-styles';
import { makeDocumentQaModel } from '../qa/document-qa-fixtures';
import { getTheme } from '../themes';
import type { DocumentModel, TemplateStyle } from '../types';

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

const FULL_LAYOUT = [
  { key: 'header', visible: true },
  { key: 'parties', visible: true },
  { key: 'items', visible: true },
  { key: 'summary', visible: true },
  { key: 'notes', visible: true },
  { key: 'terms', visible: true },
  { key: 'bank', visible: true },
  { key: 'footer', visible: true },
] as const;

function renderComposition(style: TemplateStyle, model: DocumentModel) {
  return render(
    <DocumentBody
      model={model}
      theme={theme}
      formatMoney={formatMoney}
      style={style}
      layout={[...FULL_LAYOUT]}
      rootId="qa-print-root"
    />,
  );
}

afterEach(() => {
  cleanup();
  locale.current = 'ar';
});

describe('Modern التاريخي (ما قبل #616)', () => {
  it('يوسم الغلاف بتركيب modern لا modern_v2', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: true });
    const { container } = renderComposition(MODERN_STYLE, model);
    expect(container.querySelector('[data-doc-composition="modern"]')).toBeTruthy();
    expect(container.querySelector('[data-doc-composition="modern_v2"]')).toBeNull();
    expect(container.querySelector('[data-doc-keep="summary"]')).toBeNull();
  });

  it('يرسم مربعاً ملوّناً احتياطياً عند غياب الشعار', () => {
    const model = makeDocumentQaModel({ scenario: 'single', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model);
    expect(container.querySelector('header .h-14')).toBeTruthy();
    expect(container.querySelector('header img')).toBeNull();
  });

  it('يبقي ثلاث بطاقات أطراف وشريط هوية جانبي في الرأس', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model);
    expect(container.querySelectorAll('section.grid.grid-cols-12.gap-3 > div')).toHaveLength(3);
    expect(container.querySelector('header [class*="border-s-2"]')).toBeTruthy();
    expect(container.querySelector('[data-doc-totals="modern"]')?.className).toContain('rounded-md');
  });

  it('يرسم QR التاريخي 110px داخل شبكة الملخص لا flex V2', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model);
    const qr = container.querySelector('svg');
    expect(qr?.getAttribute('width')).toBe('110');
    const summary = container.querySelector('section.grid.grid-cols-12.items-end');
    expect(summary?.querySelector('.col-start-8')).toBeTruthy();
    expect(summary?.className).not.toContain('justify-between');
  });

  it('لا يرسم تسميات V2 الثنائية حتى مع locale=en واتجاه RTL', () => {
    locale.current = 'en';
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: false, showAssets: false });
    const { container } = renderComposition(MODERN_STYLE, model);
    expect(container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Tax Invoice');
    expect(container.textContent).not.toContain(' | ');
  });

  it('لا يخلط تركيب V2 المعتمد مع التاريخي على نفس النموذج', () => {
    const model = makeDocumentQaModel({ scenario: 'five', direction: 'rtl', showQr: true, showAssets: false });
    const legacy = renderComposition(MODERN_STYLE, model);
    const v2 = renderComposition(MODERN_V2_STYLE, model);
    expect(legacy.container.querySelector('[data-doc-composition="modern"]')).toBeTruthy();
    expect(v2.container.querySelector('[data-doc-composition="modern_v2"]')).toBeTruthy();
    expect(legacy.container.querySelector('[data-modern-bilingual]')).toBeNull();
    expect(v2.container.querySelector('[data-doc-keep="summary"]')).toBeTruthy();
    legacy.unmount();
    v2.unmount();
  });
});
