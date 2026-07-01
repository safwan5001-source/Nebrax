<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreAssetRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'               => ['required', 'string', 'max:255'],
            'account_id'         => ['required', 'uuid'],
            'partner_id'         => ['nullable', 'uuid'],
            'acquisition_date'   => ['nullable', 'date'],
            'payment_method'     => ['nullable', 'in:cash,bank,credit'],
            'cost'               => ['required', 'integer', 'min:1'], // هللات
            'tax_rate'           => ['nullable', 'integer', 'min:0', 'max:100'],
            'salvage_value'      => ['nullable', 'integer', 'min:0'], // هللات
            'useful_life_months' => ['nullable', 'integer', 'min:1', 'max:600'],
        ];
    }
}
