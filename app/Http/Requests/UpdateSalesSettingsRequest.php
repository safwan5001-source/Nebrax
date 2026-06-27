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
            'invoice_prefix'       => ['nullable', 'string', 'max:10'],
            'default_terms'        => ['nullable', 'string', 'max:2000'],
        ];
    }
}
