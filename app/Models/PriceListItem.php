<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** سعر محدد لمنتج ووحدة داخل قائمة أسعار المؤسسة، بالهللات. */
class PriceListItem extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id',
        'price_list_id',
        'product_id',
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
}
