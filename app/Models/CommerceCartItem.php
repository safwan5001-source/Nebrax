<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Ephemeral cart line. Prices and eligibility are deliberately not persisted. */
class CommerceCartItem extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'cart_id', 'product_id', 'product_variant_id', 'product_name_snapshot',
        'unit_key', 'unit_name_snapshot', 'quantity', 'personalization_signature',
        'parent_item_id', 'per_parent_quantity',
    ];

    protected $casts = ['quantity' => 'integer', 'per_parent_quantity' => 'integer'];

    protected $attributes = ['personalization_signature' => ''];

    /** FLOWERS-H4b / ADR-16 — قيم التخصيص (لقطة تسمية + قيمة). فارغة لسطر عادي. */
    public function personalizations(): HasMany
    {
        return $this->hasMany(CommerceCartItemPersonalization::class, 'cart_item_id')->orderBy('sort_order');
    }

    /** FLOWERS-H6 / ADR-18 — سطر الأب لسطر إضافة (null لسطر عادي). */
    public function parentItem(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_item_id');
    }

    /** FLOWERS-H6 / ADR-18 — أسطر الإضافات المرتبطة بهذا السطر. */
    public function addonItems(): HasMany
    {
        return $this->hasMany(self::class, 'parent_item_id')->orderBy('created_at')->orderBy('id');
    }

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
