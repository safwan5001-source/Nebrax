<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** H6 Batch M — consume a reset token and set the new password (same length rules as registration). */
class BuyerResetPasswordRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'token' => ['required', 'string', 'size:64', 'regex:/^[A-Za-z0-9]{64}$/'],
            'password' => ['required', 'string', 'min:8', 'max:255'],
            'tenant_id' => ['prohibited'],
            'customer_identity_id' => ['prohibited'],
            'email' => ['prohibited'],
        ];
    }
}
