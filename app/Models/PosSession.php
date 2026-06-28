<?php

namespace App\Models;

/**
 * جلسة نقطة بيع (وردية) — سجلّ تشغيلي لمطابقة النقدية. غير محاسبي.
 * المبالغ بالهللات كـ bigint.
 */
class PosSession extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'number', 'status', 'opening_balance', 'closing_balance',
        'expected_balance', 'difference', 'opened_at', 'closed_at', 'notes', 'opened_by',
    ];

    protected $casts = [
        'opening_balance'  => 'integer',
        'closing_balance'  => 'integer',
        'expected_balance' => 'integer',
        'difference'       => 'integer',
        'opened_at'        => 'datetime',
        'closed_at'        => 'datetime',
    ];

    protected $attributes = [
        'status'          => 'open',
        'opening_balance' => 0,
    ];

    public function isOpen(): bool
    {
        return $this->status === 'open';
    }
}
