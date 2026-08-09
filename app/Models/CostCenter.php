<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\BranchShareable;
use App\Tenancy\BranchSharing;
use Closure;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @see design-system/foundations/multi-branch-architecture.md
 * تشغيلي بعزل **مشروط** بمفتاح «ربط مراكز التكلفة بين الفروع» (مفعّل افتراضياً).
 * تقرير الربحية يقرأها خارج العزل — وإلا اختفت صفوف لها قيود.
 */
class CostCenter extends BaseModel implements BranchShareable
{
    use BranchScoped;

    protected $fillable = [
        'tenant_id', 'branch_id', 'code', 'name', 'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(JournalLine::class);
    }

    public function branchSharingExemption(BranchSharing $sharing): bool|Closure
    {
        return $sharing->shared('share_cost_centers');
    }
}
