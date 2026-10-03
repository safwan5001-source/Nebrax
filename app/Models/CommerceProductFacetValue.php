<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * FLOWERS-H2 / ADR-14 — إسناد منتج إلى قيمة بُعد (متعدد القيم).
 *
 * المنتج مرجع مخزَّن لا يُصفّى بالفرع (`ResolvesBranchReferences`). `saving`
 * يتحقق بنيوياً أن المنتج والقيمة كليهما يخصّان المستأجر نفسه.
 */
class CommerceProductFacetValue extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = ['tenant_id', 'product_id', 'commerce_facet_value_id'];

    protected static function booted(): void
    {
        static::saving(function (self $assignment) {
            $tenantId = $assignment->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $product = Product::withoutGlobalScopes()->select(['id', 'tenant_id'])->find($assignment->product_id);
            if ($product === null || $product->tenant_id !== $tenantId) {
                throw new RuntimeException('المنتج غير موجود لهذا المستأجر.');
            }

            $value = CommerceFacetValue::withoutGlobalScope(TenantScope::class)
                ->select(['id', 'tenant_id'])
                ->find($assignment->commerce_facet_value_id);
            if ($value === null || $value->tenant_id !== $tenantId) {
                throw new RuntimeException('قيمة البُعد غير موجودة لهذا المستأجر.');
            }
        });
    }

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function value(): BelongsTo
    {
        return $this->belongsTo(CommerceFacetValue::class, 'commerce_facet_value_id');
    }
}
