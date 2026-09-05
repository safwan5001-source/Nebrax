import { describe, expect, it } from 'vitest';
import { discountMinorFromPercent, discountPercentFromMinor } from '@/lib/pos-discount';

describe('pos-discount: تحويل النسبة المئوية إلى مبلغ خصم وبالعكس', () => {
  it('يحسب مبلغ الخصم من نسبة عادية', () => {
    expect(discountMinorFromPercent(10000, 10)).toBe(1000);
    expect(discountMinorFromPercent(10000, 50)).toBe(5000);
  });

  it('يقيّد النسبة عند 100% فلا يتجاوز الخصم إجمالي السطر', () => {
    expect(discountMinorFromPercent(10000, 150)).toBe(10000);
  });

  it('يرفض القيم غير المنتهية أو السالبة أو الصفرية فيعيد صفراً', () => {
    expect(discountMinorFromPercent(10000, -5)).toBe(0);
    expect(discountMinorFromPercent(10000, NaN)).toBe(0);
    expect(discountMinorFromPercent(0, 10)).toBe(0);
    expect(discountMinorFromPercent(10000, 0)).toBe(0);
  });

  it('يشتق النسبة المكافئة لمبلغ خصم قائم', () => {
    expect(discountPercentFromMinor(10000, 1000)).toBe(10);
    expect(discountPercentFromMinor(10000, 10000)).toBe(100);
  });

  it('يقيّد النسبة المشتقة عند 100% حتى لو تجاوز المبلغ الإجمالي (بيانات قديمة غير متوقعة)', () => {
    expect(discountPercentFromMinor(10000, 20000)).toBe(100);
  });

  it('يعيد صفراً حين يغيب الإجمالي أو الخصم', () => {
    expect(discountPercentFromMinor(0, 1000)).toBe(0);
    expect(discountPercentFromMinor(10000, 0)).toBe(0);
  });
});
