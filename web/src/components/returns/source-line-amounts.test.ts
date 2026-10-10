import { describe, expect, it } from 'vitest';
import { sourceLineAmounts, type SourceCharge } from './source-line-amounts';

const charge = (over: Partial<SourceCharge> = {}): SourceCharge => ({
  soldQty: 3, returnedQty: 0, unitPrice: 10001,
  net: 26090, tax: 3913, remainingNet: 26090, remainingTax: 3913,
  ...over,
});

describe('sourceLineAmounts (mirrors ReturnSourceAllocator)', () => {
  it('splits an inclusive line so the parts sum to the charged net and VAT', () => {
    const parts = [0, 1, 2].map((returnedQty) =>
      sourceLineAmounts(charge({ returnedQty }), 1, 10001),
    );
    expect(parts.map((p) => p.net)).toEqual([8696, 8697, 8697]);
    expect(parts.map((p) => p.tax)).toEqual([1304, 1304, 1305]);
    expect(parts.reduce((s, p) => s + p.net, 0)).toBe(26090);
    expect(parts.reduce((s, p) => s + p.tax, 0)).toBe(3913);
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
