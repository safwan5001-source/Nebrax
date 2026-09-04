import {
  AI_PROVIDER_KEYS,
  emptyAiProvider,
  emptyDocumentAiForm,
  type AiProviderFormState,
  type AiProviderKey,
  type DocumentAiFormState,
} from './payload';

export interface DocumentAiHydrationSummary {
  enabled?: boolean;
  configuration?: Record<string, any>;
}

const GEMINI_TRACKED_FIELDS = [
  'enabled',
  'model',
  'connection_timeout_seconds',
  'processing_timeout_seconds',
  'max_attempts',
  'allow_document_sending',
  'monthly_operation_limit',
  'monthly_page_limit',
  'data_region',
  'retention_policy',
] as const satisfies ReadonlyArray<keyof AiProviderFormState>;

export function isAiProvider(value: unknown): value is AiProviderKey {
  return typeof value === 'string' && AI_PROVIDER_KEYS.includes(value as AiProviderKey);
}

export function hydrateAiForm(summary?: DocumentAiHydrationSummary): DocumentAiFormState {
  const initial = emptyDocumentAiForm();
  const configuration = summary?.configuration ?? {};
  const providers = configuration.providers ?? {};

  return {
    ...initial,
    enabled: Boolean(summary?.enabled ?? configuration.engine_enabled ?? false),
    processing_mode: configuration.processing_mode === 'sync' ? 'sync' : 'async',
    primary_provider: isAiProvider(configuration.primary_provider) ? configuration.primary_provider : '',
    fallback_enabled: Boolean(configuration.fallback_enabled ?? false),
    fallback_providers: Array.isArray(configuration.fallback_providers)
      ? configuration.fallback_providers.filter(isAiProvider).slice(0, 2)
      : [],
    confidence_threshold_percent: String(configuration.confidence_threshold_percent ?? initial.confidence_threshold_percent),
    default_language: String(configuration.default_language ?? initial.default_language),
    max_files_per_batch: String(configuration.max_files_per_batch ?? initial.max_files_per_batch),
    max_pages_per_file: String(configuration.max_pages_per_file ?? initial.max_pages_per_file),
    max_file_size_bytes: String(configuration.max_file_size_bytes ?? initial.max_file_size_bytes),
    test_mode: Boolean(configuration.test_mode ?? false),
    providers: Object.fromEntries(
      AI_PROVIDER_KEYS.map((provider) => {
        const item = providers[provider] ?? {};
        return [
          provider,
          {
            ...emptyAiProvider(),
            api_key: '',
            clear_api_key: false,
            enabled: Boolean(item.enabled ?? false),
            model: String(item.model ?? ''),
            connection_timeout_seconds: String(item.connection_timeout_seconds ?? 15),
            processing_timeout_seconds: String(item.processing_timeout_seconds ?? 90),
            max_attempts: String(item.max_attempts ?? 2),
            allow_document_sending: Boolean(item.allow_document_sending ?? false),
            monthly_operation_limit: item.monthly_operation_limit ? String(item.monthly_operation_limit) : '',
            monthly_page_limit: item.monthly_page_limit ? String(item.monthly_page_limit) : '',
            data_region: String(item.data_region ?? ''),
            retention_policy: String(item.retention_policy ?? ''),
          },
        ];
      }),
    ) as Record<AiProviderKey, DocumentAiFormState['providers'][AiProviderKey]>,
    current_password: '',
  };
}

export function isGoogleGeminiDirty(current: DocumentAiFormState, persisted: DocumentAiFormState): boolean {
  const form = current.providers.google_gemini;
  const saved = persisted.providers.google_gemini;
  if (form.api_key.trim() !== '') {
    return true;
  }
  if (form.clear_api_key) {
    return true;
  }

  return GEMINI_TRACKED_FIELDS.some((field) => form[field] !== saved[field]);
}
