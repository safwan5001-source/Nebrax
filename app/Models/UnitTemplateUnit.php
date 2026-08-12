<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * وحدة بديلة داخل قالب: الاسم ومعامل التحويل إلى وحدة الأساس.
 *
 * @see design-system/foundations/multi-branch-architecture.md
 * **`CompanyWide` بإقرار واعٍ:** سطرٌ تابع لقالبه لا كيان مستقلّ. العزل يقع
 * على `UnitTemplate` وحده؛ وعزلُ السطور مرّة ثانية كان يُخفي وحدات قالبٍ
 * مرئيّ — قالبٌ بلا وحداته أسوأ من قالب مخفيّ.
 */
class UnitTemplateUnit extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'unit_template_id', 'name', 'factor'];

    protected $casts = ['factor' => 'integer'];

    public function template(): BelongsTo
    {
        return $this->belongsTo(UnitTemplate::class, 'unit_template_id');
    }
}
