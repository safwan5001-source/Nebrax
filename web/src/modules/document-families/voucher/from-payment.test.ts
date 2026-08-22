import { describe, expect, it } from 'vitest';
import type { SourceCompany, SourceCustomer } from '@/modules/documents/builder/from-invoice';
import type { SourcePayment } from '@/modules/documents/builder/from-payment';
import { buildVoucherDocument } from './from-payment';
import { voucherDocumentToLegacyModel } from './to-legacy-document-model';

const company: SourceCompany = {
  name: 'شركة نبراس التجريبية',
  vat_number: '310122334400003',
  cr_number: '1010123456',
};

const partner: SourceCustomer = {
  name: 'شركة الندى',
  vat_number: '310000000000003',
  city: 'الدمام',
};

const payment: SourcePayment = {
  number: 'RV-00041',
  payment_date: '2026-08-22',
  direction: 'received',
  method: 'تحويل بنكي',
  amount: '1,725.00',
  reference: 'TX-441',
  notes: 'تسوية فاتورة أغسطس',
  allocations: [{ label: 'INV-1002', amount: '1,725.00' }],
};

describe('Voucher family builder', () => {
  it('builds a voucher contract without invoice line-item fields', () => {
    const document = buildVoucherDocument({ payment, company, partner, footerText: 'شكراً لتعاملكم معنا' });

    expect(document.family).toBe('voucher');
    expect(document.type).toBe('receipt_voucher');
    expect(document.voucher.amount).toBe(172500);
    expect(document.voucher.allocations).toEqual([{ label: 'INV-1002', amount: 172500 }]);
    expect('lines' in document).toBe(false);
    expect('totals' in document).toBe(false);
    expect(document.content.notes).toBe('تسوية فاتورة أغسطس');
  });

  it('uses the compatibility adapter as the only boundary that supplies legacy line-item fields', () => {
    const document = buildVoucherDocument({ payment, company, partner });
    const legacy = voucherDocumentToLegacyModel(document);

    expect(legacy.lines).toEqual([]);
    expect(legacy.totals).toEqual({ subtotal: 172500, tax: 0, total: 172500 });
    expect(legacy.voucher).toEqual(document.voucher);
  });

  it('maps a paid source to the payment-voucher kind without changing the amount', () => {
    const document = buildVoucherDocument({
      payment: { ...payment, direction: 'paid', amount: '20.00' },
      company,
      partner,
    });

    expect(document.type).toBe('payment_voucher');
    expect(document.voucher.direction).toBe('paid');
    expect(document.voucher.amount).toBe(2000);
  });
});
