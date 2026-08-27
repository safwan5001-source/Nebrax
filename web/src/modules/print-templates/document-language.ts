export const DOCUMENT_LANGUAGE_MODES = ['ar', 'en', 'bilingual'] as const;

export type DocumentLanguageMode = (typeof DOCUMENT_LANGUAGE_MODES)[number];

/**
 * Document language is a template/revision concern, independent from visual
 * composition (ERP / Modern / Minimal). Missing values intentionally preserve
 * historical revisions by falling back to the current UI locale.
 */
export function normalizeDocumentLanguageMode(
  value: unknown,
  fallbackLocale: string,
): DocumentLanguageMode {
  if (value === 'ar' || value === 'en' || value === 'bilingual') return value;
  return fallbackLocale === 'en' ? 'en' : 'ar';
}

export function documentLanguageDirection(mode: DocumentLanguageMode): 'rtl' | 'ltr' {
  return mode === 'en' ? 'ltr' : 'rtl';
}

export function isBilingualDocument(mode: DocumentLanguageMode): boolean {
  return mode === 'bilingual';
}
