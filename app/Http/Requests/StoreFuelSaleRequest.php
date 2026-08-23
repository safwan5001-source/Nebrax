<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelSaleRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'fuel_station_id' => ['required', 'uuid'],
            'fuel_nozzle_id' => ['required', 'uuid'],
            'fuel_shift_id' => ['nullable', 'uuid'],
            'partner_id' => ['nullable', 'uuid'],
            'corporate_fuel_contract_id' => ['nullable', 'uuid'],
            'fuel_card_id' => ['nullable', 'uuid'],
            'fuel_fleet_vehicle_id' => ['nullable', 'uuid'],
            'fuel_fleet_driver_id' => ['nullable', 'uuid'],
            'fuel_avi_authorization_id' => ['nullable', 'uuid'],
            'odometer' => ['nullable', 'integer', 'min:0'],
            'quantity_milliliters' => ['required', 'integer', 'min:1'],
            'meter_start_milliliters' => ['nullable', 'integer', 'min:0', 'required_with:meter_end_milliliters'],
            'meter_end_milliliters' => ['nullable', 'integer', 'min:0', 'required_with:meter_start_milliliters'],
            'meter_source_reference' => ['nullable', 'string', 'max:255'],
            'source_references' => ['nullable', 'array'],
            'idempotency_key' => ['required', 'string', 'max:128'],
        ];
    }
}
