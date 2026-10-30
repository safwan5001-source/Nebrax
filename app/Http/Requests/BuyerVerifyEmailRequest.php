<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** H6 Batch H — token from the e-mailed link. No tenant/identity/channel input is accepted. */
class BuyerVerifyEmailRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'token' => ['required', 'string', 'size:64', 'regex:/^[A-Za-z0-9]{64}$/'],
            'tenant_id' => ['prohibited'],
            'customer_identity_id' => ['prohibited'],
            'sales_channel_id' => ['prohibited'],
        ];
    }
}
