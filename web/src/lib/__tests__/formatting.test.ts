import { describe, expect, it } from 'vitest';
import { ARABIC_DISPLAY_LOCALE, DISPLAY_LOCALE, displayLocale } from '../formatting';

describe('display formatting locale', () => {
  it('keeps Arabic UI while explicitly requesting Gregorian dates and Latin digits', () => {
    expect(displayLocale('ar')).toBe(ARABIC_DISPLAY_LOCALE);
    expect(ARABIC_DISPLAY_LOCALE).toContain('ca-gregory');
    expect(ARABIC_DISPLAY_LOCALE).toContain('nu-latn');

    const date = new Intl.DateTimeFormat(ARABIC_DISPLAY_LOCALE, {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date('2026-08-24T12:00:00.000Z'));

    expect(date).toContain('2026');
    expect(date).not.toMatch(/[٠-٩]/);
  });

  it('uses Latin digits for Arabic-locale numbers and for unscoped formatters', () => {
    const arabicNumber = new Intl.NumberFormat(ARABIC_DISPLAY_LOCALE).format(1234567890);
    const defaultNumber = new Intl.NumberFormat(DISPLAY_LOCALE).format(1234567890);

    expect(arabicNumber).toMatch(/1/);
    expect(defaultNumber).toMatch(/1/);
    expect(arabicNumber).not.toMatch(/[٠-٩]/);
    expect(defaultNumber).not.toMatch(/[٠-٩]/);
  });

  it('uses an English Gregorian locale when the UI language is English', () => {
    expect(displayLocale('en')).toBe('en-GB-u-ca-gregory-nu-latn');
  });
});
