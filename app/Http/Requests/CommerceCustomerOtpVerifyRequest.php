<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CommerceCustomerOtpVerifyRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'phone' => ['required', 'string', 'regex:/^\+[1-9][0-9]{7,14}$/'],
            'code' => ['required', 'string', 'regex:/^[0-9]{6}$/'],
            'tenant_id' => ['prohibited'],
            'customer_id' => ['prohibited'],
            'customer_identity_id' => ['prohibited'],
            'partner_id' => ['prohibited'],
        ];
    }
}
