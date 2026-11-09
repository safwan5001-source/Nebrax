import { describe, expect, it } from 'vitest';
import { buildCreditNoteDocumentModel } from './from-credit-note';

/**
 * ERP-PRODUCT-LINK-D: نموذج مستند الإشعار (الذي تغذّي به الطباعة وPDF) يعرض الوصف المخصّص
 * المحفوظ لا اسم المنتج الافتراضي. الاختبار يثبّت ذلك لدائن المبيعات ولمدين المشتريات.
 */
describe('buildCreditNoteDocumentModel — custom line description is rendered as stored', () => {
  const CUSTOM = 'كرتون ورق A4 — مع التوصيل';

  for (const type of ['sales', 'purchase'] as const) {
    it(`renders the custom description, not the product name, for a ${type} note`, () => {
      const model = buildCreditNoteDocumentModel({
        note: {
          number: 'CN-2026-0002',
          note_date: '2026-11-02',
          subtotal: '285.00',
          tax_amount: '42.75',
          total: '327.75',
          reason: null,
          type,
          lines: [{
            id: 'l1',
            // الطلب يحمل product_id مع الوصف؛ المولّد لا يعرف اسم المنتج أصلاً فلا يستبدل الوصف.
            product_id: 'prod-a',
            description: CUSTOM,
            quantity: 3,
            unit_price: '95.00',
            tax_rate: 15,
            line_tax: '42.75',
            line_total: '327.75',
          }] as never,
        },
        company: { name: 'نبراس' },
        customer: { name: 'عميل' },
      });

      expect(model.lines[0].description).toBe(CUSTOM);
      expect(model.lines[0].description).not.toBe('A4 paper carton');
      expect(model.lines[0]).toMatchObject({ quantity: 3, taxRate: 15 });
    });
  }

  it('keeps an empty description empty instead of inventing one', () => {
    const model = buildCreditNoteDocumentModel({
      note: {
        number: 'CN-2026-0003',
        note_date: '2026-11-02',
        subtotal: '100.00',
        tax_amount: '15.00',
        total: '115.00',
        reason: null,
        type: 'sales',
        lines: [{ id: 'l1', description: null, quantity: 1, unit_price: '100.00', tax_rate: 15, line_tax: '15.00', line_total: '115.00' }],
      },
      company: { name: 'نبراس' },
      customer: null,
    });

    expect(model.lines[0].description).toBe('');
  });
});
