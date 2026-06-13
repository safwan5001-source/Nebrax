<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * منتج أو خدمة. الأسعار بالـ minor units (هللات) كـ bigint — لا float إطلاقاً.
 * tax_rate نسبة مئوية صحيحة (15 = 15%).
 */
class Product extends BaseModel
{
    use SoftDeletes;

    protected $fillable = [
        'tenant_id', 'sku', 'name', 'name_en', 'type', 'unit',
        'sale_price', 'purchase_price', 'tax_rate', 'track_inventory', 'is_active',
    ];

    protected $casts = [
        'sale_price'      => 'integer',
        'purchase_price'  => 'integer',
        'tax_rate'        => 'integer',
        'track_inventory' => 'boolean',
        'is_active'       => 'boolean',
    ];

    protected $attributes = [
        'type'            => 'good',
        'unit'            => 'piece',
        'sale_price'      => 0,
        'purchase_price'  => 0,
        'tax_rate'        => 15,
        'track_inventory' => false,
        'is_active'       => true,
    ];

    public function isService(): bool
    {
        return $this->type === 'service';
    }
}
