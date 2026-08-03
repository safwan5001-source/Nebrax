import { describe, expect, it } from 'vitest';
import { formatMoney, makeMoneyFormatter } from './currency';

describe('formatMoney', () => {
  it('formats SAR (2 dp, suffix symbol) matching the app money layer', () => {
    expect(formatMoney(100000, 'SAR')).toBe('1,000.00 ﷼');
    expect(formatMoney(115050, 'SAR')).toBe('1,150.50 ﷼');
    expect(formatMoney(0, 'SAR')).toBe('0.00 ﷼');
  });

  it('places prefix currencies before the number', () => {
    expect(formatMoney(100050, 'USD')).toBe('$ 1,000.50');
    expect(formatMoney(100050, 'EUR')).toBe('€ 1,000.50');
  });

  it('honours 3-decimal Gulf currencies (suffix symbol)', () => {
    expect(formatMoney(1234567, 'KWD')).toBe('1,234.567 د.ك');
    expect(formatMoney(1000, 'BHD')).toBe('1.000 د.ب');
  });

  it('honours 0-decimal currencies (JPY)', () => {
    expect(formatMoney(1500, 'JPY')).toBe('¥ 1,500');
  });

  it('falls back to SAR for unknown codes and to em-dash for NaN', () => {
    // @ts-expect-error اختبار كود غير معروف
    expect(formatMoney(100000, 'XXX')).toBe('1,000.00 ﷼');
    expect(formatMoney(Number.NaN, 'SAR')).toBe('—');
  });

  it('makeMoneyFormatter binds a currency', () => {
    const sar = makeMoneyFormatter('SAR');
    expect(sar(50000)).toBe('500.00 ﷼');
  });
});
