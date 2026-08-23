<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelFleetVehicleRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'partner_id' => ['nullable', 'uuid'],
            'corporate_fuel_contract_id' => ['nullable', 'uuid'],
            'plate_number' => ['required', 'string', 'max:100'],
            'plate_country' => ['nullable', 'string', 'max:16'],
            'vin' => ['nullable', 'string', 'max:100'],
            'fleet_number' => ['nullable', 'string', 'max:100'],
            'fuel_type' => ['nullable', 'string', 'max:100'],
            'tank_capacity_milliliters' => ['nullable', 'integer', 'min:0'],
            'odometer' => ['nullable', 'integer', 'min:0'],
            'status' => ['sometimes', 'in:active,suspended,inactive'],
            'fuel_product_ids' => ['sometimes', 'array'],
            'fuel_product_ids.*' => ['uuid', 'distinct'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
