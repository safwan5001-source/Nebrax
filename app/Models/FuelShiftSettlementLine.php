<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use LogicException;

/**
 * سطر تسوية لكل فوهة. أعمدة الحسم (resolution_id, fuel_sale_id) تقبل انتقالاً أحادياً بالقاعدة فقط.
 * الكاتب الوحيد `FuelShiftSettlementService` (P1-3b) — لا `$fillable`. الثبات في القاعدة أيضاً (انظر هجرة 2027_01_18_020000).
 */
class FuelShiftSettlementLine extends BaseModel
{
    use BranchScoped;

    protected $guarded = ['*'];

    protected $casts = [
        'metered_milliliters' => 'integer', 'erp_milliliters' => 'integer', 'residual_milliliters' => 'integer',
        'price_per_liter_minor' => 'integer', 'expected_gross_minor' => 'integer', 'pending_value_minor' => 'integer',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $row): void {
            // الانتقال الأحادي المسموح فقط (والقاعدة تفرضه ثانيةً): NULL ← قيمة مرة واحدة.
            $changed = array_diff(array_keys($row->getDirty()), ['updated_at']);
            if (array_diff($changed, ['resolution_id', 'fuel_sale_id']) !== []) {
                throw new LogicException('سجل تسوية الوردية ثابت؛ لا يسمح إلا بانتقال أعمدة الحسم أحادي الاتجاه.');
            }
            foreach ($changed as $column) {
                if ($row->getOriginal($column) !== null) {
                    throw new LogicException("عمود الحسم {$column} مضبوط سلفاً ولا يتغيّر.");
                }
            }
        });
        static::deleting(fn () => throw new LogicException('سجلات تسوية الورديات لا تحذف.'));
    }
}
