<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\BranchShareable;
use App\Tenancy\BranchSharing;
use Closure;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * تصنيف منتجات متعدّد المستويات. كيان تجميع وتصفية بحت — **لا أثر محاسبي**:
 * لا حساب مرتبط به ولا قيد يُولَّد منه.
 *
 * @see design-system/foundations/multi-branch-architecture.md
 * تشغيلي بعزل **مشروط** بمفتاح «مشاركة المنتجات» نفسه الذي يحكم `Product`.
 * ربطُه بمفتاح آخر كان سيسمح بحالة فاسدة: منتجٌ مشترك بين الفروع يشير إلى
 * تصنيف معزول لا يراه الفرع الحالي — فيظهر المنتج بلا تصنيف بلا سبب مفهوم.
 */
class ProductCategory extends BaseModel implements BranchShareable
{
    use BranchScoped;
    use SoftDeletes;

    protected $fillable = ['tenant_id', 'branch_id', 'parent_id', 'name', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    protected $attributes = ['is_active' => true];

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    public function products(): HasMany
    {
        return $this->hasMany(Product::class, 'category_id');
    }

    public function branchSharingExemption(BranchSharing $sharing): bool|Closure
    {
        return $sharing->shared('share_products');
    }
}
