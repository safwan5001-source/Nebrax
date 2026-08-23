<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelShiftTankReadingRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'fuel_tank_id' => ['required', 'uuid'],
            'reading_stage' => ['required', 'in:opening,closing'],
            'reading_type' => ['sometimes', 'in:physical,atg'],
            'quantity_milliliters' => ['required_without:quantity_liters', 'nullable', 'integer', 'min:0'],
            'quantity_liters' => ['required_without:quantity_milliliters', 'nullable', 'regex:/^(0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/'],
            'evidence_key' => ['required', 'string', 'max:128'],
            'evidence' => ['nullable', 'array'],
            'measured_at' => ['nullable', 'date'],
        ];
    }
}
