<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * سجل جهاز تشغيلي محايد عن المورد. device_key هو هوية مصدر عامة غير سرية،
 * بينما credential_reference مؤشر خارجي فقط ولا يحمل اعتماد اتصال خام.
 */
class FuelStationDevice extends BaseModel
{
    use BelongsToBranch;

    public const TYPE_FORECOURT_CONTROLLER = 'forecourt_controller';
    public const TYPE_ATG = 'atg';
    public const TYPE_RFID_READER = 'rfid_reader';
    public const TYPE_PAYMENT_TERMINAL = 'payment_terminal';
    public const TYPE_STATION_GATEWAY = 'station_gateway';

    public const STATUS_ACTIVE = 'active';
    public const STATUS_DISABLED = 'disabled';
    public const STATUS_RETIRED = 'retired';

    public const HEALTH_UNKNOWN = 'unknown';
    public const HEALTH_ONLINE = 'online';
    public const HEALTH_DEGRADED = 'degraded';
    public const HEALTH_OFFLINE = 'offline';

    public const SYNC_IDLE = 'idle';
    public const SYNC_SYNCING = 'syncing';
    public const SYNC_FAILED = 'failed';

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'device_key', 'name', 'device_type', 'status', 'adapter_key',
        'manufacturer', 'model', 'serial_number', 'firmware_version', 'protocol', 'external_identifier',
        'endpoint_metadata', 'credential_reference', 'health', 'sync_status', 'last_seen_at', 'last_event_at',
        'last_failure_at', 'last_failure_reason', 'created_by',
    ];

    protected $casts = [
        'endpoint_metadata' => 'array',
        'last_seen_at' => 'datetime',
        'last_event_at' => 'datetime',
        'last_failure_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::deleting(function (self $device): void {
            if ($device->events()->exists()) {
                throw new LogicException('لا يمكن حذف جهاز له أحداث تكامل مسجلة؛ عطّله أو أحله إلى التقاعد بدلاً من ذلك.');
            }
        });
    }

    public function station(): BelongsTo
    {
        return $this->belongsTo(FuelStation::class, 'fuel_station_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(FuelStationIntegrationEvent::class, 'fuel_station_device_id');
    }

    public function attempts(): HasMany
    {
        return $this->hasMany(FuelStationIntegrationEventAttempt::class, 'fuel_station_device_id');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
