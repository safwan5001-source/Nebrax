<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** فرق نقد تشغيلي محفوظ للمراجعة؛ لا يسوّى ولا يرحّل تلقائياً في Cycle 4. */
class FuelShiftCashVariance extends BaseModel
{
    use BranchScoped;

    public const STATUS_NOT_REQUIRED = 'not_required';
    public const STATUS_PENDING_REVIEW = 'pending_review';
    public const STATUSES = [self::STATUS_NOT_REQUIRED, self::STATUS_PENDING_REVIEW];

    public const DIRECTION_NONE = 'none';
    public const DIRECTION_OVERAGE = 'overage';
    public const DIRECTION_SHORTAGE = 'shortage';
    public const DIRECTIONS = [self::DIRECTION_NONE, self::DIRECTION_OVERAGE, self::DIRECTION_SHORTAGE];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_shift_id', 'opening_float_minor',
        'documented_cash_in_minor', 'documented_cash_out_minor', 'documented_expenses_minor',
        'expected_operational_cash_minor', 'counted_cash_minor', 'variance_minor', 'variance_direction',
        'status', 'note', 'counted_by', 'reviewed_by', 'counted_at', 'reviewed_at',
    ];

    protected $casts = [
        'opening_float_minor' => 'integer',
        'documented_cash_in_minor' => 'integer',
        'documented_cash_out_minor' => 'integer',
        'documented_expenses_minor' => 'integer',
        'expected_operational_cash_minor' => 'integer',
        'counted_cash_minor' => 'integer',
        'variance_minor' => 'integer',
        'counted_at' => 'datetime',
        'reviewed_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $variance): void {
            $allowed = ['reviewed_by', 'reviewed_at', 'updated_at'];
            if (array_diff(array_keys($variance->getDirty()), $allowed) !== [] || $variance->getOriginal('reviewed_at') !== null) {
                throw new LogicException('فرق نقد الشفت محفوظ للمراجعة؛ لا يسمح إلا بتسجيل مراجع واحد من دون تعديل الفرق أو حالته.');
            }
        });
        static::deleting(fn () => throw new LogicException('فرق نقد الشفت لا يحذف مباشرة.'));
    }

    public function shift(): BelongsTo { return $this->belongsTo(FuelShift::class, 'fuel_shift_id'); }
    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function counter(): BelongsTo { return $this->belongsTo(User::class, 'counted_by'); }
    public function reviewer(): BelongsTo { return $this->belongsTo(User::class, 'reviewed_by'); }
}
