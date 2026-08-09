<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر إشعار دائن. الإجماليات مشتقّة من الكمية × السعر + الضريبة (هللات).
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر تابع لإشعار — يتبع فرع رأسه */
class CreditNoteLine extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'credit_note_id', 'product_id', 'description',
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

    public function creditNote(): BelongsTo
    {
        return $this->belongsTo(CreditNote::class);
    }
}
