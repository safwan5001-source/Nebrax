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
        'tenant_id', 'branch_id', 'code', 'name', 'country_code', 'region', 'city', 'address',
        'latitude', 'longitude', 'manager_id', 'status', 'timezone', 'operating_day_starts_at',
        'operating_hours', 'license_number', 'license_expires_at', 'zatca_branch_reference',
        'default_inventory_account_id', 'default_revenue_account_id', 'default_cogs_account_id',
    ];

    protected $casts = [
        'latitude' => 'decimal:7',
        'longitude' => 'decimal:7',
        'operating_hours' => 'array',
        'license_expires_at' => 'date',
    ];

    protected $attributes = [
        'status' => self::STATUS_ACTIVE,
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function manager(): BelongsTo
    {
        return $this->belongsTo(User::class, 'manager_id');
    }

    public function defaultInventoryAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'default_inventory_account_id');
    }

    public function defaultRevenueAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'default_revenue_account_id');
    }

    public function defaultCogsAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'default_cogs_account_id');
    }

    public function tanks(): HasMany
    {
        return $this->hasMany(FuelTank::class);
    }

    public function pumps(): HasMany
    {
        return $this->hasMany(FuelPump::class);
    }

    public function nozzles(): HasMany
    {
        return $this->hasMany(FuelNozzle::class);
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
