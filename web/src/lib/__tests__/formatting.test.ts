import { describe, expect, it } from 'vitest';
import {
  ARABIC_DISPLAY_LOCALE,
  DISPLAY_LOCALE,
  ENGLISH_DISPLAY_LOCALE,
  displayLocale,
  formatDate,
  formatDateTime,
  formatLongDate,
  formatShortDate,
  formatTime,
  parseDisplayDate,
} from '../formatting';

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const FIXED_MORNING = '2026-08-29T01:00:00';
const FIXED_EVENING = '2026-08-29T13:00:00';
const FIXED_DATE = '2026-08-29';

describe('display formatting locale', () => {
  it('keeps Arabic UI while explicitly requesting Gregorian dates and Latin digits', () => {
    expect(displayLocale('ar')).toBe(ARABIC_DISPLAY_LOCALE);
    expect(ARABIC_DISPLAY_LOCALE).toContain('ca-gregory');
    expect(ARABIC_DISPLAY_LOCALE).toContain('nu-latn');
    expect(displayLocale('en')).toBe(ENGLISH_DISPLAY_LOCALE);
    expect(DISPLAY_LOCALE).toBe(ARABIC_DISPLAY_LOCALE);
  });

  it('uses Latin digits for Arabic-locale numbers and for unscoped formatters', () => {
    const arabicNumber = new Intl.NumberFormat(ARABIC_DISPLAY_LOCALE).format(1234567890);
    const defaultNumber = new Intl.NumberFormat(DISPLAY_LOCALE).format(1234567890);

    expect(arabicNumber).toMatch(/1/);
    expect(defaultNumber).toMatch(/1/);
    expect(arabicNumber).not.toMatch(ARABIC_INDIC);
    expect(defaultNumber).not.toMatch(ARABIC_INDIC);
  });
});

describe('central Gregorian + Latin date formatter', () => {
  it('formats Arabic dates as Gregorian with Latin digits only', () => {
    const date = formatDate(FIXED_DATE, 'ar');

    expect(date).toContain('2026');
    expect(date).toContain('29');
    expect(date).toContain('08');
    expect(date).not.toMatch(ARABIC_INDIC);
    expect(date).not.toMatch(/هـ/);
    expect(date).not.toMatch(/محرم|صفر|رمضان|شوال/);
  });

  it('formats Arabic date-time with صباحًا / مساءً and without AM/PM', () => {
    const morning = formatDateTime(FIXED_MORNING, 'ar');
    const evening = formatDateTime(FIXED_EVENING, 'ar');

    expect(morning).toContain('صباحًا');
    expect(evening).toContain('مساءً');
    expect(morning).not.toMatch(/\bAM\b|\bPM\b/);
    expect(evening).not.toMatch(/\bAM\b|\bPM\b/);
    expect(morning).not.toMatch(ARABIC_INDIC);
    expect(evening).not.toMatch(ARABIC_INDIC);
    expect(morning).toContain('2026');
  });

  it('formats Arabic time-only with صباحًا / مساءً', () => {
    expect(formatTime(FIXED_MORNING, 'ar')).toContain('صباحًا');
    expect(formatTime(FIXED_EVENING, 'ar')).toContain('مساءً');
    expect(formatTime(FIXED_EVENING, 'ar')).not.toMatch(/\bAM\b|\bPM\b/);
  });

  it('formats English dates as Gregorian with Latin digits and AM/PM', () => {
    const date = formatDate(FIXED_DATE, 'en');
    const morning = formatDateTime(FIXED_MORNING, 'en');
    const evening = formatDateTime(FIXED_EVENING, 'en');

    expect(date).toContain('2026');
    expect(date).not.toMatch(ARABIC_INDIC);
    expect(morning).toMatch(/\bAM\b/);
    expect(evening).toMatch(/\bPM\b/);
    expect(morning).not.toMatch(/صباحًا|مساءً/);
    expect(evening).not.toMatch(/صباحًا|مساءً/);
  });

  it('does not shift date-only calendar days across timezones', () => {
    const parsed = parseDisplayDate(FIXED_DATE);
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(7);
    expect(parsed!.getDate()).toBe(29);

    const formatted = formatDate(FIXED_DATE, 'ar');
    expect(formatted).toContain('29');
    expect(formatted).toContain('08');
    expect(formatted).toContain('2026');
  });

  it('returns the empty fallback for nullish values', () => {
    expect(formatDate(null, 'ar')).toBe('—');
    expect(formatDateTime(undefined, 'en')).toBe('—');
    expect(formatTime('', 'ar')).toBe('—');
    expect(formatDate(null, 'ar', { fallback: '' })).toBe('');
  });

  it('supports long and short styles without Hijri or Eastern digits', () => {
    const longAr = formatLongDate(FIXED_DATE, 'ar');
    const shortEn = formatShortDate(FIXED_DATE, 'en');

    expect(longAr).toContain('أغسطس');
    expect(longAr).toContain('2026');
    expect(longAr).not.toMatch(ARABIC_INDIC);
    expect(shortEn).toContain('2026');
    expect(shortEn).not.toMatch(ARABIC_INDIC);
  });
});
