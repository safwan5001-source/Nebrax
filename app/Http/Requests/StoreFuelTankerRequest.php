<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** TANKER-PR1: إنشاء صهريج تابع لصاحب صهريج. السعة بالمللتر عدد صحيح (لا float). */
class StoreFuelTankerRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'fuel_tanker_owner_id' => ['required', 'uuid'],
            'plate_number' => ['required', 'string', 'max:64'],
            'plate_country' => ['nullable', 'string', 'max:8'],
            'capacity_milliliters' => ['nullable', 'integer', 'min:1'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'status' => ['sometimes', 'in:active,suspended,inactive'],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }
}
