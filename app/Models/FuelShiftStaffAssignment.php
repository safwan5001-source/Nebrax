<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** إسناد تاريخي للعامل داخل وردية وقود؛ لا يعدّل أو يحذف بعد تسجيله. */
class FuelShiftStaffAssignment extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_shift_id', 'user_id', 'role', 'assigned_by', 'assigned_at',
    ];

    protected $casts = ['assigned_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('إسناد عامل الشفت سجل تاريخي لا يعدّل مباشرة.'));
        static::deleting(fn () => throw new LogicException('إسناد عامل الشفت لا يحذف مباشرة.'));
    }

    public function shift(): BelongsTo { return $this->belongsTo(FuelShift::class, 'fuel_shift_id'); }
    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function assigner(): BelongsTo { return $this->belongsTo(User::class, 'assigned_by'); }
}
