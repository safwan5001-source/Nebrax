<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * تخصيص جزء من سند قبض لفاتورة معيّنة.
 * مجموع تخصيصات السند = مبلغ السند. المبالغ بالـ minor units (هللات).
 */
class PaymentAllocation extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'payment_id', 'invoice_id', 'amount',
    ];

    protected $casts = [
        'amount' => 'integer',
    ];

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class);
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }
}
