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
