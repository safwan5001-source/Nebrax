<?php

namespace App\Http\Resources;

use App\Services\FuelQuantity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\FuelTankReading */
class FuelTankReadingResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'fuel_station_id' => $this->fuel_station_id,
            'station' => $this->whenLoaded('station', fn () => ['id' => $this->station?->id, 'code' => $this->station?->code, 'name' => $this->station?->name]),
            'fuel_tank_id' => $this->fuel_tank_id,
            'tank' => $this->whenLoaded('tank', fn () => ['id' => $this->tank?->id, 'code' => $this->tank?->code, 'name' => $this->tank?->name]),
            'reading_type' => $this->reading_type,
            'quantity_milliliters' => $this->quantity_milliliters,
            'quantity_liters' => app(FuelQuantity::class)->millilitersToLiters((int) $this->quantity_milliliters),
            'evidence_key' => $this->evidence_key,
            'evidence' => $this->evidence,
            'recorded_by' => $this->recorded_by,
            'recorder' => $this->whenLoaded('recorder', fn () => ['id' => $this->recorder?->id, 'name' => $this->recorder?->name]),
            'measured_at' => $this->measured_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
