<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** إدخال إسقاط تشغيلي. لا سعر ولا ضريبة ولا مخزون. */
class StoreDeliveryHubOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'delivery_platform_profile_id' => ['required', 'uuid'],
            'provider_order_id' => ['nullable', 'string', 'max:191'],
            'idempotency_key' => ['nullable', 'uuid'],
            'external_order_reference' => ['nullable', 'string', 'max:191'],
            'branch_id' => ['nullable', 'uuid'],
            'provider_status' => ['nullable', 'string', 'max:255'],
            'intake_payload' => ['nullable', 'array', 'max:50'],
        ];
    }
}
