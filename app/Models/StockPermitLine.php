<?php

namespace App\Models;

use App\Models\Concerns\HasUnitConversion;
use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر إذن مخزني. تكلفة الوحدة تُثبَّت عند الترحيل من متوسط التكلفة في
 * الصرف والتحويل — فلا يختار المستخدم تكلفةَ ما يُخرِجه من المخزن.
 *
 * `quantity`/`unit_name`/`unit_factor` بالوحدة **المُدخَلة** (تجارية أو
 * أساس) — لقطةٌ لا مرجع، فتعديل قالب الوحدات لاحقاً لا يعيد تفسير إذنٍ
 * مرحَّل (نفس عقد `InvoiceLine`/`PurchaseLine`). `base_quantity` هي
 * الكمية **الرسمية** بوحدة المخزون المحسوبة مرّة واحدة عند الإنشاء
 * والمحفوظة صراحةً — كل استدعاء لاحق لـ`InventoryService` يقرأها كما هي،
 * فلا إعادة اشتقاق مع كل عملية.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر تابع لمستند — يتبع فرع رأسه */
class StockPermitLine extends BaseModel implements CompanyWide
{
    use HasUnitConversion;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'stock_permit_id', 'product_id', 'quantity',
        'unit_name', 'unit_factor', 'base_quantity', 'unit_cost', 'line_cost',
    ];

    protected $casts = [
        'quantity'      => 'integer',
        'unit_factor'   => 'integer',
        'base_quantity' => 'integer',
        'unit_cost'     => 'integer',
        'line_cost'     => 'integer',
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
