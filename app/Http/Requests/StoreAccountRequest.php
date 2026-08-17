<?php

namespace App\Http\Requests;

use App\Tenancy\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreAccountRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $accountId = $this->route('id');
        $tenantId  = app(TenantContext::class)->id();

        return [
            'code' => [
                'required',
                'string',
                'max:50',
                Rule::unique('accounts', 'code')
                    ->where(fn ($query) => $query->where('tenant_id', $tenantId))
                    ->ignore($accountId),
            ],
            'name'      => ['required', 'string', 'max:255'],
            'name_en'   => ['nullable', 'string', 'max:255'],
            'type'      => ['required', Rule::in(['asset', 'liability', 'equity', 'revenue', 'expense'])],
            'parent_id' => ['nullable', 'uuid'],
            'is_group'  => ['required', 'boolean'],
            'is_active' => ['nullable', 'boolean'],
        ];
    }
}
