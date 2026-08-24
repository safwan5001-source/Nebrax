import { describe, expect, it } from 'vitest';
import { emptyDocumentAiForm, payloadFor } from './payload';

const form = {
  enabled: true,
  provider: 'r2',
  endpoint: 'https://account.r2.cloudflarestorage.com',
  bucket: 'private-documents',
  region: 'auto',
  access_key_id: '',
  secret_access_key: '',
  use_path_style_endpoint: true,
  host: '',
  port: '3310',
  timeout_seconds: '75',
  max_attempts: '4',
  backoff_seconds: '15, 60, 180',
  model: '',
  api_key: '',
  current_password: 'platform-password-123',
};

describe('platform integration payloads', () => {
  it('omits blank storage secrets so the backend preserves the encrypted values', () => {
    const payload = payloadFor('document_storage', form);

    expect(payload).not.toHaveProperty('access_key_id');
    expect(payload).not.toHaveProperty('secret_access_key');
    expect(payload.bucket).toBe('private-documents');
  });

  it('normalizes numeric processing policy values', () => {
    const payload = payloadFor('document_processing', form);

    expect(payload).toMatchObject({
      provider: 'redis',
      max_attempts: 4,
      timeout_seconds: 75,
      backoff_seconds: [15, 60, 180],
    });
  });

  it('preserves blank provider keys and serializes the declared primary and fallback order', () => {
    const ai = emptyDocumentAiForm();
    ai.enabled = true;
    ai.primary_provider = 'google_gemini';
    ai.fallback_enabled = true;
    ai.fallback_providers = ['openai', 'anthropic'];
    ai.current_password = 'platform-password-123';
    ai.providers.google_gemini = { ...ai.providers.google_gemini, enabled: true, model: 'gemini-test', api_key: 'gemini-secret', allow_document_sending: true };
    ai.providers.openai = { ...ai.providers.openai, enabled: true, model: 'gpt-test', allow_document_sending: true };
    ai.providers.anthropic = { ...ai.providers.anthropic, enabled: true, model: 'claude-test', allow_document_sending: true };

    const payload = payloadFor('document_ai', ai);

    expect(payload).toMatchObject({
      enabled: true,
      primary_provider: 'google_gemini',
      fallback_providers: ['openai', 'anthropic'],
    });
    expect(payload.providers).toMatchObject({
      google_gemini: { api_key: 'gemini-secret', processing_timeout_seconds: 90 },
      openai: { enabled: true, model: 'gpt-test' },
    });
    expect((payload.providers as Record<string, Record<string, unknown>>).openai).not.toHaveProperty('api_key');
  });
});
