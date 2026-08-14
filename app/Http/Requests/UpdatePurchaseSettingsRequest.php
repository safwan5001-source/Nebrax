<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdatePurchaseSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'default_tax_rate'      => ['nullable', 'integer', 'min:0', 'max:100'],
            'default_payment_type'  => ['nullable', 'in:cash,credit'],
            'default_tax_inclusive' => ['nullable', 'boolean'],
            'require_return_source' => ['nullable', 'boolean'],
            'return_window_days'    => ['nullable', 'integer', 'min:0', 'max:3650'],
        ];
    }
}
