<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * فاتورة دورية (قالب + جدولة) — غير محاسبية. توليد فاتورة منها ينتج فاتورة
 * draft عبر InvoiceService. كل المبالغ بالهللات كـ bigint.
 */
class RecurringInvoice extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'title', 'partner_id', 'payment_type', 'frequency',
        'start_date', 'next_run_date', 'end_date', 'active', 'generated_count',
        'subtotal', 'tax_amount', 'total', 'notes', 'created_by',
    ];

    protected $casts = [
        'start_date'      => 'date',
        'next_run_date'   => 'date',
        'end_date'        => 'date',
        'active'          => 'boolean',
        'generated_count' => 'integer',
        'subtotal'        => 'integer',
        'tax_amount'      => 'integer',
        'total'           => 'integer',
    ];

    protected $attributes = [
        'payment_type'    => 'credit',
        'frequency'       => 'monthly',
        'active'          => true,
        'generated_count' => 0,
        'subtotal'        => 0,
        'tax_amount'      => 0,
        'total'           => 0,
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(RecurringInvoiceLine::class);
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }
}
