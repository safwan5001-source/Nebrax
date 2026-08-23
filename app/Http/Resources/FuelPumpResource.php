<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\FuelPump */
class FuelPumpResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'fuel_station_id' => $this->fuel_station_id,
            'station' => $this->whenLoaded('station', fn () => ['id' => $this->station?->id, 'name' => $this->station?->name, 'code' => $this->station?->code]),
            'pump_number' => $this->pump_number,
            'name' => $this->name,
            'controller_key' => $this->controller_key,
            'status' => $this->status,
            'nozzles_count' => $this->whenCounted('nozzles'),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
