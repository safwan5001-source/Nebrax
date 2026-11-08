<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use LogicException;

/**
 * سجل إلحاقي لحسم ما حُجب أو تصحيحه — جديد دائماً ولا يُعدَّل.
 * الكاتب الوحيد `FuelShiftSettlementService` (P1-3b) — لا `$fillable`. الثبات في القاعدة أيضاً (انظر هجرة 2027_01_18_020000).
 */
class FuelShiftSettlementResolution extends BaseModel
{
    use BranchScoped;

    protected $guarded = ['*'];

    protected $casts = ['payload' => 'array', 'resolved_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('سجل الحسم إلحاقي لا يُعدَّل.'));
        static::deleting(fn () => throw new LogicException('سجلات تسوية الورديات لا تحذف.'));
    }
}
