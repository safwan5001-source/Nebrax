// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { renderIntl } from '@/test-utils/intl';
import { normalizeOutputProfile, type OutputProfile } from '@/modules/print-templates/services/output-profile';
import { makeDocumentQaModel } from '../qa/document-qa-fixtures';
import { getDefaultDocumentLayout } from '../registry/document-types';
import { DocumentView } from './document-view';

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

function profile(input: Record<string, unknown>): OutputProfile {
  const result = normalizeOutputProfile(input);
  if (!result.ok) throw new Error(result.reason);
  return result.profile;
}

function render(templateId: string, outputProfile: OutputProfile | null, documentType: 'tax_invoice' | 'quotation' = 'tax_invoice', rootId = 'frame-root') {
  const model = makeDocumentQaModel({ documentType, scenario: 'three', direction: 'rtl', showQr: true, showAssets: false });
  const utils = renderIntl(
    <DocumentView model={model} templateId={templateId} layout={getDefaultDocumentLayout(documentType)} rootId={rootId} outputProfile={outputProfile} />,
    'ar',
  );
  const root = utils.container.querySelector<HTMLElement>(`#${rootId}`)!;
  return {
    root,
    sheet: utils.container.querySelector<HTMLElement>('[data-doc-sheet]'),
    headers: root.querySelectorAll('thead th').length,
  };
}

describe('DocumentView + Output Profile — إطار الصفحة (AWJ-DOC-V2-PR3B)', () => {
  it('بلا ملف: DOM الجذر كما كان — أصناف 210mm الثابتة ولا ورقة ولا إطار ضيّق', () => {
    const { root, sheet, headers } = render('tax-invoice-classic-v2', null);
    expect(sheet).toBeNull();
    expect(root.className).toContain('w-[210mm]');
    expect(root.className).toContain('max-w-[210mm]');
    expect(root.className).toContain('min-h-[277mm]');
    expect(root.style.width).toBe('');
    expect(root.hasAttribute('data-doc-narrow')).toBe(false);
    expect(headers).toBe(10);
  });

  it('A5 عمودي (classic-v2): الورقة 148mm، الجذر 128mm، إطار ضيّق تُخفى فيه أعمدة التعريف فقط', () => {
    const { root, sheet, headers } = render('tax-invoice-classic-v2', profile({ paper: 'a5' }));
    expect(sheet?.style.width).toBe('148mm');
    expect(sheet?.style.padding).toBe('10mm');
    expect(root.style.width).toBe('128mm');
    expect(root.style.maxWidth).toBe('128mm');
    expect(root.style.minHeight).toBe('190mm');
    expect(root.className).not.toContain('w-[210mm]');
    expect(root.hasAttribute('data-doc-narrow')).toBe(true);
    expect(headers).toBe(7); // 10 − (#، رمز المنتج، الباركود)
  });

  it('الأعمدة المالية والضريبية تبقى كلها في الإطار الضيّق', () => {
    const { root } = render('tax-invoice-classic-v2', profile({ paper: 'a5' }));
    const text = root.querySelector('thead')!.textContent ?? '';
    for (const label of ['الكمية', 'الضريبة', 'الإجمالي']) expect(text).toContain(label);
    expect(text).not.toContain('الباركود');
  });

  it('A4 أفقي: ورقة 297mm ومحتوى 269mm بتدفّق كامل (ليس ضيّقاً)', () => {
    const { root, sheet, headers } = render('tax-invoice-classic-v2', profile({ paper: 'a4', orientation: 'landscape' }));
    expect(sheet?.style.width).toBe('297mm');
    expect(root.style.width).toBe('269mm');
    expect(root.hasAttribute('data-doc-narrow')).toBe(false);
    expect(headers).toBe(10);
  });

  it('ملف لا يدعمه القالب (A6 عمودي) يُعامل كغائب: لا ورقة ولا تغيير', () => {
    const { root, sheet, headers } = render('tax-invoice-classic-v2', profile({ paper: 'a6' }));
    expect(sheet).toBeNull();
    expect(root.className).toContain('w-[210mm]');
    expect(headers).toBe(10);
  });

  it('هوامش تضيّق المحتوى عن حدّ القالب تُعامل كغائبة', () => {
    const { sheet } = render('tax-invoice-classic', profile({ paper: 'a4', margins_mm: { top: 20, right: 20, bottom: 20, left: 20 } }));
    expect(sheet).toBeNull();
  });

  it('الورقة المعاينة لا تُطبع ولا تتموضع: حدّ الهوامش no-print والغلاف print:static', () => {
    const { sheet } = render('tax-invoice-classic', profile({ paper: 'a4' }));
    expect(sheet?.className).toContain('print:static');
    expect(sheet?.className).toContain('print:shadow-none');
    const guide = sheet?.querySelector('[data-doc-sheet-guide]');
    expect(guide?.className).toContain('no-print');
    expect(guide?.getAttribute('aria-hidden')).toBe('true');
  });

  it('جذر PDF المستقل المخفي: غلاف الورقة يُخفى كله (لا حشو ولا ظل ولا عرض ورقي على الشاشة)، والجذر الظاهر لا يُخفى', () => {
    const hiddenRoot = render('tax-invoice-classic', profile({ paper: 'a4' }), 'tax_invoice', 'pdf-print-root');
    expect(hiddenRoot.sheet?.classList.contains('hidden')).toBe(true);
    expect(hiddenRoot.sheet?.getAttribute('data-doc-sheet-hidden')).toBe('true');
    expect(hiddenRoot.sheet?.contains(hiddenRoot.root)).toBe(true);

    const visibleRoot = render('tax-invoice-classic', profile({ paper: 'a4' }));
    expect(visibleRoot.sheet?.classList.contains('hidden')).toBe(false);
    expect(visibleRoot.sheet?.hasAttribute('data-doc-sheet-hidden')).toBe(false);
  });

  it('جذر الطباعة/PDF خارج الورقة المعاينة: الجذر داخل الورقة ولا يحمل حدّها (لا تُلتقط الإرشادات)', () => {
    const { root, sheet } = render('tax-invoice-classic', profile({ paper: 'a4' }));
    expect(sheet?.contains(root)).toBe(true);
    expect(root.querySelector('[data-doc-sheet-guide]')).toBeNull();
  });

  it('الحراري: الملف المطابق لا يُنشئ ورقة صفحات (رول بتخطيطه الخاص)', () => {
    const { sheet } = render('tax-invoice-thermal80', profile({ paper: 'thermal_80' }));
    expect(sheet).toBeNull();
  });

  it('عرض سعر (quotation-proposal) على A5 أفقي: ورقة 210mm ومحتوى 190mm', () => {
    const { root, sheet } = render('quotation-proposal', profile({ paper: 'a5', orientation: 'landscape' }), 'quotation');
    expect(sheet?.style.width).toBe('210mm');
    expect(root.style.width).toBe('190mm');
  });
});
