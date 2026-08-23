<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

/**
 * وردية تشغيل محطة الوقود؛ لا تمثل مبيعات أو مدفوعات أو قيوداً محاسبية.
 * status=approved يعني أن اللقطة التشغيلية قُفلت ولا تتغير مباشرة.
 */
class FuelShift extends BaseModel
{
    use BranchScoped;
    use GeneratesDocumentNumbers;

    public const STATUS_OPEN = 'open';
    public const STATUS_CLOSED = 'closed';
    public const STATUS_APPROVED = 'approved';
    public const STATUSES = [self::STATUS_OPEN, self::STATUS_CLOSED, self::STATUS_APPROVED];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'number', 'status',
        'opening_float_minor', 'counted_cash_minor', 'expected_operational_cash_minor', 'cash_variance_minor',
        'operational_meter_milliliters', 'operational_delivery_milliliters', 'operational_tank_variance_milliliters',
        'active_terminal_keys', 'opening_note', 'closing_note',
        'opened_by', 'closed_by', 'approved_by', 'opened_at', 'closed_at', 'approved_at', 'locked_at', 'idempotency_key',
    ];

    protected $casts = [
        'opening_float_minor' => 'integer',
        'counted_cash_minor' => 'integer',
        'expected_operational_cash_minor' => 'integer',
        'cash_variance_minor' => 'integer',
        'operational_meter_milliliters' => 'integer',
        'operational_delivery_milliliters' => 'integer',
        'operational_tank_variance_milliliters' => 'integer',
        'active_terminal_keys' => 'array',
        'opened_at' => 'datetime',
        'closed_at' => 'datetime',
        'approved_at' => 'datetime',
        'locked_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => self::STATUS_OPEN,
        'opening_float_minor' => 0,
        'operational_meter_milliliters' => 0,
        'operational_delivery_milliliters' => 0,
    ];

    protected static function booted(): void
    {
        static::updating(function (self $shift): void {
            $original = $shift->getOriginal('status');
            $current = $shift->status;
            $allowed = match ($original) {
                self::STATUS_OPEN => [self::STATUS_CLOSED],
                self::STATUS_CLOSED => [self::STATUS_APPROVED],
                default => [],
            };
            if (! in_array($current, $allowed, true)) {
                throw new LogicException('لا يعدّل سجل الشفت مباشرة؛ لا يسمح إلا بانتقال lifecycle التالي عبر الخدمة.');
            }
            $allowedFields = $current === self::STATUS_CLOSED
                ? ['status', 'counted_cash_minor', 'expected_operational_cash_minor', 'cash_variance_minor', 'operational_meter_milliliters', 'operational_delivery_milliliters', 'operational_tank_variance_milliliters', 'closing_note', 'closed_by', 'closed_at', 'updated_at']
                : ['status', 'approved_by', 'approved_at', 'locked_at', 'updated_at'];
            if (array_diff(array_keys($shift->getDirty()), $allowedFields) !== []) {
                throw new LogicException('حقول الشفت الانتقالية لا تعدّل إلا في مرحلة lifecycle المسموح بها.');
            }
        });
        static::deleting(function (self $shift): void {
            if ($shift->status !== self::STATUS_OPEN) {
                throw new LogicException('لا يمكن حذف وردية مغلقة أو معتمدة.');
            }
        });
    }

    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function opener(): BelongsTo { return $this->belongsTo(User::class, 'opened_by'); }
    public function closer(): BelongsTo { return $this->belongsTo(User::class, 'closed_by'); }
    public function approver(): BelongsTo { return $this->belongsTo(User::class, 'approved_by'); }
    public function staffAssignments(): HasMany { return $this->hasMany(FuelShiftStaffAssignment::class); }
    public function meterReadings(): HasMany { return $this->hasMany(FuelShiftMeterReading::class); }
    public function tankReadings(): HasMany { return $this->hasMany(FuelShiftTankReading::class); }
    public function cashMovements(): HasMany { return $this->hasMany(FuelShiftCashMovement::class); }
    public function cashVariance(): HasOne { return $this->hasOne(FuelShiftCashVariance::class); }
    public function corrections(): HasMany { return $this->hasMany(FuelShiftCorrection::class); }
    public function events(): HasMany { return $this->hasMany(FuelShiftEvent::class); }

    public function isOpen(): bool { return $this->status === self::STATUS_OPEN; }
    public function isClosed(): bool { return $this->status === self::STATUS_CLOSED; }
    public function isApproved(): bool { return $this->status === self::STATUS_APPROVED; }
}
