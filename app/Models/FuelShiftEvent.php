<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل أحداث append-only للشفت التشغيلي، منفصل عن القيود والأرصدة المحاسبية. */
class FuelShiftEvent extends BaseModel
{
    use BranchScoped;

    public const TYPE_OPENED = 'opened';
    public const TYPE_STAFF_ASSIGNED = 'staff_assigned';
    public const TYPE_METER_RECORDED = 'meter_recorded';
    public const TYPE_TANK_RECORDED = 'tank_recorded';
    public const TYPE_CASH_MOVEMENT_RECORDED = 'cash_movement_recorded';
    public const TYPE_CLOSED = 'closed';
    public const TYPE_CASH_VARIANCE_PENDING = 'cash_variance_pending_review';
    public const TYPE_CASH_VARIANCE_REVIEWED = 'cash_variance_reviewed';
    public const TYPE_APPROVED_LOCKED = 'approved_locked';
    public const TYPE_CORRECTION_REQUESTED = 'correction_requested';

    protected $fillable = ['tenant_id', 'branch_id', 'fuel_shift_id', 'type', 'payload', 'actor_id', 'occurred_at'];

    protected $casts = ['payload' => 'array', 'occurred_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('حدث الشفت سجل تدقيق لا يعدّل.'));
        static::deleting(fn () => throw new LogicException('حدث الشفت لا يحذف.'));
    }

    public function shift(): BelongsTo { return $this->belongsTo(FuelShift::class, 'fuel_shift_id'); }
    public function actor(): BelongsTo { return $this->belongsTo(User::class, 'actor_id'); }
}
