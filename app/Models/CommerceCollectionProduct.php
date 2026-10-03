<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * FLOWERS-H2 / ADR-14 §2.3 — عضوية منتج في مجموعة مع ترتيب. المنتج مرجع مخزَّن
 * لا يُصفّى بالفرع؛ `saving` يتحقق بنيوياً أن المنتج والمجموعة للمستأجر نفسه.
 */
class CommerceCollectionProduct extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = ['tenant_id', 'commerce_collection_id', 'product_id', 'position'];

    protected $casts = ['position' => 'integer'];

    protected $attributes = ['position' => 0];

    protected static function booted(): void
    {
        static::saving(function (self $member) {
            $tenantId = $member->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $product = Product::withoutGlobalScopes()->select(['id', 'tenant_id'])->find($member->product_id);
            if ($product === null || $product->tenant_id !== $tenantId) {
                throw new RuntimeException('المنتج غير موجود لهذا المستأجر.');
            }

            $collection = CommerceCollection::withoutGlobalScope(TenantScope::class)
                ->select(['id', 'tenant_id'])
                ->find($member->commerce_collection_id);
            if ($collection === null || $collection->tenant_id !== $tenantId) {
                throw new RuntimeException('المجموعة غير موجودة لهذا المستأجر.');
            }
        });
    }

    public function collection(): BelongsTo
    {
        return $this->belongsTo(CommerceCollection::class, 'commerce_collection_id');
    }

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }
}
