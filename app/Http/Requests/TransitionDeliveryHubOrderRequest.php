<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** انتقال تشغيلي. reject وcancel يكتبان الحالة الطرفية نفسها. */
class TransitionDeliveryHubOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'action' => ['required', 'string', Rule::in(['route', 'accept', 'reject', 'cancel', 'preparing', 'ready', 'handoff'])],
            'branch_id' => ['nullable', 'uuid', 'required_if:action,route'],
        ];
    }
}
