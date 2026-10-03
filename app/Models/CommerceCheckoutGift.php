<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/** FLOWERS-H3 / ADR-15 — سياق الإهداء المؤقت لـCheckout مفتوح (1:1). لا أثر مالي. */
class CommerceCheckoutGift extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'commerce_checkout_id', 'recipient_name', 'recipient_phone', 'sender_display_name', 'hide_sender', 'message'];

    protected $casts = ['hide_sender' => 'boolean'];

    protected $attributes = ['hide_sender' => false];

    protected static function booted(): void
    {
        static::saving(function (self $gift) {
            $tenantId = $gift->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $checkout = CommerceCheckout::withoutGlobalScope(TenantScope::class)->select(['id', 'tenant_id'])->find($gift->commerce_checkout_id);
            if ($checkout === null || $checkout->tenant_id !== $tenantId) {
                throw new RuntimeException('جلسة الدفع غير موجودة لهذا المستأجر.');
            }
        });
    }

    public function checkout(): BelongsTo
    {
        return $this->belongsTo(CommerceCheckout::class, 'commerce_checkout_id');
    }
}
