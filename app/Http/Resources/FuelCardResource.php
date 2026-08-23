<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FuelCardResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'public_identifier' => $this->public_identifier,
            'partner_id' => $this->partner_id,
            'corporate_fuel_contract_id' => $this->corporate_fuel_contract_id,
            'fuel_fleet_vehicle_id' => $this->fuel_fleet_vehicle_id,
            'fuel_fleet_driver_id' => $this->fuel_fleet_driver_id,
            'status' => $this->status,
            'effective_from' => $this->effective_from?->toIso8601String(),
            'effective_until' => $this->effective_until?->toIso8601String(),
            'per_transaction_milliliters' => $this->per_transaction_milliliters,
            'per_transaction_value_minor' => $this->per_transaction_value_minor,
            'daily_milliliters' => $this->daily_milliliters,
            'daily_value_minor' => $this->daily_value_minor,
            'weekly_milliliters' => $this->weekly_milliliters,
            'weekly_value_minor' => $this->weekly_value_minor,
            'monthly_milliliters' => $this->monthly_milliliters,
            'monthly_value_minor' => $this->monthly_value_minor,
            'daily_transaction_count' => $this->daily_transaction_count,
            'station_restriction_mode' => $this->station_restriction_mode,
            'fuel_restriction_mode' => $this->fuel_restriction_mode,
            'allowed_time_windows' => $this->allowed_time_windows,
            'station_ids' => $this->whenLoaded('stations', fn () => $this->stations->pluck('fuel_station_id')->values()),
            'fuel_product_ids' => $this->whenLoaded('fuelProducts', fn () => $this->fuelProducts->pluck('fuel_product_id')->values()),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
