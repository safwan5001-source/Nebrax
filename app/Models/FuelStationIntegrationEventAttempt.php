<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل تدقيق append-only لمحاولات معالجة أو إعادة حدث جهاز معياري. */
class FuelStationIntegrationEventAttempt extends BaseModel
{
    use BelongsToBranch;

    public $timestamps = false;

    public const ACTION_INGEST = 'ingest';
    public const ACTION_PROCESS = 'process';
    public const ACTION_RETRY = 'retry';

    public const STATUS_ACCEPTED = 'accepted';
    public const STATUS_PROCESSED = 'processed';
    public const STATUS_FAILED = 'failed';
    public const STATUS_REJECTED = 'rejected';

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_integration_event_id', 'fuel_station_device_id', 'action', 'status',
        'attempt_number', 'reason', 'performed_by', 'attempted_at',
    ];

    protected $casts = [
        'attempted_at' => 'datetime',
        'attempt_number' => 'integer',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('محاولات تكامل أجهزة المحطة سجلات تدقيق غير قابلة للتعديل.'));
        static::deleting(fn () => throw new LogicException('محاولات تكامل أجهزة المحطة سجلات تدقيق غير قابلة للحذف.'));
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(FuelStationIntegrationEvent::class, 'fuel_station_integration_event_id');
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(FuelStationDevice::class, 'fuel_station_device_id');
    }

    public function performedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'performed_by');
    }
}
