<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** TANKER-PR1: تعديل جزئي للصهريج. `fuel_tanker_owner_id` يُقبل للمقارنة فقط (تغييره يُرفض في الخدمة). */
class UpdateFuelTankerRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'fuel_tanker_owner_id' => ['sometimes', 'uuid'],
            'plate_number' => ['sometimes', 'required', 'string', 'max:64'],
            'plate_country' => ['sometimes', 'nullable', 'string', 'max:8'],
            'capacity_milliliters' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'status' => ['sometimes', 'in:active,suspended,inactive'],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }
}
