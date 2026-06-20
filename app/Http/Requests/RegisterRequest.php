<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'company_name' => ['required', 'string', 'max:255'],
            'slug'         => ['required', 'string', 'alpha_dash', 'max:255', 'unique:tenants,slug'],
            'vat_number'   => ['nullable', 'string', 'size:15'],
            'name'         => ['required', 'string', 'max:255'],
            'email'        => ['required', 'email', 'max:255'],
            'password'     => ['required', 'string', 'min:8'],
        ];
    }
}
