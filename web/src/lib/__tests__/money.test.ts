import { describe, it, expect } from 'vitest';
import {
  SAUDI_RIYAL_SYMBOL,
  formatRiyal,
  formatRiyalShort,
  formatRiyalParts,
  riyalToMinor,
  isNegative,
  extractInclusiveTax,
} from '../money';

describe('formatRiyal — العرض برمز الريال السعودي الرسمي U+20C1', () => {
  it('يثبّت الرمز الرسمي ولا يستخدم الرمز القديم أو اختصارات نصية', () => {
    expect(SAUDI_RIYAL_SYMBOL).toBe('\u20C1');
    expect(SAUDI_RIYAL_SYMBOL.codePointAt(0)).toBe(0x20c1);

    for (const formatted of [formatRiyal(1150), formatRiyalShort(1150)]) {
      expect(formatted).toContain(SAUDI_RIYAL_SYMBOL);
      expect(formatted).not.toContain('﷼');
      expect(formatted).not.toContain('ر.س');
      expect(formatted).not.toContain('SAR');
      expect(formatted).not.toContain('ريال');
    }
  });

  it('ينسّق نصاً وعدداً بفاصلتين', () => {
    expect(formatRiyal('1150.00')).toBe(`1,150.00 ${SAUDI_RIYAL_SYMBOL}`);
    expect(formatRiyal(1150)).toBe(`1,150.00 ${SAUDI_RIYAL_SYMBOL}`);
    expect(formatRiyal(0)).toBe(`0.00 ${SAUDI_RIYAL_SYMBOL}`);
    expect(formatRiyal(1234567.5)).toBe(`1,234,567.50 ${SAUDI_RIYAL_SYMBOL}`);
  });

  it('يحافظ على إشارة السالب', () => {
    expect(formatRiyal('-115.00')).toBe(`-115.00 ${SAUDI_RIYAL_SYMBOL}`);
  });

  it('يتعامل مع null/undefined كصفر', () => {
    expect(formatRiyal(null)).toBe(`0.00 ${SAUDI_RIYAL_SYMBOL}`);
    expect(formatRiyal(undefined)).toBe(`0.00 ${SAUDI_RIYAL_SYMBOL}`);
  });
});

describe('riyalToMinor — تحويل الريال إلى هللات بلا float', () => {
  it('يحوّل القيم العشرية بدقة', () => {
    expect(riyalToMinor('1000.50')).toBe(100050);
    expect(riyalToMinor('1000')).toBe(100000);
    expect(riyalToMinor('0.05')).toBe(5);
    expect(riyalToMinor('100.5')).toBe(10050); // خانة عشرية واحدة تُكمَّل
    expect(riyalToMinor(40)).toBe(4000);
  });

  it('يتعامل مع الفارغ والسالب', () => {
    expect(riyalToMinor('')).toBe(0);
    expect(riyalToMinor('-12.34')).toBe(-1234);
  });

  it('يتجنّب انحراف الفاصلة العائمة (0.1+0.2 الكلاسيكي)', () => {
    // 0.1 ريال = 10 هللات، 0.2 ريال = 20 هللة، المجموع 30 بالضبط
    expect(riyalToMinor('0.10') + riyalToMinor('0.20')).toBe(30);
  });
});

describe('extractInclusiveTax — استخراج ضريبة متضمَّنة (يطابق الـ backend)', () => {
  it('يستخرج 15% من مبلغ شامل', () => {
    // 115.00 شامل 15% → ضريبة 15.00 (1500 هللة)
    expect(extractInclusiveTax(11500, 15)).toBe(1500);
    // 1150.00 شامل → 150.00
    expect(extractInclusiveTax(115000, 15)).toBe(15000);
  });

  it('يقرّب لأقرب هللة كالـ backend', () => {
    // 100.00 شامل 15% → 100×15/115 = 13.043… → 1304 هللة (round)
    expect(extractInclusiveTax(10000, 15)).toBe(1304);
  });

  it('صفر عند نسبة أو مبلغ غير موجب', () => {
    expect(extractInclusiveTax(11500, 0)).toBe(0);
    expect(extractInclusiveTax(0, 15)).toBe(0);
  });
});

describe('isNegative', () => {
  it('يكتشف السالب فقط', () => {
    expect(isNegative('-1')).toBe(true);
    expect(isNegative('5')).toBe(false);
    expect(isNegative(0)).toBe(false);
    expect(isNegative(null)).toBe(false);
  });
});

describe('formatRiyalParts — تفكيك بصري بلا تغيير في القيمة (أساس Money presentation، H1)', () => {
  function reconstruct(value: string | number | null | undefined): string {
    const p = formatRiyalParts(value);
    if (p.invalid) return '—';
    return `${p.negative ? '-' : ''}${p.integer}.${p.fraction} ${p.symbol}`;
  }

  it('يعيد بناء مخرجات formatRiyal حرفياً لكل قيمة صالحة — لا انحراف حسابي', () => {
    for (const value of [0, 1150, '1150.00', 1234567.5, -115, '-115.00', 0.05, -0.05]) {
      expect(reconstruct(value)).toBe(formatRiyal(value));
    }
  });

  it('يعيد بناء مخرجات formatRiyal لـ null/undefined كصفر', () => {
    expect(reconstruct(null)).toBe(formatRiyal(null));
    expect(reconstruct(undefined)).toBe(formatRiyal(undefined));
  });

  it('يفصل الإشارة عن الجزء الصحيح (negative منفصلة، integer بلا "-")', () => {
    const parts = formatRiyalParts(-1150.5);
    expect(parts.negative).toBe(true);
    expect(parts.integer).toBe('1,150');
    expect(parts.fraction).toBe('50');
    expect(parts.integer).not.toContain('-');
  });

  it('مدخل غير صالح: invalid=true وبلا رمز عملة (يطابق "—" في formatRiyal)', () => {
    const parts = formatRiyalParts('ليس رقماً');
    expect(parts.invalid).toBe(true);
    expect(formatRiyal('ليس رقماً')).toBe('—');
  });

  it('الرمز دائماً U+20C1', () => {
    expect(formatRiyalParts(10).symbol).toBe(SAUDI_RIYAL_SYMBOL);
  });
});
