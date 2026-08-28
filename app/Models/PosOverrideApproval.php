<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * إسقاط حالة محدود لطلب الاعتماد. يبقى الدليل القانوني/التشغيلي في
 * PosSessionEvent append-only؛ لذلك لا يحذف الطلب ولا يعاد استخدامه بعد استهلاكه.
 */
class PosOverrideApproval extends BaseModel
{
    use BranchScoped;

    public const POLICY_ALLOWED = 'allowed';
    public const POLICY_APPROVAL_REQUIRED = 'approval_required';
    public const POLICY_DENIED = 'denied';

    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_CONSUMED = 'consumed';
    public const STATUS_EXPIRED = 'expired';

    protected $fillable = [
        'branch_id', 'pos_session_id', 'cart_id', 'correlation_id', 'operation',
        'policy', 'status', 'reason_code', 'reason_note', 'performed_by',
        'approved_by', 'context', 'approved_at', 'consumed_at', 'expires_at',
    ];

    protected static function booted(): void
    {
        static::deleting(static fn () => throw new LogicException('طلب اعتماد نقطة البيع لا يحذف؛ يوثّق انتقاله فقط.'));
    }

    protected function casts(): array
    {
        return [
            'context' => 'array',
            'approved_at' => 'datetime',
            'consumed_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(PosSession::class, 'pos_session_id');
    }

    public function performedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'performed_by');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }
}
