// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { renderIntl } from '@/test-utils/intl';
import { normalizeOutputProfile, type OutputProfile } from '@/modules/print-templates/services/output-profile';
import { PaymentDocument } from './payment-document';
import { PurchaseDocument } from '../purchases/purchase-document';

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

function profile(input: Record<string, unknown>): OutputProfile {
  const result = normalizeOutputProfile(input);
  if (!result.ok) throw new Error(result.reason);
  return result.profile;
}

const payment = {
  number: 'RCV-1', payment_date: '2026-08-26', direction: 'received', method: 'bank', amount: '148148146.80', reference: 'REF-1', notes: null,
  allocations: [{ label: 'INV-1', amount: '24691357.80' }],
};
const purchase = {
  number: 'PUR-1', purchase_date: '2026-08-26', payment_type: 'credit', subtotal: '1250.00', tax_amount: '187.50', total: '1437.50',
  lines: [{ id: 'l1', description: 'صنف', quantity: 1, unit_price: '1250.00', line_tax: '187.50', line_total: '1437.50' }],
};

const signatureImages = (container: HTMLElement) => [...container.querySelectorAll('img')].filter((img) => (img.getAttribute('src') ?? '').includes('width="20"') || (img.getAttribute('src') ?? '').includes('width%3D%2220%22')).length;

describe('PaymentDocument / PurchaseDocument تمرّر ملف الإخراج للعارض (AWJ-DOC-V2-PR4)', () => {
  it('السند: بلا ملف = لا ورقة؛ وبملف مدعوم = ورقة بمقاس الملف والجذر الافتراضي', () => {
    const none = renderIntl(<PaymentDocument payment={payment} company={null} partner={null} templateId="tax-invoice-classic-v2" />, 'ar');
    expect(none.container.querySelector('[data-doc-sheet]')).toBeNull();
    cleanup();

    const withProfile = renderIntl(
      <PaymentDocument payment={payment} company={null} partner={null} templateId="tax-invoice-classic-v2" outputProfile={profile({ paper: 'a5', orientation: 'landscape' })} />,
      'ar',
    );
    const sheet = withProfile.container.querySelector<HTMLElement>('[data-doc-sheet]');
    expect(sheet?.getAttribute('data-doc-sheet-paper')).toBe('210x148');
    expect(withProfile.container.querySelector('#print-root')).not.toBeNull();
  });

  it('السند: ملف لا يدعمه القالب (A6 عمودي على classic) يُعامل كغائب', () => {
    const { container } = renderIntl(
      <PaymentDocument payment={payment} company={null} partner={null} templateId="tax-invoice-classic" outputProfile={profile({ paper: 'a6' })} />,
      'ar',
    );
    expect(container.querySelector('[data-doc-sheet]')).toBeNull();
  });

  it('السند: جذر PDF المستقل (pdf-print-root) يُخفى غلاف ورقته كله', () => {
    const { container } = renderIntl(
      <PaymentDocument payment={payment} company={null} partner={null} templateId="tax-invoice-classic-v2" rootId="pdf-print-root" outputProfile={profile({ paper: 'a5', orientation: 'landscape' })} />,
      'ar',
    );
    const sheet = container.querySelector<HTMLElement>('[data-doc-sheet]');
    expect(sheet?.classList.contains('hidden')).toBe(true);
    expect(container.querySelector('#pdf-print-root')).not.toBeNull();
  });

  it('السند: تخطيط صريح يُحترم (بنك ظاهر وتوقيع مخفي)، وغيابه = تخطيط السند الثابت (توقيع وختم)', () => {
    const assets = { stampUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="10" height="10"%3E%3C/svg%3E', signatureUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="10"%3E%3C/svg%3E' };
    const base = { payment, company: null, partner: null, templateId: 'tax-invoice-classic-v2', bank: 'IBAN SA0000000000000000000000', ...assets };
    const fixed = renderIntl(<PaymentDocument {...base} />, 'en');
    expect(signatureImages(fixed.container)).toBeGreaterThan(0);
    expect(fixed.container.textContent).not.toContain('IBAN SA0000000000000000000000');
    cleanup();

    const layout = [
      { key: 'header', visible: true }, { key: 'parties', visible: true }, { key: 'voucher', visible: true },
      { key: 'bank', visible: true }, { key: 'signature', visible: false }, { key: 'stamp', visible: false }, { key: 'footer', visible: true },
    ] as const;
    const custom = renderIntl(<PaymentDocument {...base} layout={[...layout]} />, 'en');
    expect(custom.container.textContent).toContain('IBAN SA0000000000000000000000');
    expect(signatureImages(custom.container)).toBe(0);
  });

  it('السند: الحالة تُمرَّر لإشعار الترويسة (مسودة/ملغى) عند طلبها فقط، وغيابها = كما كان', () => {
    const base = { payment, company: null, partner: null, templateId: 'tax-invoice-classic-v2' } as const;
    const plain = renderIntl(<PaymentDocument {...base} />, 'ar');
    expect(plain.container.querySelector('[data-doc-status-notice]')).toBeNull();
    cleanup();
    const draft = renderIntl(<PaymentDocument {...base} status="draft" />, 'ar');
    expect(draft.container.querySelector('[data-doc-status-notice="draft"]')).not.toBeNull();
    cleanup();
    const posted = renderIntl(<PaymentDocument {...base} status="posted" />, 'ar');
    expect(posted.container.querySelector('[data-doc-status-notice]'), 'المرحَّل بلا إشعار').toBeNull();
  });

  it('المشتريات: بلا ملف = لا ورقة؛ وبملف مدعوم = ورقة؛ والمبالغ كما هي', () => {
    const none = renderIntl(<PurchaseDocument purchase={purchase} company={null} supplier={null} templateId="tax-invoice-classic-v2" />, 'ar');
    expect(none.container.querySelector('[data-doc-sheet]')).toBeNull();
    const plain = none.container.querySelector('#print-root')?.textContent ?? '';
    cleanup();

    const withProfile = renderIntl(
      <PurchaseDocument purchase={purchase} company={null} supplier={null} templateId="tax-invoice-classic-v2" outputProfile={profile({ paper: 'a5', orientation: 'landscape' })} />,
      'ar',
    );
    expect(withProfile.container.querySelector('[data-doc-sheet]')?.getAttribute('data-doc-sheet-paper')).toBe('210x148');
    const framed = withProfile.container.querySelector('#print-root')?.textContent ?? '';
    for (const amount of ['1,250.00', '187.50', '1,437.50']) {
      expect(plain.replace(/[\s٬،,]/g, '')).toContain(amount.replace(/,/g, ''));
      expect(framed.replace(/[\s٬،,]/g, '')).toContain(amount.replace(/,/g, ''));
    }
  });
});
