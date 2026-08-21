<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * باركود بديل لمنتج، ويمكن ربطه بوحدة محددة من قالب المنتج.
 *
 * التفرد على مستوى المستأجر: جهاز المسح لا يملك سياق فرعاً لحل كود متكرر.
 */
class ProductBarcode extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_id', 'code', 'unit_name', 'label', 'created_by',
    ];

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }
}
