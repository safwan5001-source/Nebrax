import { describe, expect, it } from 'vitest';
import { buildPaymentDocumentModel, type SourcePayment } from './from-payment';

const base: SourcePayment = { number: 'RCV-1', payment_date: '2026-09-01', direction: 'received', method: 'نقدي', amount: '100.50' };
const build = (payment: SourcePayment) => buildPaymentDocumentModel({ payment, company: null, partner: null }).voucher!;

describe('buildPaymentDocumentModel — حقول السند الإضافية (AWJ-DOC-V2-PR5)', () => {
  it('بلا حقول إضافية في المصدر تبقى كلها null (لا اختلاق)', () => {
    const v = build(base);
    expect(v).toMatchObject({ direction: 'received', amount: 10050, method: 'نقدي' });
    expect(v.methodName).toBeNull();
    expect(v.paymentDetails).toBeNull();
    expect(v.accountName).toBeNull();
    expect(v.collectorName).toBeNull();
    expect(v.classificationName).toBeNull();
    expect(v.branchName).toBeNull();
  });

  it('تنقل القيم الموجودة كما هي (مقتطعة الفراغات) وتجمع كود الحساب مع اسمه', () => {
    const v = build({
      ...base,
      payment_method_name: ' تحويل بنكي ',
      payment_details: 'حوالة 7782',
      collector_employee_name: 'خالد',
      cash_account_code: '1120',
      cash_account_name: 'البنك الرئيسي',
      classification: { name: 'تسوية عملاء' },
      branch_name: 'فرع الدمام',
    });
    expect(v).toMatchObject({
      methodName: 'تحويل بنكي', paymentDetails: 'حوالة 7782', collectorName: 'خالد',
      accountName: '1120 — البنك الرئيسي', classificationName: 'تسوية عملاء', branchName: 'فرع الدمام',
    });
  });

  it('الحساب بالاسم وحده أو بالكود وحده، والنصوص الفارغة/الفراغات تصير null', () => {
    expect(build({ ...base, cash_account_name: 'الصندوق' }).accountName).toBe('الصندوق');
    expect(build({ ...base, cash_account_code: '1110' }).accountName).toBe('1110');
    const blank = build({ ...base, payment_method_name: '  ', payment_details: '', collector_employee_name: ' ', cash_account_code: ' ', cash_account_name: '', classification: { name: '' }, branch_name: '   ' });
    expect(blank.methodName).toBeNull();
    expect(blank.paymentDetails).toBeNull();
    expect(blank.collectorName).toBeNull();
    expect(blank.accountName).toBeNull();
    expect(blank.classificationName).toBeNull();
    expect(blank.branchName).toBeNull();
  });

  it('الاتجاه والمبلغ والتخصيصات لم تتغيّر', () => {
    const v = build({ ...base, direction: 'paid', amount: '2.00', allocations: [{ label: 'فاتورة', amount: '2.00' }] });
    expect(v.direction).toBe('paid');
    expect(v.amount).toBe(200);
    expect(v.allocations).toEqual([{ label: 'فاتورة', amount: 200 }]);
  });
});
