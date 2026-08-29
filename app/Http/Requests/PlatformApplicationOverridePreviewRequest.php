<?php

namespace App\Http\Requests;

use App\Services\PlatformApplicationOverrideService;
use App\Support\ApplicationCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PlatformApplicationOverridePreviewRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'application_key' => ['nullable', 'string', Rule::in(ApplicationCatalog::keys())],
            'action' => [
                'nullable',
                'string',
                Rule::in([
                    'grant',
                    'revert',
                    'show',
                    'hide',
                    PlatformApplicationOverrideService::BULK_GRANT_ALL,
                    PlatformApplicationOverrideService::BULK_REVERT_ALL,
                    PlatformApplicationOverrideService::BULK_SHOW_ALL,
                    PlatformApplicationOverrideService::BULK_HIDE_ALL,
                ]),
            ],
            'keys' => ['nullable', 'array'],
            'keys.*' => ['string', Rule::in(ApplicationCatalog::keys())],
        ];
    }
}
