<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CustomerRegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'display_name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255'],
            'phone' => ['nullable', 'string', 'regex:/^\+[1-9][0-9]{7,14}$/'],
            'password' => ['required', 'string', 'min:8', 'max:255'],
            'tenant_id' => ['prohibited'],
            'customer_id' => ['prohibited'],
            'customer_identity_id' => ['prohibited'],
            'partner_id' => ['prohibited'],
        ];
    }
}
