import { describe, expect, it } from 'vitest';
import { emptyDocumentAiForm } from './payload';
import { hydrateAiForm, isGoogleGeminiDirty } from './ai-form';

describe('hydrateAiForm', () => {
  it('restores Gemini enabled, model, and allow-document-sending without copying the API key', () => {
    const form = hydrateAiForm({
      enabled: true,
      configuration: {
        engine_enabled: true,
        primary_provider: 'google_gemini',
        providers: {
          google_gemini: {
            enabled: true,
            model: 'gemini-2.5-flash',
            allow_document_sending: true,
            api_key: 'should-never-reach-the-form',
            api_key_masked: '••••••••abcd',
            has_api_key: true,
            connection_timeout_seconds: 20,
            processing_timeout_seconds: 90,
            max_attempts: 3,
          },
        },
      },
    });

    expect(form.providers.google_gemini).toMatchObject({
      enabled: true,
      model: 'gemini-2.5-flash',
      allow_document_sending: true,
      api_key: '',
      clear_api_key: false,
      connection_timeout_seconds: '20',
      max_attempts: '3',
    });
    expect(JSON.stringify(form)).not.toContain('should-never-reach-the-form');
  });
});

describe('isGoogleGeminiDirty', () => {
  it('treats a hydrated form as clean when the API key input stays blank', () => {
    const persisted = hydrateAiForm({
      configuration: {
        providers: {
          google_gemini: { enabled: true, model: 'gemini-2.5-flash', allow_document_sending: true },
        },
      },
    });

    expect(isGoogleGeminiDirty(persisted, persisted)).toBe(false);
    expect(isGoogleGeminiDirty({ ...persisted, current_password: 'platform-password' }, persisted)).toBe(false);
  });

  it('becomes dirty when a new key is typed, clear-key is selected, or Gemini fields change', () => {
    const persisted = emptyDocumentAiForm();
    const typedKey = { ...persisted, providers: { ...persisted.providers, google_gemini: { ...persisted.providers.google_gemini, api_key: 'new-key' } } };
    const clearKey = { ...persisted, providers: { ...persisted.providers, google_gemini: { ...persisted.providers.google_gemini, clear_api_key: true } } };
    const model = { ...persisted, providers: { ...persisted.providers, google_gemini: { ...persisted.providers.google_gemini, model: 'gemini-2.5-flash' } } };
    const allow = { ...persisted, providers: { ...persisted.providers, google_gemini: { ...persisted.providers.google_gemini, allow_document_sending: true } } };

    expect(isGoogleGeminiDirty(typedKey, persisted)).toBe(true);
    expect(isGoogleGeminiDirty(clearKey, persisted)).toBe(true);
    expect(isGoogleGeminiDirty(model, persisted)).toBe(true);
    expect(isGoogleGeminiDirty(allow, persisted)).toBe(true);
  });
});
