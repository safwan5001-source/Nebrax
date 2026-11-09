<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** TANKER-PR1: تعديل جزئي لملف صاحب الصهريج (الحقول المرسلة فقط). */
class UpdateFuelTankerOwnerRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'code' => ['sometimes', 'nullable', 'string', 'max:64'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:50'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'status' => ['sometimes', 'in:active,suspended,inactive'],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }
}
