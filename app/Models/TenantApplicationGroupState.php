<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** قرار المؤسسة بتفعيل/تعطيل تطبيق رئيسي مع حفظ حالات قدراته الفرعية. */
class TenantApplicationGroupState extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'group_key',
        'requested_enabled',
        'changed_by',
        'reason',
    ];

    protected $casts = [
        'requested_enabled' => 'boolean',
    ];

    protected $attributes = [
        'requested_enabled' => true,
    ];

    public function changedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'changed_by');
    }
}
