import { describe, expect, it } from 'vitest';
import { litersToMilliliters } from '@/lib/fuel-quantity';
import { normalizeDecimalInput } from '@/lib/decimal-input';
import { riyalToMinor } from '@/lib/money';

describe('normalizeDecimalInput', () => {
  it('reads a lone comma followed by 1..max digits as the decimal separator', () => {
    expect(normalizeDecimalInput('1,5', 3)).toBe('1.5');
    expect(normalizeDecimalInput('12,25', 3)).toBe('12.25');
    expect(normalizeDecimalInput('1,5', 2)).toBe('1.5');
  });

  it('treats grouped commas as thousands', () => {
    expect(normalizeDecimalInput('1,234,567', 3)).toBe('1234567');
    expect(normalizeDecimalInput('1,234.56', 3)).toBe('1234.56');
    expect(normalizeDecimalInput('1.234,56', 3)).toBe('1234.56');
    expect(normalizeDecimalInput('1,500', 2)).toBe('1500'); // مبلغ: 3 منازل لا تكون عشرية
  });

  it('refuses the ambiguous shapes instead of guessing', () => {
    expect(normalizeDecimalInput('1,500', 3)).toBeNull(); // 1.500 أم 1500؟
    expect(normalizeDecimalInput('1,23,4', 3)).toBeNull();
    expect(normalizeDecimalInput('1,2345', 3)).toBeNull();
    expect(normalizeDecimalInput(',5', 3)).toBeNull();
    expect(normalizeDecimalInput('', 3)).toBeNull();
    expect(normalizeDecimalInput('1..5', 3)).toBeNull();
  });

  it('normalises Arabic-Indic digits and separators', () => {
    expect(normalizeDecimalInput('١٢٫٥', 3)).toBe('12.5');
    expect(normalizeDecimalInput('١٬٢٣٤٫٥', 3)).toBe('1234.5');
    expect(normalizeDecimalInput('١،٥', 3)).toBe('1.5');
    expect(normalizeDecimalInput('1 234.5', 3)).toBe('1234.5');
  });
});

describe('litersToMilliliters decimal comma (was 1,5 -> 15 L)', () => {
  it('reads 1,5 as 1.5 L, never 15 L', () => {
    expect(litersToMilliliters('1,5')).toBe(1500);
    expect(litersToMilliliters('1,25')).toBe(1250);
    expect(litersToMilliliters('١٫٥')).toBe(1500);
  });

  it('rejects the ambiguous 1,500 and keeps the dot and grouped forms', () => {
    expect(litersToMilliliters('1,500')).toBeNull();
    expect(litersToMilliliters('1.500')).toBe(1500);
    expect(litersToMilliliters('1,000,000')).toBe(1_000_000_000);
    expect(litersToMilliliters('10.000')).toBe(10000);
  });
});

describe('riyalToMinor decimal comma (was 1,5 -> 15 SAR)', () => {
  it('reads 1,5 as 1.50 SAR, never 15 SAR', () => {
    expect(riyalToMinor('1,5')).toBe(150);
    expect(riyalToMinor('1,50')).toBe(150);
    expect(riyalToMinor('-1,5')).toBe(-150);
  });

  it('keeps thousands grouping and the dot form', () => {
    expect(riyalToMinor('1,500')).toBe(150000);
    expect(riyalToMinor('1,234.50')).toBe(123450);
    expect(riyalToMinor('1000.50')).toBe(100050);
    expect(Number.isNaN(riyalToMinor('1,2345'))).toBe(true);
    expect(Number.isNaN(riyalToMinor('abc'))).toBe(true);
  });
});
