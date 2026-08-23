<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelDeliveryRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        $liters = ['required', 'regex:/^(0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/'];

        return [
            'fuel_station_id' => ['required', 'uuid'],
            'fuel_tank_id' => ['required', 'uuid'],
            'fuel_product_id' => ['required', 'uuid'],
            'warehouse_id' => ['required', 'uuid'],
            'supplier_id' => ['required', 'uuid'],
            'procurement_order_id' => ['nullable', 'uuid'],
            'purchase_reference' => ['nullable', 'string', 'max:128'],
            'delivery_note_number' => ['nullable', 'string', 'max:128'],
            'tanker_identifier' => ['nullable', 'string', 'max:128'],
            'driver_name' => ['nullable', 'string', 'max:255'],
            'compartments' => ['nullable', 'array'],
            'dispatched_liters' => $liters,
            'received_liters' => $liters,
            'received_total_cost_minor' => ['required', 'integer', 'min:0'],
            'temperature_milli_celsius' => ['nullable', 'integer'],
            'density_kg_per_m3' => ['nullable', 'integer', 'min:0'],
            'before_physical_reading_id' => ['nullable', 'uuid'],
            'after_physical_reading_id' => ['nullable', 'uuid'],
            'before_atg_reading_id' => ['nullable', 'uuid'],
            'after_atg_reading_id' => ['nullable', 'uuid'],
            'evidence' => ['nullable', 'array'],
            'received_at' => ['nullable', 'date'],
            'idempotency_key' => ['required', 'string', 'max:128'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
