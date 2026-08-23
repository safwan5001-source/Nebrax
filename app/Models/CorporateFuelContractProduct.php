<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** منتج وقود مختار صراحةً في عقد يملك fuel_restriction_mode=selected. */
class CorporateFuelContractProduct extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = ['tenant_id', 'corporate_fuel_contract_id', 'fuel_product_id'];

    public function contract(): BelongsTo
    {
        return $this->referenceBelongsTo(CorporateFuelContract::class, 'corporate_fuel_contract_id');
    }

    public function fuelProduct(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelProduct::class);
    }
}
