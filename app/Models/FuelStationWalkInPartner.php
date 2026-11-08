<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use LogicException;

/**
 * ربط محطة وقود بعميلها النقدي المخصّص (طرف موسوم system_kind=fuel_walk_in).
 * الكاتب الوحيد `FuelShiftSettlementService` (P1-3b) — لا `$fillable`. الثبات في القاعدة أيضاً (انظر هجرة 2027_01_18_020000).
 */
class FuelStationWalkInPartner extends BaseModel
{
    use BranchScoped;

    protected $guarded = ['*'];


    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('ربط العميل النقدي بالمحطة ثابت.'));
        static::deleting(fn () => throw new LogicException('سجلات تسوية الورديات لا تحذف.'));
    }
}
