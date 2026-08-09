<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر مرتجع. المبالغ بالـ minor units (هللات) كـ bigint.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر تابع لمرتجع — يتبع فرع رأسه */
class ReturnLine extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'return_id', 'product_id', 'description',
        'quantity', 'unit_price', 'tax_rate',
        'line_subtotal', 'line_tax', 'line_total',
    ];

    protected $casts = [
        'quantity'      => 'integer',
        'unit_price'    => 'integer',
        'tax_rate'      => 'integer',
        'line_subtotal' => 'integer',
        'line_tax'      => 'integer',
        'line_total'    => 'integer',
    ];

    public function return(): BelongsTo
    {
        return $this->belongsTo(ReturnDocument::class, 'return_id');
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
