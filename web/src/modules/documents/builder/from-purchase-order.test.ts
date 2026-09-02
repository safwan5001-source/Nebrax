import { describe, expect, it } from 'vitest';
import { buildPurchaseOrderDocumentModel } from './from-purchase-order';

describe('buildPurchaseOrderDocumentModel', () => {
  it('preserves the commercial purchase-order type and normalizes its frozen output data', () => {
    const model = buildPurchaseOrderDocumentModel({
      order: {
        number: 'PO-2026-00001',
        doc_date: '2026-08-18',
        due_date: '2026-08-28',
        subtotal: '1000.00',
        tax_amount: '150.00',
        total: '1150.00',
        notes: 'توريد مواد تشغيل',
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
      footerText: 'تذييل مثبت',
      terms: 'شروط مثبتة',
      bank: 'بيانات بنك مثبتة',
      stampUrl: 'https://assets.example/stamp.png',
      signatureUrl: 'https://assets.example/signature.png',
    });

    expect(model.type).toBe('purchase_order');
    expect(model.meta).toEqual({
      number: 'PO-2026-00001',
      date: '2026-08-18',
      dueDate: '2026-08-28',
      paymentType: null,
    });
    expect(model.totals).toEqual({ subtotal: 100000, tax: 15000, total: 115000 });
    expect(model.lines[0]).toMatchObject({ unitPrice: 50000, tax: 7500, total: 57500 });
    expect(model).toMatchObject({
      footerText: 'تذييل مثبت',
      terms: 'شروط مثبتة',
      bank: 'بيانات بنك مثبتة',
      stampUrl: 'https://assets.example/stamp.png',
      signatureUrl: 'https://assets.example/signature.png',
    });
    expect(model.currency).toBe('SAR');
    expect(model.direction).toBe('rtl');
  });

  it('uses the company currency and explicit document direction', () => {
    const model = buildPurchaseOrderDocumentModel({
      order: {
        number: 'PO-USD-1',
        doc_date: '2026-09-02',
        due_date: null,
        subtotal: '10.00',
        tax_amount: '1.50',
        total: '11.50',
        lines: [],
      },
      company: { name: 'AWJ Trading', currency: 'USD' },
      supplier: { name: 'Supplier' },
      direction: 'ltr',
    });
    expect(model.currency).toBe('USD');
    expect(model.direction).toBe('ltr');
  });
});
