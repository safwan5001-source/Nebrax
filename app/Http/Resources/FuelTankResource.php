<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\FuelTank */
class FuelTankResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'fuel_station_id' => $this->fuel_station_id,
            'station' => $this->whenLoaded('station', fn () => ['id' => $this->station?->id, 'name' => $this->station?->name, 'code' => $this->station?->code]),
            'fuel_product_id' => $this->fuel_product_id,
            'fuel_product' => $this->whenLoaded('fuelProduct', fn () => ['id' => $this->fuelProduct?->id, 'name' => $this->fuelProduct?->name, 'code' => $this->fuelProduct?->code]),
            'code' => $this->code,
            'name' => $this->name,
            'capacity_milliliters' => $this->capacity_milliliters,
            'safe_capacity_milliliters' => $this->safe_capacity_milliliters,
            'minimum_level_milliliters' => $this->minimum_level_milliliters,
            'dead_stock_milliliters' => $this->dead_stock_milliliters,
            'opening_volume_milliliters' => $this->opening_volume_milliliters,
            'measurement_configuration' => $this->measurement_configuration,
            'atg_source_key' => $this->atg_source_key,
            'status' => $this->status,
            'calibration_points' => $this->whenLoaded('calibrationPoints', fn () => $this->calibrationPoints->sortBy('level_millimeters')->map(fn ($point) => [
                'id' => $point->id,
                'level_millimeters' => $point->level_millimeters,
                'volume_milliliters' => $point->volume_milliliters,
            ])->values()),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
