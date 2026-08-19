<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCashBankAccountRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type' => ['required', Rule::in(['cash', 'bank'])],
            'name' => ['required', 'string', 'max:255'],
            'name_en' => ['nullable', 'string', 'max:255'],
            'bank_name' => ['nullable', 'string', 'max:255', 'required_if:type,bank'],
            'account_number' => ['nullable', 'string', 'max:255', 'required_if:type,bank'],
            'currency' => ['nullable', 'string', 'size:3'],
            'description' => ['nullable', 'string', 'max:2000'],
            'is_active' => ['nullable', 'boolean'],
            'deposit_scope' => ['nullable', Rule::in(['all', 'role', 'user', 'branch'])],
            'deposit_scope_subject' => ['nullable', 'string', 'max:255'],
            'withdraw_scope' => ['nullable', Rule::in(['all', 'role', 'user', 'branch'])],
            'withdraw_scope_subject' => ['nullable', 'string', 'max:255'],
        ];
    }
}
