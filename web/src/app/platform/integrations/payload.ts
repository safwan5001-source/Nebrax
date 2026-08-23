export type IntegrationKey = 'document_storage' | 'malware_scanner' | 'document_processing' | 'document_ai';

export interface IntegrationFormState {
  enabled: boolean;
  provider: string;
  endpoint: string;
  bucket: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  use_path_style_endpoint: boolean;
  host: string;
  port: string;
  timeout_seconds: string;
  max_attempts: string;
  backoff_seconds: string;
  model: string;
  api_key: string;
  current_password: string;
}

export function payloadFor(key: IntegrationKey, form: IntegrationFormState): Record<string, unknown> {
  if (key === 'document_storage') return {
    enabled: form.enabled, provider: form.provider, endpoint: form.endpoint, bucket: form.bucket,
    region: form.region,
    ...(form.access_key_id ? { access_key_id: form.access_key_id } : {}),
    ...(form.secret_access_key ? { secret_access_key: form.secret_access_key } : {}),
    use_path_style_endpoint: form.use_path_style_endpoint,
    current_password: form.current_password,
  };
  if (key === 'malware_scanner') return {
    enabled: form.enabled, provider: form.provider, host: form.host,
    port: Number(form.port), timeout_seconds: Number(form.timeout_seconds), current_password: form.current_password,
  };
  if (key === 'document_processing') return {
    enabled: form.enabled, provider: 'redis', max_attempts: Number(form.max_attempts),
    timeout_seconds: Number(form.timeout_seconds),
    backoff_seconds: form.backoff_seconds.split(',').map((value) => Number(value.trim())).filter(Number.isFinite),
    current_password: form.current_password,
  };
  return {
    enabled: form.enabled, provider: form.provider, endpoint: form.endpoint || undefined,
    model: form.model || undefined, api_key: form.api_key || undefined, current_password: form.current_password,
  };
}
