<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * تجاوز صريح لإتاحة طريقة دفع في قناة Commerce محددة.
 * غياب السجل يحافظ على سلوك available_online التاريخي.
 */
class PaymentMethodChannelAvailability extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'payment_method_id',
        'sales_channel_id',
        'is_enabled',
    ];

    protected $casts = [
        'is_enabled' => 'boolean',
    ];

    public function paymentMethod(): BelongsTo
    {
        return $this->belongsTo(PaymentMethod::class);
    }

    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }
}
