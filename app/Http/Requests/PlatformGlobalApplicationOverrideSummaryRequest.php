<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class PlatformGlobalApplicationOverrideSummaryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $tenantIds = $this->query('tenant_ids');
        if (is_string($tenantIds)) {
            $tenantIds = array_values(array_filter(array_map('trim', explode(',', $tenantIds))));
        }

        if (is_array($tenantIds)) {
            $this->merge(['tenant_ids' => $tenantIds]);
        }
    }

    public function rules(): array
    {
        return [
            'tenant_ids' => ['nullable', 'array'],
            'tenant_ids.*' => ['uuid', 'exists:tenants,id'],
        ];
    }
}
