<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** TANKER-PR1: إنشاء ملف صاحب صهريج. التفويض بوسيط المسار (`fuel.tanker.manage`)؛ الحقول المسموحة فقط (لا tenant_id ولا partner_id ولا حقل مالي). */
class StoreFuelTankerOwnerRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:64'],
            'phone' => ['nullable', 'string', 'max:50'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'status' => ['sometimes', 'in:active,suspended,inactive'],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }
}
