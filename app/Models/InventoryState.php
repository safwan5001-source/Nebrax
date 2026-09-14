<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * هويّة المخزون والتقييم الموحّدة (VAR-INV-1).
 *
 * صفٌّ واحد = مرجعٌ واحد للكمية والمتوسط: إما منتجٌ بسيط (`product_variant_id`
 * فارغ) أو متغيّرٌ فعلي واحد (`product_variant_id` معبَّأ). لا صفّ يمثّل الأب
 * لمنتجٍ `variant_managed` أبداً — @see docs/plans/products-inventory/AWJ_PRODUCT_VARIANTS_VAR_ARCH_1.md §3.
 *
 * **الإنشاء كسول** عبر `InventoryService::resolveInventoryState()` — لا صفّ
 * حتى أول عمليةٍ تمسّ مخزون هذه الهويّة فعلاً؛ @see migration الترحيل لتعليل
 * ذلك ودلالته لـ `ProductReferenceRegistry::INVENTORY_SEMANTIC`.
 *
 * `avg_cost` بالهللات (`bigint`) — لا `float` إطلاقاً، كبقية المشروع.
 */
class InventoryState extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_id', 'product_variant_id', 'quantity_on_hand', 'avg_cost',
    ];

    protected $casts = [
        'quantity_on_hand' => 'integer',
        'avg_cost' => 'integer',
    ];

    protected $attributes = [
        'quantity_on_hand' => 0,
        'avg_cost' => 0,
    ];

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المنتج مشترك، والهويّة عالمية على المستأجر). */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'product_variant_id');
    }

    public function isSimple(): bool
    {
        return $this->product_variant_id === null;
    }
}
