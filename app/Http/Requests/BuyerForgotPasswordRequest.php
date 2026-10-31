<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** H6 Batch M — ask for a password-reset e-mail. The response never reveals whether the address exists. */
class BuyerForgotPasswordRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'email', 'max:255'],
            'locale_path' => ['sometimes', 'nullable', 'string', 'regex:#^/[a-z]{2}/[a-z]{2}$#'],
            'tenant_id' => ['prohibited'],
            'customer_identity_id' => ['prohibited'],
        ];
    }
}
