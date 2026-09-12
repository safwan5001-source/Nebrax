<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PaymentGatewaySettlementItem extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'settlement_id',
        'payment_id',
        'provider_event_ref',
        'gross_amount',
    ];

    protected $casts = [
        'gross_amount' => 'integer',
    ];

    protected static function booted(): void
    {
        static::saving(function (self $item): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for gateway settlement items.');
            }

            $tenantId = (string) $context->id();
            if ($item->tenant_id !== null && (string) $item->tenant_id !== $tenantId) {
                throw new DomainException('Gateway settlement item tenant cannot be forged.');
            }

            $item->tenant_id = $tenantId;

            if ($item->exists) {
                throw new DomainException('Posted gateway settlement items are immutable.');
            }

            if ($item->payment_id && ! Payment::query()->whereKey($item->payment_id)->exists()) {
                throw new DomainException('Settlement payment must belong to the active tenant.');
            }
        });
    }

    public function settlement(): BelongsTo
    {
        return $this->belongsTo(PaymentGatewaySettlement::class, 'settlement_id');
    }

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class);
    }
}
