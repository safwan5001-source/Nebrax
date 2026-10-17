<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PlatformAiBudgetRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        return [
            'scope' => ['required', Rule::in(['global', 'tenant'])],
            'tenant_id' => ['required_if:scope,tenant', 'nullable', 'uuid'],
            'period' => ['required', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/'],
            'cap_tokens' => ['required', 'integer', 'min:0'],
            'cap_cost_micro_usd' => ['required', 'integer', 'min:0'],
            'current_password' => ['required', 'string', 'max:255'],
        ];
    }
}
