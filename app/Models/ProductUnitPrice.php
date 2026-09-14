<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * السعر الأساسي الأساسي (لا قائمة أسعار) لهويّةٍ قابلة للبيع + وحدة (VAR-PRICE-1).
 *
 * صفٌّ واحد = سعرٌ صريحٌ واحد: إما منتجٌ (`product_variant_id` فارغ) أو
 * متغيّرٌ فعلي واحد (`product_variant_id` معبَّأ)، لكل وحدة (`unit_name`) على
 * حدة. **الأب يحتفظ بسعره حتى وهو `variant_managed`** — خلافاً لـ
 * `InventoryState` — لأنه مرجعٌ تراجعيٌّ معتمَد صراحةً لسعر متغيّرٍ بلا سعرٍ
 * خاص لنفس الوحدة (@see App\Services\ProductPricingService::resolveSellable()).
 *
 * لا يُشتقّ سعر وحدةٍ بديلة من سعر وحدةٍ أخرى بضرب معامل التحويل أبداً —
 * @see docs/plans/products-inventory/AWJ_PRODUCT_VARIANTS_VAR_ARCH_1.md §4.
 *
 * `price` بالهللات (`bigint`) — لا `float` إطلاقاً، كبقية المشروع.
 */
class ProductUnitPrice extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_id', 'product_variant_id', 'unit_name', 'price',
    ];

    protected $casts = [
        'price' => 'integer',
    ];

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المنتج مشترك، والتسعير عالمي على المستأجر). */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'product_variant_id');
    }

    public function isForProduct(): bool
    {
        return $this->product_variant_id === null;
    }
}
