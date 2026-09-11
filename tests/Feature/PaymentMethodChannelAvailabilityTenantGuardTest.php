<?php

namespace Tests\Feature;

use App\Models\PaymentMethod;
use App\Models\PaymentMethodChannelAvailability;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PaymentMethodChannelAvailabilityTenantGuardTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function direct_model_write_cannot_reference_another_tenants_payment_method_or_channel(): void
    {
        $tenantA = Tenant::create(['name' => 'شركة ألف', 'slug' => 'pm-policy-guard-a']);
        $tenantB = Tenant::create(['name' => 'شركة باء', 'slug' => 'pm-policy-guard-b']);
        $context = app(TenantContext::class);

        $context->set($tenantA->id);
        $methodA = PaymentMethod::create([
            'name' => 'طريقة ألف',
            'settlement_type' => 'cash',
            'available_online' => true,
        ]);
        $channelA = SalesChannel::create([
            'slug' => 'web-a',
            'name' => 'متجر ألف',
            'type' => SalesChannel::TYPE_WEB,
        ]);

        $context->set($tenantB->id);

        $this->expectException(DomainException::class);
        PaymentMethodChannelAvailability::create([
            'payment_method_id' => $methodA->id,
            'sales_channel_id' => $channelA->id,
            'is_enabled' => true,
        ]);
    }
}
