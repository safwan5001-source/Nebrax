import { describe, expect, it } from 'vitest';
import type { DocumentModel } from '@/modules/documents/types';
import { applyDocumentLanguageToPreview } from './document-language-preview';

const MODEL = {
  type: 'tax_invoice',
  currency: 'SAR',
  direction: 'rtl',
  seller: { name: 'شركة تجريبية' },
  buyer: { name: 'عميل تجريبي' },
  meta: { number: 'INV-1', date: '2026-08-26' },
  lines: [],
  totals: { subtotal: 100, tax: 15, total: 115 },
} satisfies DocumentModel;

describe('language-aware document preview', () => {
  it('uses RTL for Arabic', () => {
    expect(applyDocumentLanguageToPreview(MODEL, 'ar').direction).toBe('rtl');
  });

  it('uses LTR for English', () => {
    expect(applyDocumentLanguageToPreview(MODEL, 'en').direction).toBe('ltr');
  });

  it('keeps bilingual documents RTL-first', () => {
    expect(applyDocumentLanguageToPreview(MODEL, 'bilingual').direction).toBe('rtl');
  });

  it('does not mutate financial values or the source model', () => {
    const preview = applyDocumentLanguageToPreview(MODEL, 'en');
    expect(preview.totals).toEqual(MODEL.totals);
    expect(preview.type).toBe(MODEL.type);
    expect(MODEL.direction).toBe('rtl');
  });
});
