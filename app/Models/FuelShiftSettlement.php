<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use LogicException;

/**
 * رأس تسوية وردية وقود: حقيقة ثابتة، واحد لكل وردية.
 * الكاتب الوحيد `FuelShiftSettlementService` (P1-3b) — لا `$fillable`. الثبات في القاعدة أيضاً (انظر هجرة 2027_01_18_020000).
 */
class FuelShiftSettlement extends BaseModel
{
    use BranchScoped;

    protected $guarded = ['*'];

    protected $casts = [
        'policy_snapshot' => 'array',
        'metered_milliliters' => 'integer', 'erp_milliliters' => 'integer', 'residual_milliliters' => 'integer',
        'settled_invoice_total_minor' => 'integer', 'pending_value_minor' => 'integer', 'reference_total_minor' => 'integer',
        'settled_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('رأس تسوية الوردية حقيقة ثابتة؛ الحسم اللاحق سجل إلحاقي جديد.'));
        static::deleting(fn () => throw new LogicException('سجلات تسوية الورديات لا تحذف.'));
    }
}
