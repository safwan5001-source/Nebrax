<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** منتج وقود مختار لبطاقة تملك fuel_restriction_mode=selected. */
class FuelCardProduct extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = ['tenant_id', 'fuel_card_id', 'fuel_product_id'];

    public function card(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelCard::class, 'fuel_card_id');
    }

    public function fuelProduct(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelProduct::class, 'fuel_product_id');
    }
}
