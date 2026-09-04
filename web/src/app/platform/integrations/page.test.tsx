import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('omits a blank Gemini API key so a later save keeps the stored secret', () => {
    const ai = emptyDocumentAiForm();
    ai.current_password = 'platform-password-123';
    ai.providers.google_gemini = {
      ...ai.providers.google_gemini,
      enabled: true,
      model: 'gemini-2.5-flash',
      allow_document_sending: true,
      api_key: '',
      clear_api_key: false,
    };

    const payload = payloadFor('document_ai', ai);
    const gemini = (payload.providers as Record<string, Record<string, unknown>>).google_gemini;

    expect(gemini).toMatchObject({
      enabled: true,
      model: 'gemini-2.5-flash',
      allow_document_sending: true,
      clear_api_key: false,
    });
    expect(gemini).not.toHaveProperty('api_key');
  });

  it('exposes Arabic and English Gemini save/test strings', () => {
    const ar = JSON.parse(readFileSync(join(process.cwd(), 'src/messages/ar.json'), 'utf8')).platformIntegrations;
    const en = JSON.parse(readFileSync(join(process.cwd(), 'src/messages/en.json'), 'utf8')).platformIntegrations;
    const keys = [
      'saveSettings',
      'saving',
      'savedSuccessfully',
      'saveBeforeTest',
      'testConnection',
      'testing',
      'connectionSucceeded',
      'connectionFailed',
      'geminiErrorAuthFailed',
      'geminiErrorPermissionDenied',
      'geminiErrorModelUnavailable',
      'geminiErrorRateLimited',
      'geminiErrorTimeout',
      'geminiErrorUpstreamUnavailable',
    ] as const;

    for (const key of keys) {
      expect(ar[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
    expect(ar.saveSettings).toBe('حفظ الإعدادات');
    expect(en.saveSettings).toBe('Save settings');
    expect(ar.saveBeforeTest).toBe('احفظ التغييرات قبل اختبار الاتصال');
    expect(en.saveBeforeTest).toBe('Save changes before testing');
    expect(ar.geminiErrorAuthFailed).toBe('مفتاح Gemini غير صالح أو تم رفضه.');
    expect(en.geminiErrorAuthFailed).toBe('The Gemini API key is invalid or was rejected.');
    expect(ar.geminiErrorPermissionDenied).toBe('لا يملك المفتاح صلاحية استخدام Gemini API.');
    expect(en.geminiErrorPermissionDenied).toBe('This API key does not have permission to use the Gemini API.');
    expect(ar.geminiErrorModelUnavailable).toBe('النموذج المحدد غير متاح لهذا المفتاح.');
    expect(en.geminiErrorModelUnavailable).toBe('The selected model is not available for this API key.');
    expect(ar.geminiErrorRateLimited).toBe('تم تجاوز حصة Gemini أو حد الطلبات.');
    expect(en.geminiErrorRateLimited).toBe('Gemini quota or rate limit was exceeded.');
    expect(ar.geminiErrorTimeout).toBe('انتهت مهلة الاتصال بـ Gemini.');
    expect(en.geminiErrorTimeout).toBe('The connection to Gemini timed out.');
    expect(ar.geminiErrorUpstreamUnavailable).toBe('تعذر الوصول إلى خدمة Gemini مؤقتًا.');
    expect(en.geminiErrorUpstreamUnavailable).toBe('The Gemini service is temporarily unavailable.');
  });
});
