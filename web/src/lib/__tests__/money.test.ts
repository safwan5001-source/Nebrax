import { describe, it, expect } from 'vitest';
import { formatRiyal, riyalToMinor, isNegative, extractInclusiveTax } from '../money';

describe('formatRiyal — العرض من الريال إلى نص بفواصل + ﷼', () => {
  it('ينسّق نصاً وعدداً بفاصلتين', () => {
    expect(formatRiyal('1150.00')).toBe('1,150.00 ﷼');
    expect(formatRiyal(1150)).toBe('1,150.00 ﷼');
    expect(formatRiyal(0)).toBe('0.00 ﷼');
    expect(formatRiyal(1234567.5)).toBe('1,234,567.50 ﷼');
  });

  it('يحافظ على إشارة السالب', () => {
    expect(formatRiyal('-115.00')).toBe('-115.00 ﷼');
  });

  it('يتعامل مع null/undefined كصفر', () => {
    expect(formatRiyal(null)).toBe('0.00 ﷼');
    expect(formatRiyal(undefined)).toBe('0.00 ﷼');
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
