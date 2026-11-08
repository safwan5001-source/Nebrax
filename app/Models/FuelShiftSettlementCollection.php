<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use LogicException;

/**
 * تخصيص تحصيل وردية على فاتورة مستهدفة: حقيقة ثابتة.
 * الكاتب الوحيد `FuelShiftSettlementService` (P1-3b) — لا `$fillable`. الثبات في القاعدة أيضاً (انظر هجرة 2027_01_18_020000).
 */
class FuelShiftSettlementCollection extends BaseModel
{
    use BranchScoped;

    protected $guarded = ['*'];

    protected $casts = ['amount_minor' => 'integer'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('تخصيص التحصيل حقيقة ثابتة.'));
        static::deleting(fn () => throw new LogicException('سجلات تسوية الورديات لا تحذف.'));
    }
}
