<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateCompanyRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'       => ['required', 'string', 'max:255'],
            'vat_number' => ['nullable', 'string', 'max:20'],
            'cr_number'  => ['nullable', 'string', 'max:50'],
            'currency'   => ['nullable', 'string', 'size:3'],
            'country'    => ['nullable', 'string', 'max:2'],
            'phone'      => ['nullable', 'string', 'max:30'],
            'mobile'     => ['nullable', 'string', 'max:30'],
            'building_no'   => ['nullable', 'string', 'max:20'],
            'street'        => ['nullable', 'string', 'max:255'],
            'additional_no' => ['nullable', 'string', 'max:20'],
            'district'      => ['nullable', 'string', 'max:120'],
            'city'          => ['nullable', 'string', 'max:120'],
            'postal_code'   => ['nullable', 'string', 'max:20'],
            'short_address' => ['nullable', 'string', 'max:50'],
        ];
    }
}
