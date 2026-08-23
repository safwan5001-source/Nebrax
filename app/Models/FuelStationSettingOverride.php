<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** إعداد override لمحطة أو لجهاز/طرف داخلها؛ المفتاح الفارغ يعني مستوى المحطة. */
class FuelStationSettingOverride extends BaseModel implements CompanyWide
{
    public $timestamps = false;

    protected $fillable = [
        'tenant_id',
        'fuel_station_id',
        'device_key',
        'setting_key',
        'value',
        'updated_at',
    ];

    protected $casts = [
        'value' => 'array',
        'updated_at' => 'datetime',
    ];

    public function station(): BelongsTo
    {
        return $this->belongsTo(FuelStation::class, 'fuel_station_id');
    }
}
