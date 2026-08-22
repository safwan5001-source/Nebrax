<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * سجل تدقيق append-only لجلسة POS. يشرح الحدث ولا يعدّل أي رصيد أو قيد محاسبي.
 */
class PosSessionEvent extends BaseModel
{
    use BranchScoped;

    public const TYPE_CASH_IN_RECORDED = 'cash_in_recorded';
    public const TYPE_CASH_OUT_RECORDED = 'cash_out_recorded';
    public const TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT = 'closing_difference_requires_acknowledgement';
    public const TYPE_CLOSING_DIFFERENCE_ACKNOWLEDGED = 'closing_difference_acknowledged';

    public const TYPES = [
        self::TYPE_CASH_IN_RECORDED,
        self::TYPE_CASH_OUT_RECORDED,
        self::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT,
        self::TYPE_CLOSING_DIFFERENCE_ACKNOWLEDGED,
    ];

    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'branch_id', 'pos_session_id', 'type', 'actor_id', 'payload', 'created_at',
    ];

    protected static function booted(): void
    {
        static::updating(static fn () => throw new LogicException('سجل أحداث جلسة نقطة البيع لا يعدّل بعد إنشائه.'));
        static::deleting(static fn () => throw new LogicException('سجل أحداث جلسة نقطة البيع لا يحذف.'));
    }

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(PosSession::class, 'pos_session_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
