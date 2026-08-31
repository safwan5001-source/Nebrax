<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** Immutable close-time snapshot for the cash drawer or one non-cash tender. */
class PosSessionReconciliation extends BaseModel
{
    use BelongsToBranch;

    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'branch_id', 'pos_session_id', 'reconciliation_key',
        'payment_method_id', 'payment_method_name', 'settlement_type',
        'expected_amount', 'counted_amount', 'difference', 'count_source', 'created_at',
    ];

    protected $casts = [
        'expected_amount' => 'integer',
        'counted_amount' => 'integer',
        'difference' => 'integer',
        'created_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(static fn () => throw new LogicException('لقطة مطابقة إغلاق جلسة POS لا تعدل.'));
        static::deleting(static fn () => throw new LogicException('لقطة مطابقة إغلاق جلسة POS لا تحذف.'));
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(PosSession::class, 'pos_session_id');
    }

    public function paymentMethod(): BelongsTo
    {
        return $this->belongsTo(PaymentMethod::class);
    }
}
