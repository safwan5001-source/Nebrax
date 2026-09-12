/**
 * Nebrax display formatting — Gregorian calendar + Latin digits (0–9).
 *
 * All user-visible dates and times in the web UI must go through this module.
 * Do not call `toLocaleString` / `Intl.DateTimeFormat` with bare `ar-SA` (or the
 * browser default): Safari and some ICU builds then emit Hijri months and/or
 * Eastern Arabic digits (٠١٢٣٤٥٦٧٨٩).
 *
 * Arabic day periods are normalized to «صباحًا» / «مساءً».
 * English day periods are normalized to «AM» / «PM».
 */

/** Arabic UI with explicit Gregorian calendar and Latin numbering. */
export const ARABIC_DISPLAY_LOCALE = 'ar-SA-u-ca-gregory-nu-latn';
/** English UI with explicit Gregorian calendar and Latin numbering. */
export const ENGLISH_DISPLAY_LOCALE = 'en-GB-u-ca-gregory-nu-latn';

/** Arabic is the application's default UI language, including for unscoped formatters. */
export const DISPLAY_LOCALE = ARABIC_DISPLAY_LOCALE;

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;
const HIJRI_MARKERS = /هـ|محرم|صفر|ربيع|جماد|رجب|شعبان|رمضان|شوال|ذو القعدة|ذو الحجة|Muharram|Safar|Rabi|Jumada|Rajab|Shaʿban|Ramadan|Shawwal|Dhul/i;

const BASE_OPTIONS: Intl.DateTimeFormatOptions = {
  calendar: 'gregory',
  numberingSystem: 'latn',
};

export type DisplayLocaleInput = string | null | undefined;

/**
 * Returns a safe display locale for dates and numbers without changing the
 * language used by the rest of the UI.
 */
export function displayLocale(locale?: DisplayLocaleInput): string {
  return isArabicLocale(locale) ? ARABIC_DISPLAY_LOCALE : ENGLISH_DISPLAY_LOCALE;
}

export function isArabicLocale(locale?: DisplayLocaleInput): boolean {
  return (locale ?? 'ar').toLowerCase().startsWith('ar');
}

export type DateInput = string | number | Date | null | undefined;

/**
 * Parses a display value without inventing a new timezone policy.
 * Date-only ISO (`YYYY-MM-DD`) is anchored at local noon so the calendar day
 * does not slip when the host offset is west of UTC.
 */
export function parseDisplayDate(value: DateInput): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
      ? date
      : null;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function assertSafeDateOutput(formatted: string): string {
  if (ARABIC_INDIC_DIGITS.test(formatted) || HIJRI_MARKERS.test(formatted)) {
    // Defensive: never ship Eastern digits or Hijri labels to the UI.
    return formatted
      .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit).toString())
      .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit).toString());
  }
  return formatted;
}

function isAmPeriod(value: string, date: Date): boolean {
  const normalized = value.replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim().toLowerCase();
  if (!normalized) return date.getHours() < 12;
  if (/^(am|a\.m\.|ص|ص\.|صباح)/.test(normalized) || /فجر|ليل/.test(normalized)) return true;
  if (/^(pm|p\.m\.|م|م\.|مساء)/.test(normalized) || /ظهر|عصر|مغرب/.test(normalized)) return false;
  return date.getHours() < 12;
}

function normalizeDayPeriod(value: string, date: Date, arabic: boolean): string {
  const am = isAmPeriod(value, date);
  if (arabic) return am ? 'صباحًا' : 'مساءً';
  return am ? 'AM' : 'PM';
}

function formatWithParts(
  date: Date,
  locale: DisplayLocaleInput,
  options: Intl.DateTimeFormatOptions,
): string {
  const arabic = isArabicLocale(locale);
  const formatter = new Intl.DateTimeFormat(displayLocale(locale), {
    ...BASE_OPTIONS,
    ...options,
  });

  const formatted = formatter.formatToParts(date).map((part) => {
    if (part.type === 'dayPeriod') {
      return normalizeDayPeriod(part.value, date, arabic);
    }
    return part.value;
  }).join('');

  return assertSafeDateOutput(formatted);
}

export type FormatDateOptions = {
  /** Override empty/invalid fallback. Default: «—». */
  fallback?: string;
  style?: 'short' | 'medium' | 'long';
};

/**
 * Date only (no time). Safe for invoice/due/document calendar dates.
 */
export function formatDate(
  value: DateInput,
  locale?: DisplayLocaleInput,
  options: FormatDateOptions = {},
): string {
  const fallback = options.fallback ?? '—';
  const date = parseDisplayDate(value);
  if (!date) return fallback;

  const style = options.style ?? 'medium';
  return formatWithParts(date, locale, {
    dateStyle: style,
  });
}

/**
 * Long date (weekday/month name style) — still Gregorian + Latin digits.
 */
export function formatLongDate(
  value: DateInput,
  locale?: DisplayLocaleInput,
  options: FormatDateOptions = {},
): string {
  return formatDate(value, locale, { ...options, style: 'long' });
}

/**
 * Short numeric date — still Gregorian + Latin digits.
 */
export function formatShortDate(
  value: DateInput,
  locale?: DisplayLocaleInput,
  options: FormatDateOptions = {},
): string {
  return formatDate(value, locale, { ...options, style: 'short' });
}

export type FormatTimeOptions = {
  fallback?: string;
};

/**
 * Time only with Arabic «صباحًا/مساءً» or English «AM/PM».
 */
export function formatTime(
  value: DateInput,
  locale?: DisplayLocaleInput,
  options: FormatTimeOptions = {},
): string {
  const fallback = options.fallback ?? '—';
  const date = parseDisplayDate(value);
  if (!date) return fallback;

  return formatWithParts(date, locale, {
    timeStyle: 'short',
    hour12: true,
  });
}

export type FormatDateTimeOptions = {
  fallback?: string;
  dateStyle?: 'short' | 'medium' | 'long';
  timeStyle?: 'short' | 'medium';
};

/**
 * Date + time. Default table/detail style for timestamps (`created_at`, audit, etc.).
 */
export function formatDateTime(
  value: DateInput,
  locale?: DisplayLocaleInput,
  options: FormatDateTimeOptions = {},
): string {
  const fallback = options.fallback ?? '—';
  const date = parseDisplayDate(value);
  if (!date) return fallback;

  return formatWithParts(date, locale, {
    dateStyle: options.dateStyle ?? 'medium',
    timeStyle: options.timeStyle ?? 'short',
    hour12: true,
  });
}

/**
 * Alias kept for DataTable / list cells that historically called a local helper.
 */
export function formatDateForTable(
  value: DateInput,
  locale?: DisplayLocaleInput,
): string {
  return formatDateTime(value, locale);
}

/**
 * Month label for pickers — Gregorian month name, Latin year digits when present.
 */
export function formatMonthName(
  year: number,
  monthIndex: number,
  locale?: DisplayLocaleInput,
  style: 'long' | 'short' = 'long',
): string {
  return formatWithParts(new Date(year, monthIndex, 1), locale, {
    month: style,
  });
}
