<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** إسناد تشغيلي بين سائق ومركبة داخل المستأجر. */
class FuelFleetDriverVehicle extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = ['tenant_id', 'fuel_fleet_driver_id', 'fuel_fleet_vehicle_id'];

    public function driver(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelFleetDriver::class, 'fuel_fleet_driver_id');
    }

    public function vehicle(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelFleetVehicle::class, 'fuel_fleet_vehicle_id');
    }
}
