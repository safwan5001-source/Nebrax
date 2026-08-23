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
                'provider' => ['required', 'string', 'max:64'],
                'endpoint' => ['nullable', 'url:http,https', 'max:500'],
                'model' => ['nullable', 'string', 'max:128'],
                'api_key' => ['nullable', 'string', 'max:2000'],
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
