import { describe, expect, it } from 'vitest';
import { normalizeLanguageAwareTemplateDefinition } from './template-definition-language';

describe('normalizeLanguageAwareTemplateDefinition', () => {
  it('keeps an explicit language mode independent from template style', () => {
    const definition = normalizeLanguageAwareTemplateDefinition(
      { template_id: 'tax-invoice-erp', language_mode: 'bilingual' },
      'tax_invoice',
      'en',
    );

    expect(definition.template_id).toBe('tax-invoice-erp');
    expect(definition.language_mode).toBe('bilingual');
  });

  it('falls back to the current locale for historical revisions without language_mode', () => {
    expect(normalizeLanguageAwareTemplateDefinition({}, 'quotation', 'ar').language_mode).toBe('ar');
    expect(normalizeLanguageAwareTemplateDefinition({}, 'quotation', 'en').language_mode).toBe('en');
  });

  it('supplies a valid default layout without changing document semantics', () => {
    const definition = normalizeLanguageAwareTemplateDefinition(undefined, 'delivery_note', 'ar');
    expect(definition.layout.length).toBeGreaterThan(0);
    expect(definition.language_mode).toBe('ar');
  });
});
