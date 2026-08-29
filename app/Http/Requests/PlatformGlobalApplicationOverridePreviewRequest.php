<?php

namespace App\Http\Requests;

use App\Services\PlatformGlobalApplicationOverrideService;
use App\Support\ApplicationCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PlatformGlobalApplicationOverridePreviewRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'operation' => ['required', 'string', Rule::in(PlatformGlobalApplicationOverrideService::operations())],
            'application_key' => [
                Rule::requiredIf(fn (): bool => PlatformGlobalApplicationOverrideService::isSingleAppOperation(
                    (string) $this->input('operation'),
                )),
                'nullable',
                'string',
                Rule::in(ApplicationCatalog::keys()),
            ],
            'tenant_ids' => ['nullable', 'array'],
            'tenant_ids.*' => ['uuid', 'exists:tenants,id'],
        ];
    }
}
