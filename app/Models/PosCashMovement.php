<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * حركة نقد داخل درج جهاز POS فقط. لا تمثل قبضاً أو صرفاً خارجياً ولا تملك قيداً
 * محاسبياً؛ تلك العمليات تمر حصراً عبر سندات الدفع أو التحويلات الداخلية.
 */
class PosCashMovement extends BaseModel
{
    use BranchScoped;

    public const TYPE_CASH_IN = 'cash_in';
    public const TYPE_CASH_OUT = 'cash_out';

    public const TYPES = [
        self::TYPE_CASH_IN,
        self::TYPE_CASH_OUT,
    ];

    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'branch_id', 'pos_session_id', 'type', 'amount', 'reason', 'recorded_by', 'created_at',
    ];

    protected static function booted(): void
    {
        static::updating(static fn () => throw new LogicException('حركة درج نقطة البيع لا تعدّل بعد تسجيلها.'));
        static::deleting(static fn () => throw new LogicException('حركة درج نقطة البيع لا تحذف.'));
    }

    protected function casts(): array
    {
        return [
            'amount' => 'integer',
            'created_at' => 'datetime',
        ];
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(PosSession::class, 'pos_session_id');
    }

    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }
}
