<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * FLOWERS-H6 / ADR-18 — علاقة إضافة صريحة: منتج أب ⇐ منتج (أو متغيّر) حقيقي يُباع كسطر
 * مستقل بسعره ومخزونه الأصليين. لا سعر ولا مخزون هنا. `saving` يتحقق بنيوياً أن الأب
 * والإضافة (والمتغيّر إن وُجد) كلها لمستأجر واحد وأن الأب ليس هو الإضافة.
 */
class CommerceProductAddon extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const MAX_QUANTITY_CEILING = 10;

    protected $fillable = ['tenant_id', 'product_id', 'addon_product_id', 'addon_variant_id', 'max_quantity', 'sort_order', 'is_active'];

    protected $casts = ['max_quantity' => 'integer', 'sort_order' => 'integer', 'is_active' => 'boolean'];

    protected $attributes = ['max_quantity' => 1, 'sort_order' => 0, 'is_active' => true];

    protected static function booted(): void
    {
        static::saving(function (self $addon) {
            if ($addon->product_id === $addon->addon_product_id) {
                throw new RuntimeException('لا يمكن ربط المنتج بنفسه كإضافة.');
            }
            if ($addon->max_quantity < 1 || $addon->max_quantity > self::MAX_QUANTITY_CEILING) {
                throw new RuntimeException('الحد الأقصى لكمية الإضافة خارج النطاق المسموح.');
            }

            $tenantId = $addon->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }
            $products = Product::withoutGlobalScopes()->select(['id', 'tenant_id'])->whereIn('id', [$addon->product_id, $addon->addon_product_id])->get();
            if ($products->count() !== 2 || $products->contains(fn ($p) => $p->tenant_id !== $tenantId)) {
                throw new RuntimeException('المنتج غير موجود لهذا المستأجر.');
            }
            if ($addon->addon_variant_id !== null) {
                $variant = ProductVariant::withoutGlobalScopes()->select(['id', 'tenant_id', 'product_id'])->find($addon->addon_variant_id);
                if ($variant === null || $variant->tenant_id !== $tenantId || $variant->product_id !== $addon->addon_product_id) {
                    throw new RuntimeException('متغيّر الإضافة لا يخص منتج الإضافة.');
                }
            }
        });
    }

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function addonProduct(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class, 'addon_product_id');
    }
}
