export type IntegrationKey = 'document_storage' | 'malware_scanner' | 'document_processing' | 'document_ai';
export type AiProviderKey = 'openai' | 'anthropic' | 'google_gemini';

export const AI_PROVIDER_KEYS: AiProviderKey[] = ['openai', 'anthropic', 'google_gemini'];

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

export interface AiProviderFormState {
  enabled: boolean;
  api_key: string;
  clear_api_key: boolean;
  model: string;
  connection_timeout_seconds: string;
  processing_timeout_seconds: string;
  max_attempts: string;
  allow_document_sending: boolean;
  monthly_operation_limit: string;
  monthly_page_limit: string;
  data_region: string;
  retention_policy: string;
}

export interface DocumentAiFormState {
  enabled: boolean;
  processing_mode: 'sync' | 'async';
  primary_provider: AiProviderKey | '';
  fallback_enabled: boolean;
  fallback_providers: AiProviderKey[];
  confidence_threshold_percent: string;
  default_language: string;
  max_files_per_batch: string;
  max_pages_per_file: string;
  max_file_size_bytes: string;
  test_mode: boolean;
  providers: Record<AiProviderKey, AiProviderFormState>;
  current_password: string;
}

export const emptyAiProvider = (): AiProviderFormState => ({
  enabled: false,
  api_key: '',
  clear_api_key: false,
  model: '',
  connection_timeout_seconds: '15',
  processing_timeout_seconds: '90',
  max_attempts: '2',
  allow_document_sending: false,
  monthly_operation_limit: '',
  monthly_page_limit: '',
  data_region: '',
  retention_policy: '',
});

export const emptyDocumentAiForm = (): DocumentAiFormState => ({
  enabled: false,
  processing_mode: 'async',
  primary_provider: '',
  fallback_enabled: false,
  fallback_providers: [],
  confidence_threshold_percent: '0',
  default_language: 'ar',
  max_files_per_batch: '10',
  max_pages_per_file: '100',
  max_file_size_bytes: '10485760',
  test_mode: false,
  providers: {
    openai: emptyAiProvider(),
    anthropic: emptyAiProvider(),
    google_gemini: emptyAiProvider(),
  },
  current_password: '',
});

export function payloadFor(key: Exclude<IntegrationKey, 'document_ai'>, form: IntegrationFormState): Record<string, unknown>;
export function payloadFor(key: 'document_ai', form: DocumentAiFormState): Record<string, unknown>;
export function payloadFor(key: IntegrationKey, form: IntegrationFormState | DocumentAiFormState): Record<string, unknown> {
  if (key === 'document_ai') {
    const ai = form as DocumentAiFormState;
    return {
      enabled: ai.enabled,
      provider: ai.primary_provider || undefined,
      primary_provider: ai.primary_provider || undefined,
      processing_mode: ai.processing_mode === 'sync' ? 'sync' : 'async',
      fallback_enabled: ai.fallback_enabled,
      fallback_providers: ai.fallback_providers,
      confidence_threshold_percent: Number(ai.confidence_threshold_percent),
      default_language: ai.default_language,
      max_files_per_batch: Number(ai.max_files_per_batch),
      max_pages_per_file: Number(ai.max_pages_per_file),
      max_file_size_bytes: Number(ai.max_file_size_bytes),
      test_mode: ai.test_mode,
      providers: Object.fromEntries(AI_PROVIDER_KEYS.map((provider) => {
        const item = ai.providers[provider];
        return [provider, {
          enabled: item.enabled,
          ...(item.api_key ? { api_key: item.api_key } : {}),
          clear_api_key: item.clear_api_key,
          model: item.model,
          connection_timeout_seconds: Number(item.connection_timeout_seconds),
          processing_timeout_seconds: Number(item.processing_timeout_seconds),
          max_attempts: Number(item.max_attempts),
          allow_document_sending: item.allow_document_sending,
          ...(item.monthly_operation_limit ? { monthly_operation_limit: Number(item.monthly_operation_limit) } : {}),
          ...(item.monthly_page_limit ? { monthly_page_limit: Number(item.monthly_page_limit) } : {}),
          data_region: item.data_region || undefined,
          retention_policy: item.retention_policy || undefined,
        }];
      })),
      current_password: ai.current_password,
    };
  }

  const integration = form as IntegrationFormState;
  if (key === 'document_storage') return {
    enabled: integration.enabled, provider: integration.provider, endpoint: integration.endpoint, bucket: integration.bucket,
    region: integration.region,
    ...(integration.access_key_id ? { access_key_id: integration.access_key_id } : {}),
    ...(integration.secret_access_key ? { secret_access_key: integration.secret_access_key } : {}),
    use_path_style_endpoint: integration.use_path_style_endpoint,
    current_password: integration.current_password,
  };
  if (key === 'malware_scanner') return {
    enabled: integration.enabled, provider: integration.provider, host: integration.host,
    port: Number(integration.port), timeout_seconds: Number(integration.timeout_seconds), current_password: integration.current_password,
  };
  return {
    enabled: integration.enabled, provider: 'redis', max_attempts: Number(integration.max_attempts),
    timeout_seconds: Number(integration.timeout_seconds),
    backoff_seconds: integration.backoff_seconds.split(',').map((value) => Number(value.trim())).filter(Number.isFinite),
    current_password: integration.current_password,
  };
}
