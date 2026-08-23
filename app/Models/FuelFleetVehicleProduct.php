<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** منتج وقود مسموح لمركبة؛ غياب صفوفه يعني عدم وجود قيد منتج على المركبة. */
class FuelFleetVehicleProduct extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = ['tenant_id', 'fuel_fleet_vehicle_id', 'fuel_product_id'];

    public function vehicle(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelFleetVehicle::class, 'fuel_fleet_vehicle_id');
    }

    public function fuelProduct(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelProduct::class);
    }
}
