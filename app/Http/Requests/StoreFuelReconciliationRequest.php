<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelReconciliationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'fuel_station_id' => ['required', 'uuid'],
            'fuel_tank_id' => ['required', 'uuid'],
            'physical_reading_id' => ['nullable', 'uuid'],
            'atg_reading_id' => ['nullable', 'uuid'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
