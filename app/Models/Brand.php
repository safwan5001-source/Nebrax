<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\BranchShareable;
use App\Tenancy\BranchSharing;
use Closure;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * علامة تجارية. قائمة مسطّحة (لا تسلسل — العلامة لا تُشتقّ من علامة) تُستخدَم
 * للتصنيف والتصفية. **لا أثر محاسبي.**
 *
 * @see design-system/foundations/multi-branch-architecture.md
 * تشغيلي بعزل **مشروط** بمفتاح «مشاركة المنتجات» — كـ`ProductCategory` تماماً
 * وللسبب نفسه.
 */
class Brand extends BaseModel implements BranchShareable
{
    use BranchScoped;
    use SoftDeletes;

    protected $fillable = ['tenant_id', 'branch_id', 'name', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    protected $attributes = ['is_active' => true];

    public function products(): HasMany
    {
        return $this->hasMany(Product::class, 'brand_id');
    }

    public function branchSharingExemption(BranchSharing $sharing): bool|Closure
    {
        return $sharing->shared('share_products');
    }
}
