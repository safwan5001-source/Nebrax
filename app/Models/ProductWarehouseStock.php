<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** رصيد كمية منتج في مخزن — تفصيل لـ products.quantity_on_hand (بلا قيمة). */
class ProductWarehouseStock extends BaseModel
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
