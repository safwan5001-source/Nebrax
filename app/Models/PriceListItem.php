<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سعر محدد لهويّةٍ قابلة للبيع (منتجٌ، أو متغيّرٌ فعلي — VAR-PRICE-1) ووحدة
 * داخل قائمة أسعار المؤسسة، بالهللات. `product_variant_id` فارغٌ لعنصر منتجٍ
 * بسيط/أب؛ معبَّأٌ لعنصر متغيّرٍ فعلي بعينه.
 */
class PriceListItem extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id',
        'price_list_id',
        'product_id',
        'product_variant_id',
        'unit_name',
        'price',
    ];

    protected $casts = [
        'price' => 'integer',
    ];

    public function priceList(): BelongsTo
    {
        return $this->belongsTo(PriceList::class);
    }

    /** مرجع منتج محفوظ على عنصر شركة؛ يحل خارج تصفية الفرع عند عرض القائمة. */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'product_variant_id');
    }
}
