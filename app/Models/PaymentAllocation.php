<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * تخصيص جزء من سند لمستند (فاتورة مبيعات أو فاتورة مشتريات).
 * مجموع تخصيصات السند = مبلغ السند. المبالغ بالـ minor units (هللات).
 */
class PaymentAllocation extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'payment_id', 'allocatable_type', 'allocatable_id', 'amount',
    ];

    protected $casts = [
        'amount' => 'integer',
    ];

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class);
    }

    public function allocatable(): MorphTo
    {
        return $this->morphTo();
    }
}
