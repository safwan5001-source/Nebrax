<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelCardRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'public_identifier' => ['required', 'string', 'max:255'],
            'credential' => ['required', 'string', 'min:16', 'max:1024'],
            'partner_id' => ['required', 'uuid'],
            'corporate_fuel_contract_id' => ['required', 'uuid'],
            'fuel_fleet_vehicle_id' => ['nullable', 'uuid'],
            'fuel_fleet_driver_id' => ['nullable', 'uuid'],
            'status' => ['sometimes', 'in:active,suspended,lost,expired,cancelled,replaced'],
            'effective_from' => ['required', 'date'],
            'effective_until' => ['nullable', 'date', 'after:effective_from'],
            'per_transaction_milliliters' => ['nullable', 'integer', 'min:1'],
            'per_transaction_value_minor' => ['nullable', 'integer', 'min:1'],
            'daily_milliliters' => ['nullable', 'integer', 'min:1'],
            'daily_value_minor' => ['nullable', 'integer', 'min:1'],
            'weekly_milliliters' => ['nullable', 'integer', 'min:1'],
            'weekly_value_minor' => ['nullable', 'integer', 'min:1'],
            'monthly_milliliters' => ['nullable', 'integer', 'min:1'],
            'monthly_value_minor' => ['nullable', 'integer', 'min:1'],
            'daily_transaction_count' => ['nullable', 'integer', 'min:1'],
            'station_restriction_mode' => ['sometimes', 'in:all,selected'],
            'station_ids' => ['sometimes', 'array'],
            'station_ids.*' => ['uuid', 'distinct'],
            'fuel_restriction_mode' => ['sometimes', 'in:all,selected'],
            'fuel_product_ids' => ['sometimes', 'array'],
            'fuel_product_ids.*' => ['uuid', 'distinct'],
            'allowed_time_windows' => ['nullable', 'array'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
