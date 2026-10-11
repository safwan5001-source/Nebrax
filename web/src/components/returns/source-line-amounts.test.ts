import { describe, expect, it } from 'vitest';
import { sourceLineAmounts, type SourceCharge } from './source-line-amounts';

const charge = (over: Partial<SourceCharge> = {}): SourceCharge => ({
  soldQty: 3, returnedQty: 0, unitPrice: 10001,
  net: 26090, tax: 3913, remainingNet: 26090, remainingTax: 3913,
  ...over,
});

describe('sourceLineAmounts (mirrors ReturnSourceAllocator)', () => {
  it('splits an inclusive line so the parts sum to the charged net and VAT', () => {
    // الجزء الأخير = المتبقي الفعلي بعد ما رُدَّ فعلاً (هنا: نصيبا الوحدتين الأوليين).
    const first = sourceLineAmounts(charge({ returnedQty: 0 }), 1, 10001);
    const second = sourceLineAmounts(
      charge({ returnedQty: 1, remainingNet: 26090 - first.net, remainingTax: 3913 - first.tax }), 1, 10001);
    const third = sourceLineAmounts(
      charge({ returnedQty: 2, remainingNet: 26090 - first.net - second.net, remainingTax: 3913 - first.tax - second.tax }), 1, 10001);
    expect([first.net, second.net, third.net]).toEqual([8696, 8697, 8697]);
    expect([first.tax, second.tax, third.tax]).toEqual([1304, 1304, 1305]);
    expect(first.net + second.net + third.net).toBe(26090);
    expect(first.tax + second.tax + third.tax).toBe(3913);
  });

  it('closes the halalas left by earlier POS-style returns on the final part', () => {
    // 3 × 0.10: ضريبة 0.05؛ POS رقّم 0.01 + 0.01 فبقي 0.03 للأخير (لا 0.02).
    const c = charge({ soldQty: 3, unitPrice: 10, net: 30, tax: 5, returnedQty: 2, remainingNet: 10, remainingTax: 3 });
    expect(sourceLineAmounts(c, 1, 10)).toEqual({ net: 10, tax: 3 });
  });

  it('does not hand back a reduced-price hold-back on the final part', () => {
    const c = charge({
      soldQty: 3, unitPrice: 10000, net: 30000, tax: 4500, returnedQty: 2,
      remainingNet: 15000, remainingTax: 2250, reducedBefore: true,
    });
    expect(sourceLineAmounts(c, 1, 10000)).toEqual({ net: 10000, tax: 1500 });
  });

  it('returns the whole charged amount for the full quantity', () => {
    expect(sourceLineAmounts(charge(), 3, 10001)).toEqual({ net: 26090, tax: 3913 });
  });

  it('scales proportionally when the refund price is below the sale price', () => {
    const c = charge({ soldQty: 2, unitPrice: 10000, net: 20000, tax: 3000, remainingNet: 20000, remainingTax: 3000 });
    expect(sourceLineAmounts(c, 1, 5000)).toEqual({ net: 5000, tax: 750 });
  });

  it('never exceeds what is left to return', () => {
    const c = charge({ soldQty: 2, unitPrice: 11500, net: 20000, tax: 3000, returnedQty: 1, remainingNet: 8500, remainingTax: 1275 });
    expect(sourceLineAmounts(c, 1, 11500)).toEqual({ net: 8500, tax: 1275 });
  });

  it('is exact beyond 2^53 intermediate products', () => {
    const c = charge({ soldQty: 3, net: 99_999_999_999, tax: 0, remainingNet: 99_999_999_999, remainingTax: 0, unitPrice: 0 });
    expect(sourceLineAmounts(c, 1, 0).net).toBe(33_333_333_333);
  });
});
