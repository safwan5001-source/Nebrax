<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelShiftMeterReadingRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'fuel_nozzle_id' => ['required', 'uuid'],
            'reading_stage' => ['required', 'in:opening,closing'],
            'meter_milliliters' => ['required_without:meter_liters', 'nullable', 'integer', 'min:0'],
            'meter_liters' => ['required_without:meter_milliliters', 'nullable', 'regex:/^(0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/'],
            'evidence_key' => ['required', 'string', 'max:128'],
            'evidence' => ['nullable', 'array'],
            'measured_at' => ['nullable', 'date'],
        ];
    }
}
