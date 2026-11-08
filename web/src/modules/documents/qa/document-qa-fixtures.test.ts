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

  it('تنشئ عينات سند القبض/الصرف بمبالغ كبيرة وتخصيصات تتبع السيناريو وإجمالي مستمد منها (PR4)', () => {
    const expectations = { single: 1, five: 5, twenty: 20, multipage: 40, long_content: 5 } as const;
    for (const type of ['receipt_voucher', 'payment_voucher'] as const) {
      for (const [scenario, count] of Object.entries(expectations) as Array<[keyof typeof expectations, number]>) {
        const model = makeDocumentQaModel({ documentType: type, scenario, direction: 'rtl', showQr: true, showAssets: true });
        expect(model.type).toBe(type);
        expect(model.lines).toHaveLength(0);
        expect(model.qr).toBeNull();
        expect(model.voucher?.direction).toBe(type === 'receipt_voucher' ? 'received' : 'paid');
        expect(model.voucher?.allocations).toHaveLength(count);
        const sum = model.voucher!.allocations.reduce((total, row) => total + row.amount, 0);
        expect(model.voucher?.amount).toBe(sum);
        expect(model.totals).toEqual({ subtotal: sum, tax: 0, total: sum });
        expect(Number.isSafeInteger(sum)).toBe(true);
        // كل تخصيص ≈ 24.7 مليون ريال: المبلغ الكبير جزء من العقد لا مصادفة.
        for (const row of model.voucher!.allocations) expect(row.amount).toBeGreaterThan(1_000_000_000);
      }
    }
  });

  it('عينة السند تحافظ على الأصول والاتجاه الإنجليزي وملاحظاته الطويلة', () => {
    const english = makeDocumentQaModel({ documentType: 'receipt_voucher', scenario: 'multipage', direction: 'ltr', showQr: false, showAssets: true });
    expect(english.voucher?.method).toBe('Bank transfer');
    expect(english.voucher?.allocations[0].label).toMatch(/^Invoice INV-QA-0001/);
    expect(english.stampUrl).not.toBeNull();
    expect(english.signatureUrl).not.toBeNull();
    expect(english.notes?.length).toBeGreaterThan(500);
    const bare = makeDocumentQaModel({ documentType: 'payment_voucher', scenario: 'single', direction: 'rtl', showQr: false, showAssets: false });
    expect(bare.stampUrl).toBeNull();
    expect(bare.signatureUrl).toBeNull();
  });
});
