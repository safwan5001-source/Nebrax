<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر عرض سعر. الإجماليات مشتقّة من الكمية × السعر + الضريبة (هللات).
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر تابع لعرض سعر — يتبع فرع رأسه */
class QuoteLine extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'quote_id', 'product_id', 'description',
        'quantity', 'unit_price', 'tax_rate',
        'line_subtotal', 'line_tax', 'line_total',
    ];

    protected $casts = [
        'quantity'      => 'integer',
        'unit_price'    => 'integer',
        'tax_rate'      => 'integer',
        'line_subtotal' => 'integer',
        'line_tax'      => 'integer',
        'line_total'    => 'integer',
    ];

    public function quote(): BelongsTo
    {
        return $this->belongsTo(Quote::class);
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (وإلا تخطّى المسار المحاسبي السطرَ صامتاً). */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }
}
