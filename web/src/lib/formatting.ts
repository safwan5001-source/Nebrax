/**
 * Locale used when the interface is Arabic but numeric glyphs and dates must
 * remain Latin/Gregorian. The Unicode extensions make the intent explicit:
 * `ca-gregory` selects the Gregorian calendar and `nu-latn` selects 0–9.
 */
export const ARABIC_DISPLAY_LOCALE = 'ar-SA-u-ca-gregory-nu-latn';
export const ENGLISH_DISPLAY_LOCALE = 'en-GB-u-ca-gregory-nu-latn';

/**
 * Returns a safe display locale for dates and numbers without changing the
 * language used by the rest of the UI.
 */
export function displayLocale(locale?: string | null): string {
  return locale?.toLowerCase().startsWith('ar')
    ? ARABIC_DISPLAY_LOCALE
    : ENGLISH_DISPLAY_LOCALE;
}

/** Arabic is the application's default UI language, including for unscoped formatters. */
export const DISPLAY_LOCALE = ARABIC_DISPLAY_LOCALE;
