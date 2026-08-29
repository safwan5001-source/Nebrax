<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** قرار المؤسسة بتفعيل/إيقاف قدرة من ApplicationCatalog. صفّ واحد لكل مفتاح. */
class TenantApplicationState extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'application_key',
        'requested_enabled',
        'status',
        'changed_by',
        'changed_by_platform_administrator_id',
        'reason',
    ];

    protected $casts = [
        'requested_enabled' => 'boolean',
    ];

    protected $attributes = [
        'requested_enabled' => false,
        'status' => 'disabled',
    ];

    public function changedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'changed_by');
    }

    public function changedByPlatformAdministrator(): BelongsTo
    {
        return $this->belongsTo(PlatformAdministrator::class, 'changed_by_platform_administrator_id');
    }
}
