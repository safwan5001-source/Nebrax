<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * برنامج صيانة وقائي يصف متى يستحق العمل، ولا يستنتج قراءة أجهزة أو يشغّل
 * مهمةً خلفيةً من دون مصدر بيانات معتمد.
 */
class FuelStationMaintenanceSchedule extends BaseModel
{
    use BranchScoped;

    public const TYPE_CALENDAR = 'calendar';
    public const TYPE_RUNTIME = 'runtime';
    public const TYPE_METER = 'meter';
    public const TYPES = [self::TYPE_CALENDAR, self::TYPE_RUNTIME, self::TYPE_METER];

    public const STATUS_ACTIVE = 'active';
    public const STATUS_SUSPENDED = 'suspended';
    public const STATUSES = [self::STATUS_ACTIVE, self::STATUS_SUSPENDED];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'asset_type', 'asset_id', 'name',
        'schedule_type', 'interval_days', 'interval_milliliters', 'manufacturer_interval',
        'status', 'last_completed_at', 'next_due_at', 'instructions', 'created_by',
    ];

    protected $casts = [
        'interval_days' => 'integer',
        'interval_milliliters' => 'integer',
        'last_completed_at' => 'datetime',
        'next_due_at' => 'datetime',
    ];

    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function asset(): MorphTo { return $this->morphTo(); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function workOrders(): HasMany { return $this->hasMany(FuelStationWorkOrder::class); }
}
