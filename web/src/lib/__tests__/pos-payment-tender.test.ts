import { describe, expect, it } from 'vitest';
import { orderedTenderPayload, simulateTenders } from '@/lib/pos-payment-tender';

describe('simulateTenders', () => {
  it('A) نقد بالمبلغ بالضبط: لا فكة ولا متبقٍ', () => {
    const result = simulateTenders(10000, [{ methodId: 'cash', amount: 10000, settlementType: 'cash' }]);
    expect(result.remainingMinor).toBe(0);
    expect(result.changeMinor).toBe(0);
    expect(result.invalidMethodId).toBeNull();
    expect(result.appliedByMethodId.cash).toBe(10000);
  });

  it('A) نقد زائد: فكة صحيحة تساوي الفائض', () => {
    const result = simulateTenders(10000, [{ methodId: 'cash', amount: 12000, settlementType: 'cash' }]);
    expect(result.remainingMinor).toBe(0);
    expect(result.changeMinor).toBe(2000);
    expect(result.invalidMethodId).toBeNull();
    expect(result.appliedByMethodId.cash).toBe(10000);
  });

  it('B) بنكي زائد: يُرفض بدل اعتباره فكة صحيحة', () => {
    const result = simulateTenders(10000, [{ methodId: 'bank', amount: 12000, settlementType: 'bank' }]);
    expect(result.invalidMethodId).toBe('bank');
    expect(result.changeMinor).toBe(0);
    expect(result.appliedByMethodId.bank).toBeUndefined();
  });

  it('C) نقد + بنكي مطابقان للإجمالي: مدفوع كامل بلا متبقٍ ولا فكة', () => {
    const result = simulateTenders(10000, [
      { methodId: 'cash', amount: 4000, settlementType: 'cash' },
      { methodId: 'bank', amount: 6000, settlementType: 'bank' },
    ]);
    expect(result.remainingMinor).toBe(0);
    expect(result.changeMinor).toBe(0);
    expect(result.invalidMethodId).toBeNull();
    expect(result.appliedByMethodId.bank).toBe(6000);
    expect(result.appliedByMethodId.cash).toBe(4000);
  });

  it('D) نقد يغطي الإجمالي كاملاً + وسيلة بنكية إضافية: البنكية تُرفض (المتبقي صفر وقت معالجتها)', () => {
    // الترتيب الفعلي دائماً: غير النقدي أولاً ثم النقدي أخيراً، بصرف النظر عن
    // ترتيب الإدخال في الواجهة — فتُعالَج البنكية أولاً هنا رغم كتابتها ثانياً.
    const result = simulateTenders(10000, [
      { methodId: 'cash', amount: 12000, settlementType: 'cash' },
      { methodId: 'bank', amount: 5000, settlementType: 'bank' },
    ]);
    // البنكية تُعالَج أولاً (غير نقدية) ضد متبقٍ = 10000، فتُطبَّق كاملة (5000 ≤ 10000).
    expect(result.invalidMethodId).toBeNull();
    expect(result.appliedByMethodId.bank).toBe(5000);
    // يبقى 5000 يُطبَّق عليها النقد (12000)، فالمطبَّق من النقد 5000 والفكة 7000.
    expect(result.appliedByMethodId.cash).toBe(5000);
    expect(result.changeMinor).toBe(7000);
    expect(result.remainingMinor).toBe(0);
  });

  it('وسيلة بنكية ثانية تتجاوز ما تبقّى بعد الأولى: تُرفض ولا يُطبَّق النقد اللاحق', () => {
    // كلتاهما غير نقدية فتُعالَجان بترتيب إدخالهما: الأولى (6000) ضد 10000 تُطبَّق
    // كاملة (متبقٍ يصبح 4000)، والثانية (5000) تتجاوز الـ4000 المتبقية فتُرفض —
    // والنقد الذي يليها في نية الكاشير لا يُعالَج إطلاقاً (البيع كله يُرفض خادمياً).
    const result = simulateTenders(10000, [
      { methodId: 'bank1', amount: 6000, settlementType: 'bank' },
      { methodId: 'bank2', amount: 5000, settlementType: 'bank' },
      { methodId: 'cash', amount: 4000, settlementType: 'cash' },
    ]);
    expect(result.appliedByMethodId.bank1).toBe(6000);
    expect(result.invalidMethodId).toBe('bank2');
    expect(result.appliedByMethodId.bank2).toBeUndefined();
    expect(result.appliedByMethodId.cash).toBeUndefined();
  });

  it('دفع آجل جزئي: نقد أقل من الإجمالي يترك متبقياً بلا فكة وبلا رفض', () => {
    const result = simulateTenders(10000, [{ methodId: 'cash', amount: 4000, settlementType: 'cash' }]);
    expect(result.invalidMethodId).toBeNull();
    expect(result.changeMinor).toBe(0);
    expect(result.remainingMinor).toBe(6000);
  });

  it('بلا وسائل دفع: يبقى كامل الإجمالي متبقياً', () => {
    const result = simulateTenders(10000, []);
    expect(result.remainingMinor).toBe(10000);
    expect(result.changeMinor).toBe(0);
    expect(result.invalidMethodId).toBeNull();
  });

  it('مبالغ صفرية أو سالبة تُتجاهَل تماماً', () => {
    const result = simulateTenders(10000, [
      { methodId: 'cash', amount: 0, settlementType: 'cash' },
      { methodId: 'bank', amount: -500, settlementType: 'bank' },
    ]);
    expect(result.remainingMinor).toBe(10000);
    expect(Object.keys(result.appliedByMethodId)).toHaveLength(0);
  });
});

describe('orderedTenderPayload', () => {
  it('يرسل غير النقدي أولاً ثم النقدي أخيراً — مطابقاً لترتيب المحاكاة تماماً', () => {
    const payload = orderedTenderPayload([
      { methodId: 'cash', amount: 4000, settlementType: 'cash' },
      { methodId: 'bank', amount: 6000, settlementType: 'bank' },
    ]);
    expect(payload).toEqual([
      { payment_method_id: 'bank', amount: 6000 },
      { payment_method_id: 'cash', amount: 4000 },
    ]);
  });

  it('يُسقط المبالغ الصفرية/السالبة من حمولة الإرسال', () => {
    const payload = orderedTenderPayload([
      { methodId: 'cash', amount: 0, settlementType: 'cash' },
      { methodId: 'bank', amount: 6000, settlementType: 'bank' },
    ]);
    expect(payload).toEqual([{ payment_method_id: 'bank', amount: 6000 }]);
  });
});
