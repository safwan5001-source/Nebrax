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
        ];
    }
}
