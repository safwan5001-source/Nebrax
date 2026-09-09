<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر التزام تجاري — لقطة تاريخية لما اتُّفق عليه، لا مرجعاً حياً يُعاد
 * تفسيره. `product_name_snapshot`/`unit_name`/`unit_factor`/`unit_price`
 * تُنسَخ لحظة الإنشاء ولا تتغيّر بتغيّر `Product`/`PriceList` لاحقاً
 * (Master Plan §5 — Snapshot Principle).
 *
 * **`CompanyWide`**: يتبع تصنيف رأسه (`CommerceOrder`) — لا فرعاً بعينه.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر تابع لطلب Commerce — يتبع تصنيف رأسه CompanyWide */
class CommerceOrderLine extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'commerce_order_id', 'product_id', 'product_name_snapshot',
        'quantity', 'unit_name', 'unit_factor', 'unit_price', 'line_total',
    ];

    protected $casts = [
        'quantity' => 'integer',
        'unit_factor' => 'integer',
        'unit_price' => 'integer',
        'line_total' => 'integer',
    ];

    protected $attributes = [
        'unit_factor' => 1,
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(CommerceOrder::class, 'commerce_order_id');
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (وإلا تخطّى المسار المحاسبي/التقريري السطرَ صامتاً). */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    /** الكمية بوحدة المخزون — نفس اصطلاح InvoiceLine/PurchaseLine (لا تحويل نقدي). */
    public function baseQuantity(): int
    {
        return $this->quantity * max(1, $this->unit_factor);
    }
}
