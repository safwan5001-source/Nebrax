<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر رصيد افتتاحي.
 *
 * المخزن على السطر لا على الرأس: هو الذي يحمل بُعد الفرع، وبه يستطيع المستند
 * الواحد أن يغطّي فروعاً متعددة بصدق. و`total_cost` مخزَّنة لا مشتقّة (نمط
 * `StockPermitLine::line_cost`) لأنها بعينها ما يُمرَّر إلى `applyReceipt` وما
 * يُجمع للقيد — فبقاؤها مكتوبةً هو ما يثبت تطابق 1140 مع مجموع الحركات.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر تابع لمستند مشترك */
class InventoryOpeningLine extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'inventory_opening_id', 'product_id', 'warehouse_id',
        'quantity', 'unit_cost', 'total_cost', 'notes', 'position',
    ];

    protected $casts = [
        'quantity'   => 'integer',
        'unit_cost'  => 'integer',
        'total_cost' => 'integer',
        'position'   => 'integer',
    ];

    public function opening(): BelongsTo
    {
        return $this->belongsTo(InventoryOpening::class, 'inventory_opening_id');
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع (وإلا تخطّى المسارُ المحاسبي السطرَ صامتاً). */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function warehouse(): BelongsTo
    {
        return $this->referenceBelongsTo(Warehouse::class);
    }
}
