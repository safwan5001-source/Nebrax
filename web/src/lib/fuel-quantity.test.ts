import { describe, expect, it } from 'vitest';
import { formatLiters, litersToMilliliters, millilitersToLiters } from './fuel-quantity';
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

  it('converts and presents minor units as Saudi riyals', () => {
    expect(riyalToMinor('10000.50')).toBe(1000050);
    expect(minorToRiyal(1000050)).toBe('10000.50');
    expect(formatMinorRiyal(1000050)).toContain('10,000.50');
    expect(minorToRiyal('invalid')).toBe('');
  });
});
