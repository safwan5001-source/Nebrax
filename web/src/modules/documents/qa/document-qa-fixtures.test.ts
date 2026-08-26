import { describe, expect, it } from 'vitest';
import { makeDocumentQaModel } from './document-qa-fixtures';

describe('نماذج تحقق المستندات', () => {
  it('تنشئ سيناريوهات أحجام البنود المطلوبة مع إجماليات مستمدة من البنود', () => {
    const expectations = { single: 1, five: 5, twenty: 20, multipage: 40 } as const;
    for (const [scenario, count] of Object.entries(expectations) as Array<[keyof typeof expectations, number]>) {
      const model = makeDocumentQaModel({ scenario, direction: 'rtl', showQr: true, showAssets: true });
      expect(model.lines).toHaveLength(count);
      expect(model.totals.subtotal).toBe(model.lines.reduce((sum, line) => sum + (line.priceBeforeTax ?? 0), 0));
      expect(model.totals.tax).toBe(model.lines.reduce((sum, line) => sum + line.tax, 0));
    }
  });

  it('يغطي الحقول الطويلة والأصول والاتجاهين بلا اتصال ببيانات أعمال', () => {
    const arabic = makeDocumentQaModel({ scenario: 'multipage', direction: 'rtl', showQr: true, showAssets: true });
    const english = makeDocumentQaModel({ scenario: 'multipage', direction: 'ltr', showQr: false, showAssets: false });

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
  });
});
