<?php

namespace App\Http\Requests;

use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelStation;
use App\Models\FuelTank;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class FuelStationMasterDataRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $method = (string) ($this->route()?->getActionMethod() ?? '');

        return match ($method) {
            'storeStation', 'updateStation' => $this->stationRules($method === 'storeStation'),
            'storeFuelProduct', 'updateFuelProduct' => $this->fuelProductRules($method === 'storeFuelProduct'),
            'storeTank', 'updateTank' => $this->tankRules($method === 'storeTank'),
            'storePump', 'updatePump' => $this->pumpRules($method === 'storePump'),
            'storeNozzle', 'updateNozzle' => $this->nozzleRules($method === 'storeNozzle'),
            default => [],
        };
    }

    /** @return array<string, mixed> */
    private function stationRules(bool $creating): array
    {
        return [
            'branch_id' => [$creating ? 'required' : 'sometimes', 'uuid'],
            'code' => [$creating ? 'required' : 'sometimes', 'string', 'max:64'],
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'max:255'],
            'country_code' => ['sometimes', 'nullable', 'string', 'size:2'],
            'region' => ['sometimes', 'nullable', 'string', 'max:120'],
            'city' => ['sometimes', 'nullable', 'string', 'max:120'],
            'address' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'latitude' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
            'manager_id' => ['sometimes', 'nullable', 'uuid'],
            'status' => ['sometimes', Rule::in(FuelStation::STATUSES)],
            'timezone' => ['sometimes', 'nullable', 'timezone'],
            'operating_day_starts_at' => ['sometimes', 'nullable', 'date_format:H:i'],
            'operating_hours' => ['sometimes', 'nullable', 'array'],
            'license_number' => ['sometimes', 'nullable', 'string', 'max:128'],
            'license_expires_at' => ['sometimes', 'nullable', 'date'],
            'zatca_branch_reference' => ['sometimes', 'nullable', 'string', 'max:128'],
            'default_inventory_account_id' => ['sometimes', 'nullable', 'uuid'],
            'default_revenue_account_id' => ['sometimes', 'nullable', 'uuid'],
            'default_cogs_account_id' => ['sometimes', 'nullable', 'uuid'],
        ];
    }

    /** @return array<string, mixed> */
    private function fuelProductRules(bool $creating): array
    {
        return [
            'product_id' => [$creating ? 'required' : 'sometimes', 'uuid'],
            'code' => [$creating ? 'required' : 'sometimes', 'string', 'max:64'],
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'max:255'],
            'density_kg_per_m3' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:2000'],
            'tax_category' => ['sometimes', 'nullable', 'string', 'max:64'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /** @return array<string, mixed> */
    private function tankRules(bool $creating): array
    {
        return [
            'fuel_station_id' => [$creating ? 'required' : 'sometimes', 'uuid'],
            'fuel_product_id' => [$creating ? 'required' : 'sometimes', 'uuid'],
            'code' => [$creating ? 'required' : 'sometimes', 'string', 'max:64'],
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'max:255'],
            'capacity_milliliters' => [$creating ? 'required' : 'sometimes', 'integer', 'min:1'],
            'safe_capacity_milliliters' => [$creating ? 'required' : 'sometimes', 'integer', 'min:1'],
            'minimum_level_milliliters' => ['sometimes', 'integer', 'min:0'],
            'dead_stock_milliliters' => ['sometimes', 'integer', 'min:0'],
            'opening_volume_milliliters' => ['sometimes', 'integer', 'min:0'],
            'measurement_configuration' => ['sometimes', 'nullable', 'array'],
            'atg_source_key' => ['sometimes', 'nullable', 'string', 'max:128'],
            'status' => ['sometimes', Rule::in(FuelTank::STATUSES)],
            'calibration_points' => ['sometimes', 'array'],
            'calibration_points.*.level_millimeters' => ['required_with:calibration_points', 'integer', 'min:0'],
            'calibration_points.*.volume_milliliters' => ['required_with:calibration_points', 'integer', 'min:0'],
        ];
    }

    /** @return array<string, mixed> */
    private function pumpRules(bool $creating): array
    {
        return [
            'fuel_station_id' => [$creating ? 'required' : 'sometimes', 'uuid'],
            'pump_number' => [$creating ? 'required' : 'sometimes', 'string', 'max:64'],
            'name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'controller_key' => ['sometimes', 'nullable', 'string', 'max:128'],
            'status' => ['sometimes', Rule::in(FuelPump::STATUSES)],
        ];
    }

    /** @return array<string, mixed> */
    private function nozzleRules(bool $creating): array
    {
        return [
            'fuel_pump_id' => [$creating ? 'required' : 'sometimes', 'uuid'],
            'fuel_tank_id' => [$creating ? 'required' : 'sometimes', 'uuid'],
            'fuel_product_id' => [$creating ? 'required' : 'sometimes', 'uuid'],
            'nozzle_number' => [$creating ? 'required' : 'sometimes', 'string', 'max:64'],
            'controller_key' => ['sometimes', 'nullable', 'string', 'max:128'],
            'meter_opening_milliliters' => ['sometimes', 'integer', 'min:0'],
            'status' => ['sometimes', Rule::in(FuelNozzle::STATUSES)],
        ];
    }
}
