<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\FuelNozzle */
class FuelNozzleResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'fuel_station_id' => $this->fuel_station_id,
            'fuel_pump_id' => $this->fuel_pump_id,
            'pump' => $this->whenLoaded('pump', fn () => ['id' => $this->pump?->id, 'pump_number' => $this->pump?->pump_number]),
            'fuel_tank_id' => $this->fuel_tank_id,
            'tank' => $this->whenLoaded('tank', fn () => ['id' => $this->tank?->id, 'name' => $this->tank?->name, 'code' => $this->tank?->code]),
            'fuel_product_id' => $this->fuel_product_id,
            'fuel_product' => $this->whenLoaded('fuelProduct', fn () => ['id' => $this->fuelProduct?->id, 'name' => $this->fuelProduct?->name, 'code' => $this->fuelProduct?->code]),
            'nozzle_number' => $this->nozzle_number,
            'controller_key' => $this->controller_key,
            'meter_opening_milliliters' => $this->meter_opening_milliliters,
            'status' => $this->status,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
