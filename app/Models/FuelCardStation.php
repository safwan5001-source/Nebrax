<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** محطة مختارة لبطاقة تملك station_restriction_mode=selected. */
class FuelCardStation extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = ['tenant_id', 'fuel_card_id', 'fuel_station_id'];

    public function card(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelCard::class, 'fuel_card_id');
    }

    public function station(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelStation::class, 'fuel_station_id');
    }
}
