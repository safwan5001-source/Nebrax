<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelTankReadingRequest extends FormRequest
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
            'reading_type' => ['required', 'in:physical,atg'],
            'quantity_liters' => ['required', 'string', 'max:32'],
            'evidence_key' => ['required', 'string', 'max:128'],
            'evidence' => ['nullable', 'array'],
            'measured_at' => ['nullable', 'date'],
        ];
    }
}
