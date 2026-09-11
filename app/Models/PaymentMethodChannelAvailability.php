<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use DomainException;
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

    protected static function booted(): void
    {
        static::saving(function (self $policy): void {
            // Both lookups retain TenantScope. A foreign-tenant UUID therefore
            // cannot be persisted even when a caller somehow knows that UUID.
            if (! PaymentMethod::query()->whereKey($policy->payment_method_id)->exists()) {
                throw new DomainException('Payment method must belong to the active tenant.');
            }

            if (! SalesChannel::query()->whereKey($policy->sales_channel_id)->exists()) {
                throw new DomainException('Sales channel must belong to the active tenant.');
            }
        });
    }

    public function paymentMethod(): BelongsTo
    {
        return $this->belongsTo(PaymentMethod::class);
    }

    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }
}
