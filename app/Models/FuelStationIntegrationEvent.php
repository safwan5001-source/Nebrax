<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * حدث خارجي معياري append-only. لا يمثل رصيداً محاسبياً ولا حركة مخزون؛ إنما
 * دليل إدخال قابل للتتبع تعالجه دورات المجال اللاحقة بعد نجاح التحقق والإزالة
 * الحتمية للتكرار.
 */
class FuelStationIntegrationEvent extends BaseModel
{
    public $timestamps = false;

    use BelongsToBranch;

    public const STATUS_ACCEPTED = 'accepted';
    public const STATUS_PROCESSED = 'processed';
    public const STATUS_FAILED = 'failed';

    protected $fillable = [
        'tenant_id',
        'branch_id',
        'fuel_station_id',
        'fuel_station_device_id',
        'source_id',
        'event_id',
        'sequence',
        'event_type',
        'occurred_at',
        'correlation_id',
        'checksum',
        'payload',
        'status',
        'retry_count',
        'received_at',
        'processed_at',
        'failure_reason',
    ];

    protected $casts = [
        'sequence' => 'integer',
        'retry_count' => 'integer',
        'occurred_at' => 'datetime',
        'payload' => 'array',
        'received_at' => 'datetime',
        'processed_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('Fuel station integration events cannot be deleted.'));
    }

    public function station(): BelongsTo
    {
        return $this->belongsTo(FuelStation::class, 'fuel_station_id');
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(FuelStationDevice::class, 'fuel_station_device_id');
    }

    public function attempts(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(FuelStationIntegrationEventAttempt::class, 'fuel_station_integration_event_id');
    }
}
