<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر إشعار دائن. الإجماليات مشتقّة من الكمية × السعر + الضريبة (هللات).
 *
 * AWJ-TAX-REM-02: سطر الإشعار المربوط بفاتورة يحمل `source_line_id` (سطره فيها)،
 * و`line_subtotal` فيه قبل الخصم و`line_discount` خصمه وحصته من خصم الرأس —
 * الصيغة نفسها لسطر المرتجع: الصافي = line_subtotal − line_discount.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر تابع لإشعار — يتبع فرع رأسه */
class CreditNoteLine extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'credit_note_id', 'product_id', 'source_line_id', 'product_variant_id', 'variant_descriptor_snapshot', 'description',
        'quantity', 'unit_price', 'unit_price_before_tax', 'tax_rate',
        'line_subtotal', 'line_discount', 'line_tax', 'line_total',
    ];

    protected $casts = [
        'quantity'      => 'integer',
        'unit_price'    => 'integer',
        'unit_price_before_tax' => 'integer',
        'tax_rate'      => 'integer',
        'line_subtotal' => 'integer',
        'line_discount' => 'integer',
        'line_tax'      => 'integer',
        'line_total'    => 'integer',
    ];

    public function creditNote(): BelongsTo
    {
        return $this->belongsTo(CreditNote::class);
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً. */
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
