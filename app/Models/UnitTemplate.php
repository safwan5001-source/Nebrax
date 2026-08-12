<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\BranchShareable;
use App\Tenancy\BranchSharing;
use Closure;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * قالب وحدات: وحدة أساس (وحدة المخزون) ووحدات بديلة بمعاملات تحويل صحيحة.
 *
 * **لا أثر محاسبي مباشر:** لا يولّد قيداً. أثره غير مباشر وحاسم — المعامل
 * يضرب الكمية الداخلة إلى المخزون، فيصيب أو يخطئ متوسطَ التكلفة وكل قيد
 * تكلفة بضاعة مباعة بعده.
 *
 * @see design-system/foundations/multi-branch-architecture.md
 * تشغيلي بعزل **مشروط** بمفتاح «مشاركة المنتجات» — كالتصنيفات والعلامات: منتجٌ
 * مشترك يشير إلى قالب معزول كان سيفقد وحداته في فرعٍ دون آخر.
 */
class UnitTemplate extends BaseModel implements BranchShareable
{
    use BranchScoped;
    use SoftDeletes;

    protected $fillable = ['tenant_id', 'branch_id', 'name', 'base_unit', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    protected $attributes = ['is_active' => true];

    public function units(): HasMany
    {
        return $this->hasMany(UnitTemplateUnit::class);
    }

    public function products(): HasMany
    {
        return $this->hasMany(Product::class, 'unit_template_id');
    }

    public function branchSharingExemption(BranchSharing $sharing): bool|Closure
    {
        return $sharing->shared('share_products');
    }

    /**
     * معامل وحدة بالاسم. وحدة الأساس ليست صفّاً فتُطابَق هنا بمعامل ١، والاسم
     * المجهول يُرَدّ `null` ليقرّر المستدعي — لا يُفترَض له ١ صامتاً، فمعاملٌ
     * مفترَض على وحدة غير معرَّفة يُدخل كميةً خاطئة إلى المخزون.
     */
    public function factorFor(string $unitName): ?int
    {
        if ($unitName === $this->base_unit) {
            return 1;
        }

        $unit = $this->units->firstWhere('name', $unitName);

        return $unit?->factor;
    }
}
