<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** محطة مختارة صراحةً في عقد يملك station_restriction_mode=selected. */
class CorporateFuelContractStation extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = ['tenant_id', 'corporate_fuel_contract_id', 'fuel_station_id'];

    public function contract(): BelongsTo
    {
        return $this->referenceBelongsTo(CorporateFuelContract::class, 'corporate_fuel_contract_id');
    }

    public function station(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelStation::class, 'fuel_station_id');
    }
}
