<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** ACC-6 — سجل تدقيق ثابت لأقفال الفترات المحاسبية. لا يُحدَّث ولا يُحذف بعد الإنشاء. */
class AccountingPeriodLockEvent extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'accounting_period_lock_id', 'action', 'actor_user_id',
        'start_date', 'end_date', 'reason',
    ];

    protected $casts = [
        'start_date' => 'date',
        'end_date'   => 'date',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Accounting period lock events are immutable.'));
        static::deleting(fn () => throw new LogicException('Accounting period lock events cannot be deleted.'));
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}
