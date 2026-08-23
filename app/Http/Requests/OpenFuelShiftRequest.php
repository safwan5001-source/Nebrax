<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class OpenFuelShiftRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'fuel_station_id' => ['required', 'uuid'],
            'opening_float_minor' => ['sometimes', 'integer', 'min:0'],
            'active_terminal_keys' => ['nullable', 'array', 'max:100'],
            'active_terminal_keys.*' => ['string', 'max:128', 'distinct'],
            'opening_note' => ['nullable', 'string', 'max:2000'],
            'idempotency_key' => ['required', 'string', 'max:128'],
        ];
    }
}
