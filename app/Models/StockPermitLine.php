<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر إذن مخزني. تكلفة الوحدة تُثبَّت عند الترحيل من متوسط التكلفة في
 * الصرف والتحويل — فلا يختار المستخدم تكلفةَ ما يُخرِجه من المخزن.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر تابع لمستند — يتبع فرع رأسه */
class StockPermitLine extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'stock_permit_id', 'product_id', 'quantity', 'unit_cost', 'line_cost',
    ];

    protected $casts = [
        'quantity'  => 'integer',
        'unit_cost' => 'integer',
        'line_cost' => 'integer',
    ];

    public function permit(): BelongsTo
    {
        return $this->belongsTo(StockPermit::class, 'stock_permit_id');
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع (وإلا تخطّى المسارُ المحاسبي السطرَ صامتاً). */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }
}
