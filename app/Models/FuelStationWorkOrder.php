<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * أمر صيانة تشغيلي. لا يمثل مصروفاً أو أصلاً محاسبياً ولا ينشئ قيداً تلقائياً؛
 * يظل أي إنفاق رسمي ضمن مسار المصروفات القائم وبمراجعة مالية مستقلة.
 */
class FuelStationWorkOrder extends BaseModel
{
    use BranchScoped;
    use GeneratesDocumentNumbers;

    public const TYPE_PREVENTIVE = 'preventive';
    public const TYPE_CORRECTIVE = 'corrective';
    public const TYPES = [self::TYPE_PREVENTIVE, self::TYPE_CORRECTIVE];

    public const STATUS_REPORTED = 'reported';
    public const STATUS_TRIAGED = 'triaged';
    public const STATUS_SCHEDULED = 'scheduled';
    public const STATUS_IN_PROGRESS = 'in_progress';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_VERIFIED = 'verified';
    public const STATUS_CLOSED = 'closed';
    public const STATUSES = [
        self::STATUS_REPORTED, self::STATUS_TRIAGED, self::STATUS_SCHEDULED,
        self::STATUS_IN_PROGRESS, self::STATUS_COMPLETED, self::STATUS_VERIFIED, self::STATUS_CLOSED,
    ];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_station_maintenance_schedule_id', 'number',
        'work_type', 'status', 'priority', 'severity', 'asset_type', 'asset_id', 'title', 'description',
        'root_cause', 'resolution', 'vendor_name', 'assigned_to', 'cost_minor', 'downtime_minutes',
        'evidence_reference', 'opened_at', 'scheduled_at', 'started_at', 'completed_at', 'verified_at',
        'closed_at', 'reported_by', 'verified_by',
    ];

    protected $casts = [
        'cost_minor' => 'integer', 'downtime_minutes' => 'integer', 'opened_at' => 'datetime',
        'scheduled_at' => 'datetime', 'started_at' => 'datetime', 'completed_at' => 'datetime',
        'verified_at' => 'datetime', 'closed_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $workOrder): void {
            if ($workOrder->getOriginal('status') === self::STATUS_CLOSED) {
                throw new LogicException('لا يعدّل أمر الصيانة المغلق مباشرة؛ أنشئ أمر تصحيح أو متابعة مدققاً.');
            }
        });
        static::deleting(fn () => throw new LogicException('لا يحذف أمر الصيانة حفاظاً على الأثر التشغيلي.'));
    }

    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function schedule(): BelongsTo { return $this->belongsTo(FuelStationMaintenanceSchedule::class, 'fuel_station_maintenance_schedule_id'); }
    public function asset(): MorphTo { return $this->morphTo(); }
    public function assignee(): BelongsTo { return $this->belongsTo(User::class, 'assigned_to'); }
    public function reporter(): BelongsTo { return $this->belongsTo(User::class, 'reported_by'); }
    public function verifier(): BelongsTo { return $this->belongsTo(User::class, 'verified_by'); }
    public function readinessEvents(): HasMany { return $this->hasMany(FuelStationReadinessEvent::class, 'subject_id')->where('subject_type', self::class); }

    public static function nextNumber(?string $date = null, string|null|false $branchId = false): string
    {
        return static::nextDocumentNumber('FMWO', $date ?? now()->toDateString(), $branchId);
    }
}
