import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GEMINI_DIAGNOSTIC_MESSAGE_KEYS,
  geminiDiagnosticMessage,
  geminiErrorCodeFromUnknown,
  geminiTestNoticeMessage,
} from './gemini-diagnostics';

describe('gemini diagnostics mapping', () => {
  const ar = JSON.parse(readFileSync(join(process.cwd(), 'src/messages/ar.json'), 'utf8')).platformIntegrations;
  const en = JSON.parse(readFileSync(join(process.cwd(), 'src/messages/en.json'), 'utf8')).platformIntegrations;

  it('maps every Gemini error code to Arabic and English copy', () => {
    const expectedAr: Record<string, string> = {
      geminiErrorApiKeyMissing: 'مفتاح Gemini غير محفوظ.',
      geminiErrorModelMissing: 'اسم نموذج Gemini مطلوب.',
      geminiErrorNetworkDisabled: 'اتصالات مزودي الذكاء الاصطناعي معطلة في مرحلة التأسيس الحالية.',
      geminiErrorAuthFailed: 'مفتاح Gemini غير صالح أو تم رفضه.',
      geminiErrorPermissionDenied: 'لا يملك المفتاح صلاحية استخدام Gemini API.',
      geminiErrorModelUnavailable: 'النموذج المحدد غير متاح لهذا المفتاح.',
      geminiErrorRateLimited: 'تم تجاوز حصة Gemini أو حد الطلبات.',
      geminiErrorTimeout: 'انتهت مهلة الاتصال بـ Gemini.',
      geminiErrorUpstreamUnavailable: 'تعذر الوصول إلى خدمة Gemini مؤقتًا.',
      geminiErrorInvalidResponse: 'أعاد Gemini استجابة غير مكتملة أو غير متوقعة.',
      geminiErrorConnectionFailed: 'تعذر إكمال اختبار اتصال Gemini.',
    };
    const expectedEn: Record<string, string> = {
      geminiErrorApiKeyMissing: 'The Gemini API key is not saved.',
      geminiErrorModelMissing: 'A Gemini model name is required.',
      geminiErrorNetworkDisabled: 'AI provider connections are disabled in the current bootstrap stage.',
      geminiErrorAuthFailed: 'The Gemini API key is invalid or was rejected.',
      geminiErrorPermissionDenied: 'This API key does not have permission to use the Gemini API.',
      geminiErrorModelUnavailable: 'The selected model is not available for this API key.',
      geminiErrorRateLimited: 'Gemini quota or rate limit was exceeded.',
      geminiErrorTimeout: 'The connection to Gemini timed out.',
      geminiErrorUpstreamUnavailable: 'The Gemini service is temporarily unavailable.',
      geminiErrorInvalidResponse: 'Gemini returned an incomplete or unexpected response.',
      geminiErrorConnectionFailed: 'The Gemini connection test could not be completed.',
    };

    for (const key of Object.values(GEMINI_DIAGNOSTIC_MESSAGE_KEYS)) {
      expect(ar[key]).toBe(expectedAr[key]);
      expect(en[key]).toBe(expectedEn[key]);
    }
  });

  it('localizes a successful test and known failure codes', () => {
    const t = (key: string) => en[key] ?? key;

    expect(geminiTestNoticeMessage(true, null, t)).toBe('Connection succeeded');
    expect(geminiTestNoticeMessage(false, 'gemini_auth_failed', t)).toBe('The Gemini API key is invalid or was rejected.');
    expect(geminiTestNoticeMessage(false, 'gemini_permission_denied', t)).toBe('This API key does not have permission to use the Gemini API.');
    expect(geminiDiagnosticMessage('gemini_model_unavailable', t)).toBe('The selected model is not available for this API key.');
    expect(geminiDiagnosticMessage('gemini_rate_limited', t)).toBe('Gemini quota or rate limit was exceeded.');
    expect(geminiDiagnosticMessage('gemini_timeout', t)).toBe('The connection to Gemini timed out.');
    expect(geminiDiagnosticMessage('gemini_upstream_unavailable', t)).toBe('The Gemini service is temporarily unavailable.');
    expect(geminiDiagnosticMessage('gemini_invalid_response', t)).toBe('Gemini returned an incomplete or unexpected response.');
    expect(geminiDiagnosticMessage('not_a_real_code', t)).toBe('Connection failed');
    expect(geminiDiagnosticMessage(null, t)).toBe('Connection failed');
  });

  it('reads a safe error code from an API error body without using upstream text', () => {
    const reason = {
      body: {
        data: {
          ok: false,
          message: 'مفتاح Gemini غير صالح أو تم رفضه.',
          error_code: 'gemini_auth_failed',
        },
      },
    };

    expect(geminiErrorCodeFromUnknown(reason)).toBe('gemini_auth_failed');
    expect(geminiErrorCodeFromUnknown(new Error('gemini-test-secret-abcd'))).toBeNull();
  });
});
