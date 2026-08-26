<?php

namespace App\Models;

use App\Models\Concerns\HasUnitConversion;
use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** @see design-system/foundations/multi-branch-architecture.md — يتبع فرع رأس سند التسليم. */
class DeliveryNoteLine extends BaseModel implements CompanyWide
{
    use HasUnitConversion;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'delivery_note_id', 'line_number', 'product_id',
        'product_name_snapshot', 'product_sku_snapshot', 'product_barcode_snapshot',
        'unit_name', 'unit_factor', 'quantity', 'quantity_numerator', 'quantity_denominator', 'description',
    ];

    protected $casts = [
        'line_number' => 'integer',
        'unit_factor' => 'integer',
        'quantity' => 'integer',
        'quantity_numerator' => 'integer',
        'quantity_denominator' => 'integer',
    ];

    public function deliveryNote(): BelongsTo
    {
        return $this->belongsTo(DeliveryNote::class);
    }

    /** مرجع محفوظ؛ لا يختفي من السند المؤكد عند تغير نطاق عرض المنتج لاحقاً. */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }
}
