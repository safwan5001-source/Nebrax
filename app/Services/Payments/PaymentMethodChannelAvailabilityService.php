<?php

namespace App\Services\Payments;

use App\Models\PaymentMethod;
use App\Models\PaymentMethodChannelAvailability;
use App\Models\SalesChannel;
use App\Tenancy\TenantContext;
use DomainException;

/**
 * أصغر طبقة سياسة مشتركة لقنوات Commerce.
 *
 * POS يبقى تحت PosSettings ولا يمر من هنا، حتى لا تتغير دلالات
 * all_active / only / none القائمة أو مسار التحقق الخادمي الحالي.
 */
final class PaymentMethodChannelAvailabilityService
{
    public function __construct(private readonly TenantContext $tenantContext)
    {
    }

    public function isAvailable(PaymentMethod $method, SalesChannel $channel): bool
    {
        $tenantId = $this->requireTenant();
        $this->assertSameTenant($tenantId, $method, $channel);

        if ($channel->type === SalesChannel::TYPE_POS) {
            throw new DomainException('POS payment-method availability is governed by PosSettings.');
        }

        if (! $method->is_active || ! $channel->is_active) {
            return false;
        }

        $policy = PaymentMethodChannelAvailability::query()
            ->where('payment_method_id', $method->getKey())
            ->where('sales_channel_id', $channel->getKey())
            ->first();

        if ($policy !== null) {
            return (bool) $policy->is_enabled;
        }

        // Backward-compatible fallback: before PAY-V2-2, available_online was
        // the only online/channel signal. Existing tenants therefore keep the
        // same result until they configure an explicit channel override.
        return (bool) $method->available_online;
    }

    public function setAvailability(PaymentMethod $method, SalesChannel $channel, bool $enabled): PaymentMethodChannelAvailability
    {
        $tenantId = $this->requireTenant();
        $this->assertSameTenant($tenantId, $method, $channel);

        if ($channel->type === SalesChannel::TYPE_POS) {
            throw new DomainException('POS payment-method availability must be configured through PosSettings.');
        }

        return PaymentMethodChannelAvailability::query()->updateOrCreate(
            [
                'payment_method_id' => $method->getKey(),
                'sales_channel_id' => $channel->getKey(),
            ],
            [
                'tenant_id' => $tenantId,
                'is_enabled' => $enabled,
            ],
        );
    }

    private function requireTenant(): string
    {
        $tenantId = $this->tenantContext->id();

        if ($tenantId === null) {
            throw new DomainException('Tenant context is required for payment-method channel policy.');
        }

        return $tenantId;
    }

    private function assertSameTenant(string $tenantId, PaymentMethod $method, SalesChannel $channel): void
    {
        if ((string) $method->tenant_id !== $tenantId || (string) $channel->tenant_id !== $tenantId) {
            throw new DomainException('Payment method and sales channel must belong to the active tenant.');
        }
    }
}
