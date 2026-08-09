<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * نشاط في سجلّ علاقات العملاء (CRM) — غير محاسبي.
 */
/** @see design-system/foundations/multi-branch-architecture.md — تشغيلي: معزول بالفرع */
class CrmActivity extends BaseModel
{
    use BranchScoped;

    protected $table = 'crm_activities';

    protected $fillable = [
        'tenant_id', 'branch_id', 'partner_id', 'type', 'subject', 'activity_at', 'status', 'notes', 'created_by',
    ];

    protected $casts = [
        'activity_at' => 'datetime',
    ];

    protected $attributes = [
        'type'   => 'note',
        'status' => 'open',
    ];

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }
}
