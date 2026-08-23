<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelStationProductPriceRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'fuel_station_id' => ['nullable', 'uuid'],
            'fuel_product_id' => ['required', 'uuid'],
            'price_per_liter_minor' => ['required', 'integer', 'min:1'],
            'effective_from' => ['required', 'date'],
            'effective_until' => ['nullable', 'date', 'after:effective_from'],
            'approved_by' => ['nullable', 'uuid'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
