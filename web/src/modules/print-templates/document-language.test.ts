import { describe, expect, it } from 'vitest';
import {
  documentLanguageDirection,
  isBilingualDocument,
  normalizeDocumentLanguageMode,
} from './document-language';

describe('document language contract', () => {
  it('accepts the three supported language modes', () => {
    expect(normalizeDocumentLanguageMode('ar', 'en')).toBe('ar');
    expect(normalizeDocumentLanguageMode('en', 'ar')).toBe('en');
    expect(normalizeDocumentLanguageMode('bilingual', 'en')).toBe('bilingual');
  });

  it('preserves historical definitions without language_mode by using UI locale', () => {
    expect(normalizeDocumentLanguageMode(undefined, 'ar')).toBe('ar');
    expect(normalizeDocumentLanguageMode(undefined, 'en')).toBe('en');
    expect(normalizeDocumentLanguageMode('legacy', 'ar')).toBe('ar');
  });

  it('mirrors English while keeping Arabic and bilingual RTL-first', () => {
    expect(documentLanguageDirection('ar')).toBe('rtl');
    expect(documentLanguageDirection('en')).toBe('ltr');
    expect(documentLanguageDirection('bilingual')).toBe('rtl');
  });

  it('detects bilingual mode explicitly', () => {
    expect(isBilingualDocument('bilingual')).toBe(true);
    expect(isBilingualDocument('ar')).toBe(false);
    expect(isBilingualDocument('en')).toBe(false);
  });
});
