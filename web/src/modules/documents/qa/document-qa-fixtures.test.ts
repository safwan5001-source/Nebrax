import { describe, expect, it } from 'vitest';
import { makeDocumentQaModel } from './document-qa-fixtures';

describe('نماذج تحقق المستندات', () => {
  it('تنشئ سيناريوهات أحجام البنود المطلوبة مع إجماليات مستمدة من البنود', () => {
    const expectations = { single: 1, five: 5, twenty: 20, multipage: 40, long_content: 5 } as const;
    for (const [scenario, count] of Object.entries(expectations) as Array<[keyof typeof expectations, number]>) {
      const model = makeDocumentQaModel({ scenario, direction: 'rtl', showQr: true, showAssets: true });
      expect(model.lines).toHaveLength(count);
      expect(model.totals.subtotal).toBe(model.lines.reduce((sum, line) => sum + (line.priceBeforeTax ?? 0), 0));
      expect(model.totals.tax).toBe(model.lines.reduce((sum, line) => sum + line.tax, 0));
    }
  });

  it('يميز نماذج الأنواع التجارية ويخفي QR للمستندات غير الضريبية', () => {
    const quotation = makeDocumentQaModel({ documentType: 'quotation', scenario: 'single', direction: 'rtl', showQr: true, showAssets: true });
    const salesOrder = makeDocumentQaModel({ documentType: 'sales_order', scenario: 'single', direction: 'rtl', showQr: true, showAssets: true });
    const purchaseOrder = makeDocumentQaModel({ documentType: 'purchase_order', scenario: 'single', direction: 'rtl', showQr: true, showAssets: true });
    const purchaseInvoice = makeDocumentQaModel({ documentType: 'purchase_invoice', scenario: 'single', direction: 'rtl', showQr: true, showAssets: true });
    const deliveryNote = makeDocumentQaModel({ documentType: 'delivery_note', scenario: 'single', direction: 'rtl', showQr: true, showAssets: true });

    expect(quotation.meta).toMatchObject({ dueDate: '2026-09-25', paymentType: null });
    expect(salesOrder.meta).toMatchObject({ dueDate: '2026-09-30', paymentType: null });
    expect(purchaseOrder.buyer.name).toContain('توريد');
    expect(purchaseInvoice.meta.paymentType).toBe('credit');
    expect(deliveryNote.meta).toMatchObject({ dueDate: null, paymentType: null });
    for (const model of [quotation, salesOrder, purchaseOrder, purchaseInvoice, deliveryNote]) expect(model.qr).toBeNull();
  });

  it('يغطي الحقول الطويلة والأصول والاتجاهين بلا اتصال ببيانات أعمال', () => {
    const arabic = makeDocumentQaModel({ scenario: 'multipage', direction: 'rtl', showQr: true, showAssets: true });
    const english = makeDocumentQaModel({ scenario: 'multipage', direction: 'ltr', showQr: false, showAssets: false });
    const longContent = makeDocumentQaModel({ scenario: 'long_content', direction: 'rtl', showQr: true, showAssets: true });

    expect(arabic.seller.name.length).toBeGreaterThan(50);
    expect(arabic.buyer.name.length).toBeGreaterThan(50);
    expect(arabic.notes?.length).toBeGreaterThan(500);
    expect(arabic.terms?.length).toBeGreaterThan(500);
    expect(arabic.qr).not.toBeNull();
    expect(arabic.bank).not.toBeNull();
    expect(arabic.stampUrl).toMatch(/^data:image\/svg\+xml/);
    expect(arabic.signatureUrl).toMatch(/^data:image\/svg\+xml/);

    expect(english.direction).toBe('ltr');
    expect(english.qr).toBeNull();
    expect(english.bank).toBeNull();
    expect(english.stampUrl).toBeNull();
    expect(english.signatureUrl).toBeNull();

    expect(longContent.lines).toHaveLength(5);
    expect(longContent.notes?.length).toBeGreaterThan(500);
    expect(longContent.terms?.length).toBeGreaterThan(500);
  });
});
