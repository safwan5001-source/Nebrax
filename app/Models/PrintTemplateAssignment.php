<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * تعيين مراجعة قالب منشورة لسياق طباعة.
 *
 * `branch_id = null` هو افتراضي المؤسسة، ووجود فرع هو تجاوز محلي فقط. يبقى
 * النموذج CompanyWide عمداً: الخدمة تحلّ أولوية الفرع ثم المؤسسة في نقطة واحدة؛
 * لا يطبق عليه BranchScope كي لا يختفي الافتراضي العام قبل أن تقرأه الخدمة.
 */
class PrintTemplateAssignment extends BaseModel implements CompanyWide
{
    public const USAGE_PRINT = 'print';
    public const USAGE_PDF = 'pdf';
    public const USAGE_THERMAL = 'thermal';

    protected $fillable = [
        'tenant_id', 'branch_id', 'document_type', 'usage',
        'print_template_revision_id', 'created_by',
    ];

    public function revision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'print_template_revision_id');
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
