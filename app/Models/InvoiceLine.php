<?php

namespace App\Models;

use App\Models\Concerns\HasUnitConversion;
use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * سطر فاتورة. المبالغ بالـ minor units (هللات) كـ bigint.
 * line_subtotal = quantity × unit_price، و line_tax محسوبة بنسبة tax_rate.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر تابع لفاتورة — يتبع فرع رأسه */
class InvoiceLine extends BaseModel implements CompanyWide
{
    use HasUnitConversion;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'invoice_id', 'product_id', 'product_name_snapshot',
        'product_sku_snapshot', 'product_barcode_snapshot', 'description',
        'quantity', 'unit_name', 'unit_factor', 'unit_price', 'unit_price_before_tax', 'tax_rate',
        'quantity_numerator', 'quantity_denominator', 'pricing_numerator', 'pricing_denominator',
        'rounded_gross_minor', 'rounding_remainder_numerator', 'rounding_remainder_denominator', 'rounding_policy',
        'min_sale_price_snapshot', 'min_sale_price_override_reason', 'min_sale_price_overridden_by',
        'line_subtotal', 'line_discount', 'line_tax', 'line_total',
    ];

    protected $casts = [
        'quantity'      => 'integer',
        'unit_factor'   => 'integer',
        'quantity_numerator' => 'integer',
        'quantity_denominator' => 'integer',
        'rounded_gross_minor' => 'integer',
        'unit_price'            => 'integer',
        'unit_price_before_tax' => 'integer',
        'min_sale_price_snapshot' => 'integer',
        'tax_rate'              => 'integer',
        'line_subtotal' => 'integer',
        'line_discount' => 'integer',
        'line_tax'      => 'integer',
        'line_total'    => 'integer',
    ];

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (وإلا تخطّى المسار المحاسبي السطرَ صامتاً). */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    /** تخصيصات صافي السطر بين مراكز التكلفة؛ تحذف مع المسودة عند إعادة بناء السطور. */
    public function costCenterAllocations(): HasMany
    {
        return $this->hasMany(InvoiceLineCostCenterAllocation::class);
    }
}
