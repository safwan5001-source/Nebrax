<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * حركة مخزون (دخول/خروج/تسوية) — سجل دائم.
 * التكاليف بالـ minor units (هللات) كـ bigint.
 */
class StockMovement extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'product_id', 'type', 'quantity',
        'unit_cost', 'total_cost', 'balance_quantity',
        'source_type', 'source_id', 'movement_date', 'notes',
    ];

    protected $casts = [
        'quantity'         => 'integer',
        'unit_cost'        => 'integer',
        'total_cost'       => 'integer',
        'balance_quantity' => 'integer',
        'movement_date'    => 'date',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
