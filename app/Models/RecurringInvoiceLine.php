<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر قالب فاتورة دورية. الإجماليات مشتقّة من الكمية × السعر + الضريبة (هللات).
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سطر تابع لقالب دوري — يتبع فرع رأسه */
class RecurringInvoiceLine extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'recurring_invoice_id', 'product_id', 'description',
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

    public function recurringInvoice(): BelongsTo
    {
        return $this->belongsTo(RecurringInvoice::class);
    }
}
