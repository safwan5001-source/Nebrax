<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** سجل تدقيق ثابت لتفعيل/تعطيل التطبيقات الرئيسية للمؤسسة. */
class TenantApplicationGroupEvent extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'group_key',
        'action',
        'changed_by',
        'reason',
    ];

    public function changedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'changed_by');
    }
}
