<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل تدقيق ثابت لتفعيل/إيقاف تطبيقات المؤسسة. لا يُحدَّث ولا يُحذف بعد الإنشاء. */
class TenantApplicationEvent extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'application_key',
        'action',
        'changed_by',
        'changed_by_platform_administrator_id',
        'reason',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Tenant application events are immutable.'));
        static::deleting(fn () => throw new LogicException('Tenant application events cannot be deleted.'));
    }

    public function changedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'changed_by');
    }

    public function changedByPlatformAdministrator(): BelongsTo
    {
        return $this->belongsTo(PlatformAdministrator::class, 'changed_by_platform_administrator_id');
    }
}
