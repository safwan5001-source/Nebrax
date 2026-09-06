<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * رصيد كمية منتج في مخزن — تفصيل لـ products.quantity_on_hand (بلا قيمة).
 *
 * `revision` عدّاد رتيب (monotonic) يزيده `InventoryService::adjustWarehouseStock()`
 * بالضبط ١ عند كل حركةٍ فعلية تمسّ هذا الصفّ — لا الكمية وحدها. يكشف حركة
 * ذهاب-وعودة (ABA: ١٠٠→٩٠→١٠٠) لا تُغيّر الكمية النهائية لكنها حركةٌ حقيقية
 * (انظر `StocktakeService` وPR-INV-4).
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: رصيد كمّي تابع لمخزن — العزل عبر المخزن/الفرع */
class ProductWarehouseStock extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $table = 'product_warehouse_stock';

    protected $fillable = ['tenant_id', 'product_id', 'warehouse_id', 'quantity', 'revision'];

    protected $casts = ['quantity' => 'integer', 'revision' => 'integer'];

    protected $attributes = ['quantity' => 0, 'revision' => 0];

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (وإلا تخطّى المسار المحاسبي السطرَ صامتاً). */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }
}
