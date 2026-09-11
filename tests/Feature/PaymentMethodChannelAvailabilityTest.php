<?php

namespace Tests\Feature;

use App\Models\PaymentMethod;
use App\Models\PaymentMethodChannelAvailability;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\Payments\PaymentMethodChannelAvailabilityService;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PaymentMethodChannelAvailabilityTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private PaymentMethodChannelAvailabilityService $service;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'شركة قنوات الدفع',
            'slug' => 'payment-channel-policy',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->service = app(PaymentMethodChannelAvailabilityService::class);
    }

    /** @test */
    public function legacy_available_online_is_the_backward_compatible_fallback_without_an_override(): void
    {
        $online = $this->method('دفع أونلاين', true);
        $offline = $this->method('نقدي', false);
        $channel = $this->channel('web', SalesChannel::TYPE_WEB);

        $this->assertTrue($this->service->isAvailable($online, $channel));
        $this->assertFalse($this->service->isAvailable($offline, $channel));
        $this->assertSame(0, PaymentMethodChannelAvailability::count());
    }

    /** @test */
    public function an_explicit_channel_override_wins_over_the_legacy_online_flag(): void
    {
        $legacyOnline = $this->method('بطاقة', true);
        $legacyOffline = $this->method('تحويل', false);
        $channel = $this->channel('awj-store', SalesChannel::TYPE_WEB);

        $this->service->setAvailability($legacyOnline, $channel, false);
        $this->service->setAvailability($legacyOffline, $channel, true);

        $this->assertFalse($this->service->isAvailable($legacyOnline, $channel));
        $this->assertTrue($this->service->isAvailable($legacyOffline, $channel));
    }

    /** @test */
    public function inactive_method_or_channel_is_never_available_even_when_explicitly_enabled(): void
    {
        $method = $this->method('بطاقة', true);
        $channel = $this->channel('awj-store', SalesChannel::TYPE_WEB);
        $this->service->setAvailability($method, $channel, true);

        $method->update(['is_active' => false]);
        $this->assertFalse($this->service->isAvailable($method->fresh(), $channel));

        $method->update(['is_active' => true]);
        $channel->update(['is_active' => false]);
        $this->assertFalse($this->service->isAvailable($method->fresh(), $channel->fresh()));
    }

    /** @test */
    public function pos_channels_are_deliberately_left_to_existing_pos_settings(): void
    {
        $method = $this->method('نقدي', true);
        $pos = $this->channel('pos', SalesChannel::TYPE_POS);

        $this->expectException(DomainException::class);
        $this->service->isAvailable($method, $pos);
    }

    /** @test */
    public function cross_tenant_objects_cannot_be_used_to_read_or_write_channel_policy(): void
    {
        $methodA = $this->method('بطاقة أ', true);
        $channelA = $this->channel('web-a', SalesChannel::TYPE_WEB);
        $this->service->setAvailability($methodA, $channelA, true);

        $tenantB = Tenant::create(['name' => 'شركة باء', 'slug' => 'payment-channel-policy-b']);
        app(TenantContext::class)->set($tenantB->id);

        $this->assertSame(0, PaymentMethodChannelAvailability::count());

        $this->expectException(DomainException::class);
        $this->service->isAvailable($methodA, $channelA);
    }

    /** @test */
    public function setting_policy_without_tenant_context_is_rejected(): void
    {
        $method = $this->method('بطاقة', true);
        $channel = $this->channel('web', SalesChannel::TYPE_WEB);
        app(TenantContext::class)->forget();

        $this->expectException(DomainException::class);
        $this->service->setAvailability($method, $channel, true);
    }

    private function method(string $name, bool $availableOnline): PaymentMethod
    {
        return PaymentMethod::create([
            'name' => $name,
            'settlement_type' => 'cash',
            'available_online' => $availableOnline,
            'is_active' => true,
        ]);
    }

    private function channel(string $slug, string $type): SalesChannel
    {
        return SalesChannel::create([
            'slug' => $slug,
            'name' => $slug,
            'type' => $type,
            'is_active' => true,
        ]);
    }
}
