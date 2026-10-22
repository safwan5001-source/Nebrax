<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** تدوير الأسرار: سرّ واحد على الأقل. `grace_minutes` نافذة قبول سرّ الـwebhook السابق (0 = فوراً). */
class RotatePaymentGatewayCredentialsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'secret_key' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'webhook_secret' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'extra_credentials' => ['sometimes', 'nullable', 'array', 'max:20'],
            'grace_minutes' => ['sometimes', 'integer', 'min:0', 'max:10080'],
        ];
    }
}
