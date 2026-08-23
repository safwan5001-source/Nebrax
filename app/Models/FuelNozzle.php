<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * فوهة وقود تشغيلية. مصدر الحقيقة للربط Pump → Tank → FuelProduct؛
 * الخدمة تفرض تطابق محطة/فرع/منتج هذه المراجع قبل الحفظ.
 */
class FuelNozzle extends BaseModel implements CompanyWide
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
        'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_pump_id', 'fuel_tank_id',
        'fuel_product_id', 'nozzle_number', 'controller_key', 'meter_opening_milliliters', 'status',
    ];

    protected $casts = [
        'meter_opening_milliliters' => 'integer',
    ];

    protected $attributes = [
        'meter_opening_milliliters' => 0,
        'status' => self::STATUS_ACTIVE,
    ];

    public function station(): BelongsTo
    {
        return $this->belongsTo(FuelStation::class, 'fuel_station_id');
    }

    public function pump(): BelongsTo
    {
        return $this->belongsTo(FuelPump::class, 'fuel_pump_id');
    }

    public function tank(): BelongsTo
    {
        return $this->belongsTo(FuelTank::class, 'fuel_tank_id');
    }

    public function fuelProduct(): BelongsTo
    {
        return $this->belongsTo(FuelProduct::class);
    }
}
