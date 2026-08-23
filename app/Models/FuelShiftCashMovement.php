<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** حركة نقد تشغيلية داخل الشفت؛ لا تنشئ سنداً أو قيداً محاسبياً. */
class FuelShiftCashMovement extends BaseModel
{
    use BranchScoped;

    public const TYPE_CASH_IN = 'cash_in';
    public const TYPE_CASH_OUT = 'cash_out';
    public const TYPE_EXPENSE = 'expense';
    public const TYPES = [self::TYPE_CASH_IN, self::TYPE_CASH_OUT, self::TYPE_EXPENSE];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_shift_id', 'type', 'amount_minor', 'reason', 'evidence',
        'idempotency_key', 'recorded_by', 'recorded_at',
    ];

    protected $casts = [
        'amount_minor' => 'integer',
        'evidence' => 'array',
        'recorded_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('حركة نقد الشفت سجل تشغيلي لا تعدّل مباشرة.'));
        static::deleting(fn () => throw new LogicException('حركة نقد الشفت لا تحذف مباشرة.'));
    }

    public function shift(): BelongsTo { return $this->belongsTo(FuelShift::class, 'fuel_shift_id'); }
    public function recorder(): BelongsTo { return $this->belongsTo(User::class, 'recorded_by'); }
}
