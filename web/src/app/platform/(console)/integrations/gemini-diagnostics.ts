export const GEMINI_DIAGNOSTIC_MESSAGE_KEYS = {
  gemini_api_key_missing: 'geminiErrorApiKeyMissing',
  gemini_model_missing: 'geminiErrorModelMissing',
  gemini_provider_network_disabled: 'geminiErrorNetworkDisabled',
  gemini_auth_failed: 'geminiErrorAuthFailed',
  gemini_permission_denied: 'geminiErrorPermissionDenied',
  gemini_model_unavailable: 'geminiErrorModelUnavailable',
  gemini_rate_limited: 'geminiErrorRateLimited',
  gemini_timeout: 'geminiErrorTimeout',
  gemini_upstream_unavailable: 'geminiErrorUpstreamUnavailable',
  gemini_invalid_response: 'geminiErrorInvalidResponse',
  gemini_connection_failed: 'geminiErrorConnectionFailed',
} as const;

export type GeminiDiagnosticCode = keyof typeof GEMINI_DIAGNOSTIC_MESSAGE_KEYS;

type Translate = (key: string) => string;

export function isGeminiDiagnosticCode(value: unknown): value is GeminiDiagnosticCode {
  return typeof value === 'string' && value in GEMINI_DIAGNOSTIC_MESSAGE_KEYS;
}

export function geminiDiagnosticMessage(
  errorCode: string | null | undefined,
  t: Translate,
  fallbackKey = 'connectionFailed',
): string {
  if (!isGeminiDiagnosticCode(errorCode)) {
    return t(fallbackKey);
  }

  return t(GEMINI_DIAGNOSTIC_MESSAGE_KEYS[errorCode]);
}

export function geminiTestNoticeMessage(
  ok: boolean,
  errorCode: string | null | undefined,
  t: Translate,
): string {
  if (ok) {
    return t('connectionSucceeded');
  }

  return geminiDiagnosticMessage(errorCode, t);
}

export function geminiErrorCodeFromUnknown(reason: unknown): string | null {
  if (typeof reason !== 'object' || reason === null || !('body' in reason)) {
    return null;
  }

  const body = (reason as { body?: unknown }).body;
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const data = 'data' in body ? (body as { data?: unknown }).data : body;
  if (typeof data !== 'object' || data === null || !('error_code' in data)) {
    return null;
  }

  const code = (data as { error_code?: unknown }).error_code;

  return typeof code === 'string' ? code : null;
}
