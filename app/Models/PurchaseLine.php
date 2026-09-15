<?php

namespace App\Models;

use App\Models\Concerns\HasUnitConversion;
use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر فاتورة مشتريات. المبالغ بالـ minor units (هللات) كـ bigint.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر تابع لمشترى — يتبع فرع رأسه */
class PurchaseLine extends BaseModel implements CompanyWide
{
    use HasUnitConversion;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'purchase_id', 'product_id', 'product_variant_id', 'variant_descriptor_snapshot', 'description',
        'quantity', 'unit_name', 'unit_factor', 'unit_price', 'tax_rate',
        'line_subtotal', 'line_discount', 'line_tax', 'line_total',
    ];

    protected $casts = [
        'quantity'      => 'integer',
        'unit_factor'   => 'integer',
        'unit_price'    => 'integer',
        'tax_rate'      => 'integer',
        'line_subtotal' => 'integer',
        'line_discount' => 'integer',
        'line_tax'      => 'integer',
        'line_total'    => 'integer',
    ];

    public function purchase(): BelongsTo
    {
        return $this->belongsTo(Purchase::class);
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (وإلا تخطّى المسار المحاسبي السطرَ صامتاً). */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    /** VAR-DOC-1: المتغيّر الفعلي حين يكون المنتج متعدد الخيارات — فارغٌ لمنتجٍ بسيط. */
    public function variant(): BelongsTo
    {
        return $this->referenceBelongsTo(ProductVariant::class, 'product_variant_id');
    }
}
