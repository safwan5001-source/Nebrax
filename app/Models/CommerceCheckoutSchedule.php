<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * FLOWERS-H7b / ADR-19 — اختيار موعد التسليم المؤقت لـCheckout مفتوح (1:1). لا أثر مالي ولا مخزني؛ السلطة
 * الوحيدة للصلاحية هي `CommerceDeliveryScheduleService` (يُعاد التحقق عند الإتمام).
 */
class CommerceCheckoutSchedule extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'commerce_checkout_id', 'delivery_date', 'commerce_delivery_slot_id'];

    protected static function booted(): void
    {
        static::saving(function (self $schedule) {
            $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', (string) $schedule->delivery_date);
            if ($parsed === false || $parsed->format('Y-m-d') !== $schedule->delivery_date) {
                throw new RuntimeException('تاريخ التسليم غير صالح.');
            }

            $tenantId = $schedule->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $checkout = CommerceCheckout::withoutGlobalScope(TenantScope::class)->select(['id', 'tenant_id'])->find($schedule->commerce_checkout_id);
            if ($checkout === null || $checkout->tenant_id !== $tenantId) {
                throw new RuntimeException('جلسة الدفع غير موجودة لهذا المستأجر.');
            }
            if ($schedule->commerce_delivery_slot_id !== null) {
                $slot = CommerceDeliverySlot::withoutGlobalScope(TenantScope::class)->select(['id', 'tenant_id'])->find($schedule->commerce_delivery_slot_id);
                if ($slot === null || $slot->tenant_id !== $tenantId) {
                    throw new RuntimeException('نافذة التسليم غير موجودة لهذا المستأجر.');
                }
            }
        });
    }

    public function checkout(): BelongsTo
    {
        return $this->belongsTo(CommerceCheckout::class, 'commerce_checkout_id');
    }

    public function slot(): BelongsTo
    {
        return $this->belongsTo(CommerceDeliverySlot::class, 'commerce_delivery_slot_id');
    }
}
