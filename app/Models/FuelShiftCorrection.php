<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** طلب correction مسار مستقبلي؛ Cycle 4 يسجل الطلب ولا يطبق تعديل مصدر مقفل تلقائياً. */
class FuelShiftCorrection extends BaseModel
{
    use BranchScoped;

    public const STATUS_REQUESTED = 'requested';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUSES = [self::STATUS_REQUESTED, self::STATUS_APPROVED, self::STATUS_REJECTED];

    public const TARGET_METER_READING = 'meter_reading';
    public const TARGET_TANK_READING = 'tank_reading';
    public const TARGET_CASH_COUNT = 'cash_count';
    public const TARGETS = [self::TARGET_METER_READING, self::TARGET_TANK_READING, self::TARGET_CASH_COUNT];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_shift_id', 'target_type', 'target_id', 'before', 'proposed',
        'status', 'reason', 'requested_by', 'reviewed_by', 'requested_at', 'reviewed_at',
    ];

    protected $casts = [
        'before' => 'array',
        'proposed' => 'array',
        'requested_at' => 'datetime',
        'reviewed_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $correction): void {
            if ($correction->getOriginal('status') !== self::STATUS_REQUESTED
                || ! in_array($correction->status, [self::STATUS_APPROVED, self::STATUS_REJECTED], true)
                || array_diff(array_keys($correction->getDirty()), ['status', 'reviewed_by', 'reviewed_at', 'updated_at']) !== []) {
                throw new LogicException('طلب correction لا يعدّل إلا بقرار مراجعة lifecycle موثق.');
            }
        });
        static::deleting(fn () => throw new LogicException('طلب تصحيح الشفت لا يحذف.'));
    }

    public function shift(): BelongsTo { return $this->belongsTo(FuelShift::class, 'fuel_shift_id'); }
    public function requester(): BelongsTo { return $this->belongsTo(User::class, 'requested_by'); }
    public function reviewer(): BelongsTo { return $this->belongsTo(User::class, 'reviewed_by'); }
}
