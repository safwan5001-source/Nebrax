<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * نقطة جدول معايرة خزان: ارتفاع سائل بالمليمتر مقابل حجم بالمليلتر.
 * لا تُشتق منها كمية دفترية في Cycle 1؛ يستعملها Cycle 2 عند تطبيق سياسة القراءة.
 */
class FuelTankCalibrationPoint extends BaseModel implements CompanyWide
{

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_tank_id', 'level_millimeters', 'volume_milliliters',
    ];

    protected $casts = [
        'level_millimeters' => 'integer',
        'volume_milliliters' => 'integer',
    ];

    public function tank(): BelongsTo
    {
        return $this->belongsTo(FuelTank::class, 'fuel_tank_id');
    }
}
