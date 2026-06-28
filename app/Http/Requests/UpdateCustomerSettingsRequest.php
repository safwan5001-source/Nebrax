<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateCustomerSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'default_type'        => ['nullable', 'in:customer,supplier,both'],
            'default_city'        => ['nullable', 'string', 'max:255'],
            'payment_terms_days'  => ['nullable', 'integer', 'min:0', 'max:365'],
            'require_tax_number'  => ['nullable', 'boolean'],
            'loyalty_enabled'     => ['nullable', 'boolean'],
        ];
    }
}
