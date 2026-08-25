import { minorToRiyal, riyalToMinor } from '@/lib/money';

export type ComparisonMode = 'none' | 'previous-period' | 'previous-year';

export interface ComparisonRange {
  from: string;
  to: string;
}

export interface ComparativeAmount {
  current: string;
  comparison: string;
  variance: string;
  variancePercent: string | null;
}

export interface ComparableAccountRow {
  code: string;
  name: string;
  amount: string;
}

export interface ComparativeAccountRow {
  code: string;
  name: string;
  current: string;
  comparison: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseCalendarDate(input: string): CalendarDate | null {
  const match = ISO_DATE.exec(input);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function calendarDayNumber(date: CalendarDate): number {
  // UTC keeps the date arithmetic independent of local timezone and DST changes.
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}

function formatCalendarDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(input: string, days: number): string | null {
  const date = parseCalendarDate(input);
  if (!date || !Number.isInteger(days)) return null;
  return formatCalendarDate(new Date(Date.UTC(date.year, date.month - 1, date.day + days)));
}

export function subtractCalendarYear(input: string): string | null {
  const date = parseCalendarDate(input);
  if (!date) return null;

  const comparisonYear = date.year - 1;
  const lastDayOfMonth = new Date(Date.UTC(comparisonYear, date.month, 0)).getUTCDate();
  return formatCalendarDate(new Date(Date.UTC(comparisonYear, date.month - 1, Math.min(date.day, lastDayOfMonth))));
}

/** يرسم فترة سابقة متساوية في عدد الأيام وتنتهي قبل بداية الفترة الحالية مباشرةً. */
export function previousEqualLengthPeriod(current: ComparisonRange): ComparisonRange | null {
  const from = parseCalendarDate(current.from);
  const to = parseCalendarDate(current.to);
  if (!from || !to || calendarDayNumber(to) < calendarDayNumber(from)) return null;

  const length = calendarDayNumber(to) - calendarDayNumber(from) + 1;
  const comparisonFrom = addCalendarDays(current.from, -length);
  const comparisonTo = addCalendarDays(current.from, -1);
  return comparisonFrom && comparisonTo ? { from: comparisonFrom, to: comparisonTo } : null;
}

export function previousYearPeriod(current: ComparisonRange): ComparisonRange | null {
  const from = subtractCalendarYear(current.from);
  const to = subtractCalendarYear(current.to);
  return from && to ? { from, to } : null;
}

export function comparisonPeriod(mode: ComparisonMode, current: ComparisonRange): ComparisonRange | null {
  if (mode === 'previous-period') return previousEqualLengthPeriod(current);
  if (mode === 'previous-year') return previousYearPeriod(current);
  return null;
}

/** الميزانية لقطة حتى تاريخ؛ لا يتخيل تاريخاً سابقاً عندما يكون `from` غائباً. */
export function balanceComparisonAsOf(mode: ComparisonMode, current: { from: string; to: string }): string | null {
  if (!parseCalendarDate(current.to)) return null;
  if (mode === 'previous-year') return subtractCalendarYear(current.to);
  if (mode === 'previous-period' && parseCalendarDate(current.from)) return addCalendarDays(current.from, -1);
  return null;
}

function toMinor(value: string): bigint | null {
  const minor = riyalToMinor(value);
  return Number.isFinite(minor) ? BigInt(minor) : null;
}

function fromMinor(value: bigint): string {
  return minorToRiyal(value.toString());
}

/**
 * تغير عرضي فقط: لا يعيد أي رصيد محاسبي، بل يطرح مبلغين رسميين مستقلين بعد وصولهما
 * من endpoint الحالي. النسبة ذات منزلتين عشريتين وتبقى فارغة عند baseline صفري.
 */
export function compareAmounts(current: string, comparison: string): ComparativeAmount {
  const currentMinor = toMinor(current);
  const comparisonMinor = toMinor(comparison);
  if (currentMinor === null || comparisonMinor === null) {
    return { current, comparison, variance: '0.00', variancePercent: null };
  }

  const variance = currentMinor - comparisonMinor;
  if (comparisonMinor === 0n) {
    return { current, comparison, variance: fromMinor(variance), variancePercent: null };
  }

  const denominator = comparisonMinor < 0n ? -comparisonMinor : comparisonMinor;
  const numerator = variance < 0n ? -variance : variance;
  const hundredths = (numerator * 10_000n + denominator / 2n) / denominator;
  const integer = hundredths / 100n;
  const fraction = String(hundredths % 100n).padStart(2, '0');
  const sign = variance < 0n ? '-' : '';

  return {
    current,
    comparison,
    variance: fromMinor(variance),
    variancePercent: `${sign}${integer}.${fraction}%`,
  };
}

/**
 * اتحاد ثابت حسب account code. يحتفظ بترتيب الفترة الحالية ويضيف صفوف المقارنة فقط
 * في آخر القسم بترتيب الاستجابة الرسمية للمقارنة.
 */
export function unionAccountRows(current: ComparableAccountRow[], comparison: ComparableAccountRow[]): ComparativeAccountRow[] {
  const comparisonByCode = new Map(comparison.map((row) => [row.code, row]));
  const currentCodes = new Set(current.map((row) => row.code));

  return [
    ...current.map((row) => ({
      code: row.code,
      name: row.name,
      current: row.amount,
      comparison: comparisonByCode.get(row.code)?.amount ?? '0.00',
    })),
    ...comparison
      .filter((row) => !currentCodes.has(row.code))
      .map((row) => ({ code: row.code, name: row.name, current: '0.00', comparison: row.amount })),
  ];
}
