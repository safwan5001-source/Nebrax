<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class RequestFuelShiftCorrectionRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'target_type' => ['required', 'in:meter_reading,tank_reading,cash_count'],
            'target_id' => ['nullable', 'uuid', 'required_unless:target_type,cash_count'],
            'reason' => ['required', 'string', 'max:2000'],
            'proposed' => ['required', 'array', 'min:1'],
        ];
    }
}
