import { describe, expect, it } from 'vitest';
import { buildPurchaseDocumentModel } from './from-purchase';

describe('buildPurchaseDocumentModel', () => {
  it('preserves the purchase document type and every head adjustment in minor units', () => {
    const model = buildPurchaseDocumentModel({
      purchase: {
        number: 'BILL-2026-00001',
        purchase_date: '2026-08-17',
        due_date: '2026-09-16',
        payment_type: 'credit',
        subtotal: '1000.00',
        discount: '20.00',
        shipping: '10.00',
        adjustment: '-0.50',
        tax_amount: '148.50',
        total: '1138.00',
        notes: 'توريد مرحّل',
        lines: [{
          id: 'line-1',
          description: 'مواد تشغيل',
          quantity: 2,
          unit_price: '500.00',
          line_tax: '75.00',
          line_total: '575.00',
        }],
      },
      company: { name: 'شركة نبراكس', vat_number: '300000000000003' },
      supplier: { name: 'مورد تجريبي', city: 'الدمام' },
      footerText: 'لقطة حرارية مثبتة',
    });

    expect(model.type).toBe('purchase_invoice');
    expect(model.meta).toEqual({
      number: 'BILL-2026-00001',
      date: '2026-08-17',
      dueDate: '2026-09-16',
      paymentType: 'credit',
    });
    expect(model.totals).toEqual({
      subtotal: 100000,
      discount: 2000,
      shipping: 1000,
      adjustment: -50,
      tax: 14850,
      total: 113800,
    });
    expect(model.lines[0]).toMatchObject({ unitPrice: 50000, tax: 7500, total: 57500 });
    expect(model.footerText).toBe('لقطة حرارية مثبتة');
  });
});
