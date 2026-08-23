<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * بنية خزان مشتركة للمؤسسة، مرتبطة بفرع المحطة لكنها لا تحمل حركة يومية.
 *
 * السعات والقراءات الافتتاحية بالمليلتر الصحيح؛ لا يعني وجودها إنشاء حركة مخزون
 * أو رصيد دفتر أستاذ. القراءات والحركات التابعة ستكون BranchScoped في Cycle 2.
 */
class FuelTank extends BaseModel implements CompanyWide
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
        'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_product_id', 'code', 'name',
        'capacity_milliliters', 'safe_capacity_milliliters', 'minimum_level_milliliters',
        'dead_stock_milliliters', 'opening_volume_milliliters', 'measurement_configuration',
        'atg_source_key', 'status',
    ];

    protected $casts = [
        'capacity_milliliters' => 'integer',
        'safe_capacity_milliliters' => 'integer',
        'minimum_level_milliliters' => 'integer',
        'dead_stock_milliliters' => 'integer',
        'opening_volume_milliliters' => 'integer',
        'measurement_configuration' => 'array',
    ];

    protected $attributes = [
        'minimum_level_milliliters' => 0,
        'dead_stock_milliliters' => 0,
        'opening_volume_milliliters' => 0,
        'status' => self::STATUS_ACTIVE,
    ];

    public function station(): BelongsTo
    {
        return $this->belongsTo(FuelStation::class, 'fuel_station_id');
    }

    public function fuelProduct(): BelongsTo
    {
        return $this->belongsTo(FuelProduct::class);
    }

    public function calibrationPoints(): HasMany
    {
        return $this->hasMany(FuelTankCalibrationPoint::class);
    }

    public function nozzles(): HasMany
    {
        return $this->hasMany(FuelNozzle::class);
    }
}
