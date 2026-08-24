<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdatePlatformIntegrationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $key = (string) $this->route('integration');
        $common = [
            'enabled' => ['required', 'boolean'],
            'provider' => ['nullable', 'string', 'max:64'],
            'current_password' => ['required', 'string', 'max:255'],
        ];

        return match ($key) {
            'document_storage' => $common + [
                'provider' => ['required', Rule::in(['r2', 's3', 's3_compatible'])],
                'endpoint' => ['required_if:enabled,true', 'nullable', 'url:http,https', 'max:500'],
                'bucket' => ['required_if:enabled,true', 'nullable', 'string', 'max:255'],
                'region' => ['nullable', 'string', 'max:64'],
                'access_key_id' => ['nullable', 'string', 'max:255'],
                'secret_access_key' => ['nullable', 'string', 'max:1000'],
                'use_path_style_endpoint' => ['nullable', 'boolean'],
            ],
            'malware_scanner' => $common + [
                'provider' => ['required', Rule::in(['clamav_tcp'])],
                'host' => ['required_if:enabled,true', 'nullable', 'string', 'max:255', 'not_regex:/[\s\/:]/'],
                'port' => ['nullable', 'integer', 'between:1,65535'],
                'timeout_seconds' => ['nullable', 'integer', 'between:1,30'],
            ],
            'document_ai' => $common + [
                'provider' => ['nullable', Rule::in(['openai', 'anthropic', 'google_gemini'])],
                'primary_provider' => ['nullable', Rule::in(['openai', 'anthropic', 'google_gemini'])],
                'fallback_enabled' => ['required', 'boolean'],
                'fallback_providers' => ['present', 'array', 'max:2'],
                'fallback_providers.*' => [Rule::in(['openai', 'anthropic', 'google_gemini']), 'distinct'],
                'confidence_threshold_percent' => ['required', 'integer', 'between:0,100'],
                'default_language' => ['required', 'string', 'max:16'],
                'max_files_per_batch' => ['required', 'integer', 'between:1,100'],
                'max_pages_per_file' => ['required', 'integer', 'between:1,1000'],
                'max_file_size_bytes' => ['required', 'integer', 'between:1,52428800'],
                'test_mode' => ['required', 'boolean'],
                'providers' => ['required', 'array'],
                'providers.openai' => ['required', 'array'],
                'providers.anthropic' => ['required', 'array'],
                'providers.google_gemini' => ['required', 'array'],
                'providers.*.enabled' => ['required', 'boolean'],
                'providers.*.api_key' => ['nullable', 'string', 'max:2000'],
                'providers.*.clear_api_key' => ['required', 'boolean'],
                'providers.*.model' => ['nullable', 'string', 'max:128'],
                'providers.*.connection_timeout_seconds' => ['required', 'integer', 'between:5,60'],
                'providers.*.processing_timeout_seconds' => ['required', 'integer', 'between:15,180'],
                'providers.*.max_attempts' => ['required', 'integer', 'between:1,5'],
                'providers.*.allow_document_sending' => ['required', 'boolean'],
                'providers.*.monthly_operation_limit' => ['nullable', 'integer', 'between:1,1000000'],
                'providers.*.monthly_page_limit' => ['nullable', 'integer', 'between:1,10000000'],
                'providers.*.data_region' => ['nullable', 'string', 'max:128'],
                'providers.*.retention_policy' => ['nullable', 'string', 'max:500'],
            ],
            'document_processing' => $common + [
                'provider' => ['nullable', Rule::in(['redis'])],
                'max_attempts' => ['required', 'integer', 'between:1,5'],
                'timeout_seconds' => ['required', 'integer', 'between:10,120'],
                'backoff_seconds' => ['required', 'array', 'between:1,5'],
                'backoff_seconds.*' => ['integer', 'between:1,3600'],
            ],
            default => ['integration' => ['prohibited']],
        };
    }
}
