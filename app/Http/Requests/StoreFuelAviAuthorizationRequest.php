<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelAviAuthorizationRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'fuel_station_id' => ['required', 'uuid'],
            'fuel_nozzle_id' => ['required', 'uuid'],
            'vehicle_credential' => ['nullable', 'string', 'min:1', 'max:512', 'required_without:driver_credential'],
            'driver_credential' => ['nullable', 'string', 'min:1', 'max:512', 'required_without:vehicle_credential'],
            'quantity_milliliters' => ['required', 'integer', 'min:1'],
            'odometer' => ['nullable', 'integer', 'min:0'],
            'idempotency_key' => ['required', 'string', 'max:128'],
        ];
    }
}
