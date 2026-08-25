import { describe, expect, it } from 'vitest';
import { formatLiters, formatMillilitersAsLiters, litersToMilliliters, millilitersToLiters } from './fuel-quantity';
import { formatMinorRiyal, minorToRiyal, riyalToMinor } from './money';

describe('Fuel Stations presentation boundaries', () => {
  it('converts liters to exact milliliters without floating-point arithmetic', () => {
    expect(litersToMilliliters('12.345')).toBe(12345);
    expect(litersToMilliliters('١٢٫٥')).toBe(12500);
    expect(litersToMilliliters('0')).toBeNull();
    expect(litersToMilliliters('12.3456')).toBeNull();
  });

  it('formats internal milliliters as human liters', () => {
    expect(millilitersToLiters(12000)).toBe('12');
    expect(millilitersToLiters(12345)).toBe('12.345');
    expect(formatLiters(12.5)).toContain('12.5');
  });

  it('names the liter unit once, in the language the screen passes in', () => {
    // الوحدة تأتي من `fuelStations.literUnit`: «لتر» عربياً و«L» إنجليزياً.
    expect(formatMillilitersAsLiters(84250000, 'ar', 'لتر')).toBe('84,250 لتر');
    expect(formatMillilitersAsLiters(84250000, 'en', 'L')).toBe('84,250 L');
  });

  it('never repeats the unit, whatever the language', () => {
    expect(formatMillilitersAsLiters(84250000, 'ar', 'لتر')).not.toMatch(/L/);
    expect(formatMillilitersAsLiters(84250000, 'en', 'L')).not.toMatch(/لتر/);
    expect(formatLiters(12.345, 'ar', 'لتر').match(/لتر/g)).toHaveLength(1);
    expect(formatLiters(12.345, 'en', 'L').match(/L/g)).toHaveLength(1);
  });

  it('keeps the bare "L" for screens that have not named their unit yet', () => {
    expect(formatLiters(12.5)).toBe('12.5 L');
    expect(formatMillilitersAsLiters(12500)).toBe('12.5 L');
  });

  it('keeps Latin digits and three-decimal precision in both languages', () => {
    for (const [locale, unit] of [['ar', 'لتر'], ['en', 'L']] as const) {
      const formatted = formatMillilitersAsLiters(12345, locale, unit);
      expect(formatted).toContain('12.345');
      expect(formatted).not.toMatch(/[٠-٩]/);
    }
  });

  it('converts and presents minor units as Saudi riyals', () => {
    expect(riyalToMinor('10000.50')).toBe(1000050);
    expect(minorToRiyal(1000050)).toBe('10000.50');
    expect(formatMinorRiyal(1000050)).toContain('10,000.50');
    expect(minorToRiyal('invalid')).toBe('');
  });
});
