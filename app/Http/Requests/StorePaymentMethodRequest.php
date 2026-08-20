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
            'fees_enabled' => ['sometimes', 'boolean'],
            // النسبة بالنقاط الأساسية: 0.7% = 70، وتُحد عند 100%.
            'fee_rate_bps' => ['sometimes', 'integer', 'min:0', 'max:10000'],
            'fee_fixed_amount' => ['sometimes', 'integer', 'min:0', 'max:100000000000'],
            'fee_min_amount' => ['sometimes', 'integer', 'min:0', 'max:100000000000'],
            'fee_tax_rate' => ['sometimes', 'integer', 'min:0', 'max:100'],
            'fee_expense_account_id' => ['nullable', 'uuid', 'required_if:fees_enabled,true'],
        ];
    }
}
