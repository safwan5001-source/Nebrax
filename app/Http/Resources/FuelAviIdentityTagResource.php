<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FuelAviIdentityTagResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'public_identifier' => $this->public_identifier,
            'identity_type' => $this->identity_type,
            'partner_id' => $this->partner_id,
            'corporate_fuel_contract_id' => $this->corporate_fuel_contract_id,
            'fuel_card_id' => $this->fuel_card_id,
            'fuel_fleet_vehicle_id' => $this->fuel_fleet_vehicle_id,
            'fuel_fleet_driver_id' => $this->fuel_fleet_driver_id,
            'status' => $this->status,
            'effective_from' => $this->effective_from?->toIso8601String(),
            'effective_until' => $this->effective_until?->toIso8601String(),
            'replaces_fuel_avi_identity_tag_id' => $this->replaces_fuel_avi_identity_tag_id,
            'created_by' => $this->created_by,
            'created_at' => $this->created_at?->toIso8601String(),
            'partner' => PartnerResource::make($this->whenLoaded('partner')),
        ];
    }
}
