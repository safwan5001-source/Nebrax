import { utcIsoToZonedWallTime } from '@/lib/timezone';
import type { Label, ReportColumn, SummaryItem } from './schemas';

/**
 * تنسيق وحدات التقارير للعرض — **أعداد صحيحة فقط** (لا float)، والأرقام 0–9 دائماً. مرآة `App\Support\FuelReportFormatter` في الخادم:
 * متجهات الاختبار نفسها تضمن تطابق الشاشة وPDF مع Excel وCSV. الفرق الوحيد: العرض يضيف فاصل آلاف.
 */

export type Lang = 'ar' | 'en';

function scaled(value: number, divisor: number, decimals: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${Math.trunc(abs / divisor)}.${String(abs % divisor).padStart(decimals, '0')}`;
}

/** نص عشري بلا فواصل — هو ما يكتبه الخادم في الملفات. */
export const plainLiters = (milliliters: number): string => scaled(milliliters, 1000, 3);
export const plainMoney = (minor: number): string => scaled(minor, 100, 2);
export const plainPercent = (bp: number): string => scaled(bp, 100, 2);

export function group(decimal: string): string {
  const negative = decimal.startsWith('-');
  const [whole, fraction] = decimal.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

export const litersText = (ml: number): string => group(plainLiters(ml));
export const moneyText = (minor: number): string => group(plainMoney(minor));
export const percentText = (bp: number): string => `${plainPercent(bp)}%`;

/** لحظة ISO ← "YYYY-MM-DD HH:mm" بمنطقة التقرير (لا منطقة المتصفح) عبر مساعد المناطق الزمنية المركزي `lib/timezone` (حارس تنسيق التواريخ). */
export function dateTimeText(iso: string | null | undefined, timezone: string): string {
  if (!iso) return '—';
  const wall = utcIsoToZonedWallTime(iso, timezone);
  return wall === null ? '—' : `${wall.date} ${wall.time}`;
}

export function cellText(column: Pick<ReportColumn, 'type' | 'values'>, value: unknown, lang: Lang, timezone: string): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (column.type) {
    case 'liters': return litersText(Number(value));
    case 'money': return moneyText(Number(value));
    case 'bp': return percentText(Number(value));
    case 'int': return String(Number(value));
    case 'datetime': return dateTimeText(String(value), timezone);
    case 'status': return column.values?.[String(value)]?.[lang] ?? String(value);
    default: return String(value);
  }
}

export function summaryText(item: SummaryItem, lang: Lang, timezone: string): string {
  if (item.value === null) return '—';
  if (item.type === 'text') return String(item.value);
  return cellText({ type: item.type }, item.value, lang, timezone);
}

export const pick = (label: Label, lang: Lang): string => label[lang];
