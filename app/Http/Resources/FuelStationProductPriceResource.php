<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** FS-35: سعر وقود المحطة — بلا `tenant_id` ولا معرّفات المنشئ/المعتمد. */
class FuelStationProductPriceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'fuel_station_id' => $this->fuel_station_id,
            'fuel_product_id' => $this->fuel_product_id,
            'price_per_liter_minor' => (int) $this->price_per_liter_minor,
            'effective_from' => $this->effective_from?->toIso8601String(),
            'effective_until' => $this->effective_until?->toIso8601String(),
            'status' => $this->status,
            'reason' => $this->reason,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
