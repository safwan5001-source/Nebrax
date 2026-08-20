<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** سجل تدقيق ثابت لتفعيل/إيقاف تطبيقات المؤسسة. لا يُحدَّث ولا يُحذف بعد الإنشاء. */
class TenantApplicationEvent extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'application_key',
        'action',
        'changed_by',
        'reason',
    ];

    public function changedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'changed_by');
    }
}
