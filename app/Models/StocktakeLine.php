<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر جرد. `counted_quantity = null` يعني «لم يُعدّ بعد» — وهو غير الصفر
 * الذي يعني «عُدَّ فلم يوجد منه شيء». الخلط بينهما يحوّل بنداً منسيّاً إلى
 * عجزٍ كامل يُرحَّل.
 *
 * `system_revision` لقطة `ProductWarehouseStock.revision` لحظة الفتح —
 * المرجع الرسمي لكشف الحركة المتزامنة (PR-INV-4)، لا `system_quantity`
 * وحدها: حركة ذهاب-وعودة (ABA) لا تُغيّر الكمية النهائية لكنها تُغيّر
 * الـrevision، فيُكتشف التعارض رغم تطابق الكمية.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر تابع لمستند — يتبع فرع رأسه */
class StocktakeLine extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'stocktake_id', 'product_id',
        'system_quantity', 'system_revision', 'counted_quantity', 'unit_cost', 'difference_value',
    ];

    protected $casts = [
        'system_quantity'  => 'integer',
        'system_revision'  => 'integer',
        'counted_quantity' => 'integer',
        'unit_cost'        => 'integer',
        'difference_value' => 'integer',
    ];

    public function stocktake(): BelongsTo
    {
        return $this->belongsTo(Stocktake::class);
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع. */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    /** فرق الكمية: موجبٌ زيادة وسالبٌ عجز. `null` للسطر غير المعدود. */
    public function quantityDifference(): ?int
    {
        return $this->counted_quantity === null
            ? null
            : $this->counted_quantity - $this->system_quantity;
    }
}
