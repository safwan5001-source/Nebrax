<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use LogicException;

/**
 * تاريخ مفتوح لمجمّع التكلفة (مخزن × منتج) — يُفتح عند كل حجب ويُغلق بالحسم.
 * الكاتب الوحيد `FuelShiftSettlementService` (P1-3b) — لا `$fillable`. الثبات في القاعدة أيضاً (انظر هجرة 2027_01_18_020000).
 */
class FuelCostPoolOpenHistory extends BaseModel
{
    use BranchScoped;

    protected $guarded = ['*'];

    protected $casts = ['opened_at' => 'datetime', 'resolved_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(function (self $row): void {
            // الانتقال الأحادي المسموح فقط (والقاعدة تفرضه ثانيةً): NULL ← قيمة مرة واحدة.
            $changed = array_diff(array_keys($row->getDirty()), ['updated_at']);
            if (array_diff($changed, ['resolution_id', 'resolved_at']) !== []) {
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
