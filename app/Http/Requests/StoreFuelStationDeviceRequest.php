<?php

namespace App\Http\Requests;

use App\Models\FuelStationDevice;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreFuelStationDeviceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'fuel_station_id' => ['required', 'uuid'],
            'device_key' => ['required', 'string', 'max:128', 'regex:/^[a-z0-9][a-z0-9._:-]*$/'],
            'name' => ['required', 'string', 'min:2', 'max:160'],
            'device_type' => ['required', 'string', Rule::in([
                FuelStationDevice::TYPE_FORECOURT_CONTROLLER, FuelStationDevice::TYPE_ATG,
                FuelStationDevice::TYPE_RFID_READER, FuelStationDevice::TYPE_PAYMENT_TERMINAL,
                FuelStationDevice::TYPE_STATION_GATEWAY,
            ])],
            'status' => ['sometimes', 'string', Rule::in([
                FuelStationDevice::STATUS_ACTIVE, FuelStationDevice::STATUS_DISABLED, FuelStationDevice::STATUS_RETIRED,
            ])],
            'adapter_key' => ['required', 'string', 'max:64', 'regex:/^[a-z0-9][a-z0-9._:-]*$/'],
            'manufacturer' => ['nullable', 'string', 'max:120'],
            'model' => ['nullable', 'string', 'max:120'],
            'serial_number' => ['nullable', 'string', 'max:160'],
            'firmware_version' => ['nullable', 'string', 'max:120'],
            'protocol' => ['nullable', 'string', 'max:64'],
            'external_identifier' => ['nullable', 'string', 'max:160'],
            'endpoint_metadata' => ['nullable', 'array'],
            'credential_reference' => ['nullable', 'string', 'max:160', 'regex:/^[a-z][a-z0-9._:\/-]*$/'],
        ];
    }
}
