<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** بنية مضخة مشتركة للمؤسسة؛ تعيين الخزان والمنتج يتم على مستوى الفوهة. */
class FuelPump extends BaseModel implements CompanyWide
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
        'tenant_id', 'branch_id', 'fuel_station_id', 'pump_number', 'name', 'controller_key', 'status',
    ];

    protected $attributes = [
        'status' => self::STATUS_ACTIVE,
    ];

    public function station(): BelongsTo
    {
        return $this->belongsTo(FuelStation::class, 'fuel_station_id');
    }

    public function nozzles(): HasMany
    {
        return $this->hasMany(FuelNozzle::class);
    }
}
