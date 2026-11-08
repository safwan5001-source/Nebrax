import { describe, expect, it } from 'vitest';
import { cellText, dateTimeText, group, litersText, moneyText, percentText, plainLiters, plainMoney, plainPercent, summaryText } from './format';

/** متجهات مشتركة مع `FuelReportFormatter` في الخادم: الأرقام نفسها في الشاشة وPDF وExcel وCSV (الفرق الوحيد فاصل الآلاف في العرض). */
const VECTORS: Array<[number, string, string, string]> = [
  // [قيمة صحيحة, لترات, ريال, نسبة]
  [0, '0.000', '0.00', '0.00'],
  [1, '0.001', '0.01', '0.01'],
  [5, '0.005', '0.05', '0.05'],
  [99, '0.099', '0.99', '0.99'],
  [100, '0.100', '1.00', '1.00'],
  [23_000, '23.000', '230.00', '230.00'],
  [100_000, '100.000', '1000.00', '1000.00'],
  [-550, '-0.550', '-5.50', '-5.50'],
  [-1_500, '-1.500', '-15.00', '-15.00'],
  [1_234_567_890, '1234567.890', '12345678.90', '12345678.90'],
];

describe('تنسيق وحدات التقارير بأعداد صحيحة', () => {
  it.each(VECTORS)('%i ← لتر/ريال/نسبة', (value, liters, money, percent) => {
    expect(plainLiters(value)).toBe(liters);
    expect(plainMoney(value)).toBe(money);
    expect(plainPercent(value)).toBe(percent);
  });

  it('العرض = النص الخام + فاصل آلاف فقط (لا تغيير في القيمة)', () => {
    for (const [value] of VECTORS) {
      expect(litersText(value).replaceAll(',', '')).toBe(plainLiters(value));
      expect(moneyText(value).replaceAll(',', '')).toBe(plainMoney(value));
    }
    expect(group('-1234567.89')).toBe('-1,234,567.89');
    expect(percentText(1500)).toBe('15.00%');
  });

  it('الأرقام 0–9 دائماً (لا هندية) في كل لغة', () => {
    const column = { type: 'money' as const };
    expect(cellText(column, 12345, 'ar', 'Asia/Riyadh')).toMatch(/^[0-9,.\-]+$/);
    expect(cellText({ type: 'int' }, 7, 'ar', 'Asia/Riyadh')).toBe('7');
    expect(dateTimeText('2027-03-11T10:00:00+00:00', 'Asia/Riyadh')).toMatch(/^[0-9\-: ]+$/);
  });

  it('التاريخ بمنطقة التقرير لا منطقة المتصفح: 22:30 UTC = 01:30 الرياض لليوم التالي', () => {
    expect(dateTimeText('2027-03-10T22:30:00+00:00', 'Asia/Riyadh')).toBe('2027-03-11 01:30');
    expect(dateTimeText('2027-03-10T22:30:00+00:00', 'UTC')).toBe('2027-03-10 22:30');
    expect(dateTimeText(null, 'UTC')).toBe('—');
  });

  it('القيمة الغائبة تُعرض «—» لا صفراً، والحالة تُترجم من قيم العمود', () => {
    expect(cellText({ type: 'money' }, null, 'ar', 'UTC')).toBe('—');
    expect(cellText({ type: 'status', values: { open: { ar: 'مفتوحة', en: 'Open' } } }, 'open', 'en', 'UTC')).toBe('Open');
    expect(cellText({ type: 'status', values: {} }, 'weird', 'ar', 'UTC')).toBe('weird');
    expect(summaryText({ key: 'k', label: { ar: 'ك', en: 'k' }, type: 'text', value: 'نص' }, 'ar', 'UTC')).toBe('نص');
    expect(summaryText({ key: 'k', label: { ar: 'ك', en: 'k' }, type: 'money', value: null }, 'ar', 'UTC')).toBe('—');
  });
});
