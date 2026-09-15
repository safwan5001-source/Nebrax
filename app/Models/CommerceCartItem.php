<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Ephemeral cart line. Prices and eligibility are deliberately not persisted. */
class CommerceCartItem extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'cart_id', 'product_id', 'product_variant_id', 'product_name_snapshot',
        'unit_key', 'unit_name_snapshot', 'quantity',
    ];

    protected $casts = ['quantity' => 'integer'];

    public function cart(): BelongsTo
    {
        return $this->belongsTo(CommerceCart::class, 'cart_id');
    }

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function variant(): BelongsTo
    {
        return $this->referenceBelongsTo(ProductVariant::class, 'product_variant_id');
    }
}
