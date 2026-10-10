<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** إنشاء ربط موصّل. المستأجر من الجلسة لا من الجسم. */
class StoreDeliveryConnectorAccountRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'delivery_platform_profile_id' => ['required', 'uuid'],
            'external_store_id' => ['required', 'string', 'max:191'],
            'branch_id' => ['nullable', 'uuid'],
        ];
    }
}
