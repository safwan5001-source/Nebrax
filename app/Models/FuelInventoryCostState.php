<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * مصدر حقيقة تكلفة الوقود الدقيقة لكل منتج/مخزن. يبقى المال الدفتري بالهللات؛
 * المتوسط نسبة pool/quantity ولا يُختزل إلى unit_cost صحيح لكل mL.
 */
class FuelInventoryCostState extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'warehouse_id', 'fuel_product_id', 'quantity_milliliters', 'cost_pool_minor', 'cost_numerator_minor', 'cost_denominator', 'allocation_mode',
        'allocation_basis_quantity_milliliters', 'allocation_basis_cost_pool_minor',
        'allocation_issued_milliliters', 'allocation_posted_minor',
        'carry_remainder_numerator', 'carry_remainder_denominator',
    ];

    protected $casts = [
        'quantity_milliliters' => 'integer', 'cost_pool_minor' => 'integer',
        'allocation_basis_quantity_milliliters' => 'integer', 'allocation_basis_cost_pool_minor' => 'integer',
        'allocation_issued_milliliters' => 'integer', 'allocation_posted_minor' => 'integer',
    ];

    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
    public function fuelProduct(): BelongsTo { return $this->belongsTo(FuelProduct::class); }
}
