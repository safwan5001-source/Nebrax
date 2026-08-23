<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل تدقيق append-only لتغييرات إعدادات Fuel Stations الحساسة. */
class FuelStationConfigurationEvent extends BaseModel implements CompanyWide
{
    public $timestamps = false;

    protected $fillable = [
        'tenant_id',
        'fuel_station_id',
        'device_key',
        'setting_key',
        'before',
        'after',
        'changed_by',
        'reason',
        'changed_at',
    ];

    protected $casts = [
        'before' => 'array',
        'after' => 'array',
        'changed_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Fuel station configuration audit events are immutable.'));
        static::deleting(fn () => throw new LogicException('Fuel station configuration audit events cannot be deleted.'));
    }

    public function station(): BelongsTo
    {
        return $this->belongsTo(FuelStation::class, 'fuel_station_id');
    }

    public function changedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'changed_by');
    }
}
