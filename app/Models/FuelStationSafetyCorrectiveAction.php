<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** إجراء تصحيحي ناشئ من فشل سلامة؛ لا يغلق تلقائياً لمجرد إقرار التنبيه. */
class FuelStationSafetyCorrectiveAction extends BaseModel
{
    use BranchScoped;

    public const STATUS_OPEN = 'open';
    public const STATUS_IN_PROGRESS = 'in_progress';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_VERIFIED = 'verified';
    public const STATUS_CLOSED = 'closed';
    public const STATUSES = [self::STATUS_OPEN, self::STATUS_IN_PROGRESS, self::STATUS_COMPLETED, self::STATUS_VERIFIED, self::STATUS_CLOSED];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_safety_finding_id', 'status', 'title', 'description',
        'assigned_to', 'due_date', 'completed_at', 'verified_at', 'verified_by', 'resolution',
    ];

    protected $casts = [
        'due_date' => 'date', 'completed_at' => 'datetime', 'verified_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $action): void {
            if ($action->getOriginal('status') === self::STATUS_CLOSED) {
                throw new LogicException('لا يعدّل الإجراء التصحيحي المغلق مباشرة.');
            }
        });
        static::deleting(fn () => throw new LogicException('لا يحذف الإجراء التصحيحي حفاظاً على تاريخ الامتثال.'));
    }

    public function finding(): BelongsTo { return $this->belongsTo(FuelStationSafetyFinding::class, 'fuel_station_safety_finding_id'); }
    public function assignee(): BelongsTo { return $this->belongsTo(User::class, 'assigned_to'); }
    public function verifier(): BelongsTo { return $this->belongsTo(User::class, 'verified_by'); }
}
