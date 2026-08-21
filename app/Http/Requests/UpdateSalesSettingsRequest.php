<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateSalesSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'default_tax_rate'     => ['nullable', 'integer', 'min:0', 'max:100'],
            'default_payment_type' => ['nullable', 'in:cash,credit'],
            'quote_validity_days'  => ['nullable', 'integer', 'min:0', 'max:365'],
            'default_terms'        => ['nullable', 'string', 'max:2000'],
            'require_return_source' => ['nullable', 'boolean'],
            'return_window_days'      => ['nullable', 'integer', 'min:0', 'max:3650'],
            'enforce_min_sale_price' => ['nullable', 'boolean'],
        ];
    }
}
