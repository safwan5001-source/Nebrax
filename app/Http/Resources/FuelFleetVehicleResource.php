<?php

namespace App\Http\Resources;

use App\Support\Rbac;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * FS-35: قائمة حقول صريحة بدل النموذج الخام. رقم الهيكل (VIN) لا يظهر إلا لمن يدير الأسطول (`fuel.fleet.manage`)؛
 * ولا يخرج `tenant_id` ولا `created_by`.
 */
class FuelFleetVehicleResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $manager = $user !== null && Rbac::allows((string) $user->role, 'fuel.fleet.manage');

        return [
            'id' => $this->id,
            'partner_id' => $this->partner_id,
            'corporate_fuel_contract_id' => $this->corporate_fuel_contract_id,
            'plate_number' => $this->plate_number,
            'plate_country' => $this->plate_country,
            'fleet_number' => $this->fleet_number,
            'fuel_type' => $this->fuel_type,
            'tank_capacity_milliliters' => $this->tank_capacity_milliliters === null ? null : (int) $this->tank_capacity_milliliters,
            'odometer' => $this->odometer === null ? null : (int) $this->odometer,
            'status' => $this->status,
            'vin' => $this->when($manager, fn () => $this->vin),
            'allowed_fuel_products' => $this->whenLoaded('allowedFuelProducts', fn () => $this->allowedFuelProducts->map(fn ($row) => [
                'id' => $row->id,
                'fuel_product_id' => $row->fuel_product_id,
            ])->values()),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
