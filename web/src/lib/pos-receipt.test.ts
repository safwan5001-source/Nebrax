import { describe, expect, it } from 'vitest';
import { buildPosReceiptInvoice, posReceiptCustomer, type PosCheckoutInvoice } from './pos-receipt';

/**
 * R5: الإيصال الفوري يجب أن يمثّل الفاتورة المرحّلة الخادمية بالضبط، لا
 * قيماً معاد اشتقاقها من سلة العميل. هذه الاختبارات تثبت أن `created`
 * (استجابة `POST /pos/checkout`) هو المصدر الوحيد للأرقام المالية، وأن قيمة
 * سلة متلاعَب بها أو قديمة لا تصل إلى الإيصال أبداً.
 */
describe('buildPosReceiptInvoice', () => {
  const created: PosCheckoutInvoice = {
    number: 'INV-2026-00042',
    invoice_date: '2026-01-15',
    payment_status: 'paid',
    subtotal: '100.00',
    tax_amount: '15.00',
    total: '115.00',
    notes: 'ملاحظة الفاتورة الفعلية',
    partner: { name: 'عميل الفاتورة الفعلي', vat_number: '300000000000003', city: 'الدمام' },
    lines: [
      {
        id: 'line-1', product_name: 'صنف أول', description: 'صنف أول',
        quantity: 3, unit_price: '33.33', unit_price_before_tax: '28.98',
        tax_rate: 15, line_tax: '15.00', line_total: '115.00',
      },
    ],
  };

  it('يستعمل رقم الفاتورة والتاريخ والإجماليات من الفاتورة المرحّلة، لا من حساب محلي', () => {
    const result = buildPosReceiptInvoice(created);

    expect(result.number).toBe('INV-2026-00042');
    expect(result.invoice_date).toBe('2026-01-15');
    expect(result.subtotal).toBe('100.00');
    expect(result.tax_amount).toBe('15.00');
    expect(result.total).toBe('115.00');
    expect(result.notes).toBe('ملاحظة الفاتورة الفعلية');
  });

  it('يتجاهل إجماليات سلة متلاعَباً بها تماماً — لا مصدر إلا الفاتورة المرحّلة', () => {
    // لو كانت السلة (أو حساب محلي) تدّعي إجمالياً مختلفاً، لا وسيلة له للوصول
    // إلى الدالة أصلاً: لا تقبل معاملاً كهذا، فلا تسرّبه سهواً مستقبلاً.
    const result = buildPosReceiptInvoice(created);
    expect(result.total).not.toBe('999.00');
    expect(result.total).toBe(created.total);
  });

  it('يمثّل كل سطر بقيمه المالية الخادمية (كمية/سعر/ضريبة/إجمالي) دون إعادة حساب', () => {
    const result = buildPosReceiptInvoice(created);
    const [line] = result.lines;

    expect(line.quantity).toBe(3);
    expect(line.unit_price).toBe('33.33');
    expect(line.unit_price_before_tax).toBe('28.98');
    expect(line.tax_rate).toBe(15);
    expect(line.line_tax).toBe('15.00');
    expect(line.line_total).toBe('115.00');
  });

  it('يلحق اسم الوحدة المختارة في الشاشة كعنصر عرض بحت دون تغيير أي رقم مالي', () => {
    const result = buildPosReceiptInvoice(created, ['كرتون']);
    const [line] = result.lines;

    expect(line.description).toBe('صنف أول (كرتون)');
    expect(line.line_total).toBe('115.00'); // الرقم المالي لم يتأثر بإلحاق اسم الوحدة.
  });

  it('يستعمل حالة السداد الفعلية بعد الترحيل، لا افتراض «آجل» الثابت على عقد الفاتورة', () => {
    expect(buildPosReceiptInvoice({ ...created, payment_status: 'paid' }).payment_type).toBe('cash');
    expect(buildPosReceiptInvoice({ ...created, payment_status: 'partial' }).payment_type).toBe('cash');
    expect(buildPosReceiptInvoice({ ...created, payment_status: 'unpaid' }).payment_type).toBe('credit');
  });
});

describe('posReceiptCustomer', () => {
  it('يستعمل اسم/رقم ضريبي/مدينة العميل من الفاتورة المرحّلة نفسها', () => {
    const created = { partner: { name: 'عميل الفاتورة', vat_number: '300000000000003', city: 'الدمام' } };

    expect(posReceiptCustomer(created, 'اسم منتقي الشاشة')).toEqual({
      name: 'عميل الفاتورة', vat_number: '300000000000003', city: 'الدمام',
    });
  });

  it('يسقط على اسم منتقي الشاشة فقط حين تغيب علاقة العميل عن الردّ (توافق رجعي)', () => {
    expect(posReceiptCustomer({ partner: null }, 'اسم منتقي الشاشة')).toEqual({
      name: 'اسم منتقي الشاشة', vat_number: null, city: null,
    });
    expect(posReceiptCustomer({}, 'اسم منتقي الشاشة')).toEqual({
      name: 'اسم منتقي الشاشة', vat_number: null, city: null,
    });
  });
});
