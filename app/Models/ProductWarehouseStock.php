<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** رصيد كمية منتج في مخزن — تفصيل لـ products.quantity_on_hand (بلا قيمة). */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: رصيد كمّي تابع لمخزن — العزل عبر المخزن/الفرع */
class ProductWarehouseStock extends BaseModel implements CompanyWide
{
    protected $table = 'product_warehouse_stock';

    protected $fillable = ['tenant_id', 'product_id', 'warehouse_id', 'quantity'];

    protected $casts = ['quantity' => 'integer'];

    protected $attributes = ['quantity' => 0];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }
}
