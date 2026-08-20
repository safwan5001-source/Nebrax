<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePaymentMethodRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'name_en' => ['nullable', 'string', 'max:255'],
            'settlement_type' => ['required', Rule::in(['cash', 'bank'])],
            'cash_bank_account_id' => ['required', 'uuid'],
            'instructions' => ['nullable', 'string', 'max:1000'],
            'available_online' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
            'is_default' => ['sometimes', 'boolean'],
        ];
    }
}
