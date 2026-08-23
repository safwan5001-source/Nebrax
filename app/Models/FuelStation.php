<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * محطة وقود تنظيمية داخل المستأجر.
 *
 * لا تُعزل المحطة بالفرع لأن المدير المركزي يحتاج إدارتها ومقارنتها، لكنها تربط
 * فرعاً محاسبياً موثوقاً تستخدمه العمليات اللاحقة بعد أن تتحقق طبقة الخدمة من
 * علاقة المحطة/الفرع. أما السجلات التشغيلية داخل المحطة فستُصنّف BranchScoped
 * أو BelongsToBranch صراحةً عند إنشائها في الدورات اللاحقة.
 */
class FuelStation extends BaseModel implements CompanyWide
{
    public const STATUS_ACTIVE = 'active';
    public const STATUS_INACTIVE = 'inactive';
    public const STATUS_MAINTENANCE = 'maintenance';

    public const STATUSES = [
        self::STATUS_ACTIVE,
        self::STATUS_INACTIVE,
        self::STATUS_MAINTENANCE,
    ];

    protected $fillable = [
        'tenant_id',
        'branch_id',
        'code',
        'name',
        'status',
        'timezone',
        'operating_day_starts_at',
    ];

    protected $attributes = [
        'status' => self::STATUS_ACTIVE,
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function settingOverrides(): HasMany
    {
        return $this->hasMany(FuelStationSettingOverride::class);
    }

    public function integrationEvents(): HasMany
    {
        return $this->hasMany(FuelStationIntegrationEvent::class);
    }
}
