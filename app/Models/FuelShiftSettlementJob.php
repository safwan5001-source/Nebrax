<?php

namespace App\Models;

use App\Tenancy\BranchScoped;

/**
 * مهمة تسوية وردية مسجَّلة (P1-3b-1، D-S2): سجل دائم قابل للاسترجاع وإعادة المحاولة، مهمة واحدة لكل وردية (قيد فريد).
 *
 * **الكاتب الوحيد `FuelShiftSettlementJobService`** (لا `$fillable`؛ يحرسه اختبار ساكن). لا يحمل هذا السجل أثراً محاسبياً ولا يُنشئ مستنداً.
 * الحراس الصلبة في القاعدة (انظر هجرة 2027_01_19_010000): هوية ثابتة، `completed` نهائية، لا حذف.
 */
class FuelShiftSettlementJob extends BaseModel
{
    use BranchScoped;

    public const STATUS_QUEUED = 'queued';
    public const STATUS_RUNNING = 'running';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';

    public const OUTCOME_BLOCKED = 'blocked';
    public const OUTCOME_AWAITING_ENGINE = 'awaiting_engine';
    public const OUTCOME_DISABLED = 'disabled';
    /** محجوز لمحرك P1-3b-2؛ لا يصل إليه أي مسار في P1-3b-1. */
    public const OUTCOME_POSTED = 'posted';

    protected $guarded = ['*'];

    protected $casts = [
        'blocked_reasons' => 'array',
        'attempts' => 'integer',
        'max_attempts' => 'integer',
        'checks' => 'integer',
        'next_attempt_at' => 'datetime',
        'locked_until' => 'datetime',
        'last_error_at' => 'datetime',
        'last_checked_at' => 'datetime',
        'completed_at' => 'datetime',
    ];

    protected $hidden = ['locked_by'];

    public function shift()
    {
        return $this->belongsTo(FuelShift::class, 'fuel_shift_id');
    }
}
