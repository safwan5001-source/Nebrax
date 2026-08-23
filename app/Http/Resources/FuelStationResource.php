<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\FuelStation */
class FuelStationResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'branch' => $this->whenLoaded('branch', fn () => ['id' => $this->branch?->id, 'name' => $this->branch?->name, 'code' => $this->branch?->code]),
            'code' => $this->code,
            'name' => $this->name,
            'country_code' => $this->country_code,
            'region' => $this->region,
            'city' => $this->city,
            'address' => $this->address,
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,
            'manager_id' => $this->manager_id,
            'manager' => $this->whenLoaded('manager', fn () => ['id' => $this->manager?->id, 'name' => $this->manager?->name]),
            'status' => $this->status,
            'timezone' => $this->timezone,
            'operating_day_starts_at' => $this->operating_day_starts_at,
            'operating_hours' => $this->operating_hours,
            'license_number' => $this->license_number,
            'license_expires_at' => $this->license_expires_at?->toDateString(),
            'zatca_branch_reference' => $this->zatca_branch_reference,
            'default_inventory_account_id' => $this->default_inventory_account_id,
            'default_revenue_account_id' => $this->default_revenue_account_id,
            'default_cogs_account_id' => $this->default_cogs_account_id,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
