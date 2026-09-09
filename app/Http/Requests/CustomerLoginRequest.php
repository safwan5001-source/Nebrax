<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CustomerLoginRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'string', 'max:255'],
            'tenant_id' => ['prohibited'],
            'customer_id' => ['prohibited'],
            'customer_identity_id' => ['prohibited'],
            'partner_id' => ['prohibited'],
        ];
    }
}
