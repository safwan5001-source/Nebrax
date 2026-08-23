<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FuelAviAuthorizationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'fuel_station_id' => $this->fuel_station_id,
            'fuel_nozzle_id' => $this->fuel_nozzle_id,
            'fuel_product_id' => $this->fuel_product_id,
            'vehicle_identity_tag_id' => $this->vehicle_identity_tag_id,
            'driver_identity_tag_id' => $this->driver_identity_tag_id,
            'partner_id' => $this->partner_id,
            'corporate_fuel_contract_id' => $this->corporate_fuel_contract_id,
            'fuel_card_id' => $this->fuel_card_id,
            'fuel_fleet_vehicle_id' => $this->fuel_fleet_vehicle_id,
            'fuel_fleet_driver_id' => $this->fuel_fleet_driver_id,
            'fuel_sale_id' => $this->fuel_sale_id,
            'identity_mode' => $this->identity_mode,
            'quantity_milliliters' => $this->quantity_milliliters,
            'odometer' => $this->odometer,
            'decision' => $this->decision,
            'reason_code' => $this->reason_code,
            'suspicion_signals' => $this->suspicion_signals ?? [],
            'authorized_at' => $this->authorized_at?->toIso8601String(),
            'expires_at' => $this->expires_at?->toIso8601String(),
            'finalization_checked_at' => $this->finalization_checked_at?->toIso8601String(),
            'requested_by' => $this->requested_by,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
