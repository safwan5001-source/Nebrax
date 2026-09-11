<?php

namespace Tests\Feature;

use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PaymentGatewayTenantGuardTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function direct_model_write_cannot_reference_another_tenants_payment_method(): void
    {
        $tenantA = Tenant::create(['name' => 'شركة ألف', 'slug' => 'pg-guard-a']);
        $tenantB = Tenant::create(['name' => 'شركة باء', 'slug' => 'pg-guard-b']);
        $context = app(TenantContext::class);

        $context->set($tenantA->id);
        $methodA = PaymentMethod::create([
            'name' => 'طريقة ألف',
            'settlement_type' => 'cash',
            'available_online' => true,
        ]);

        $context->set($tenantB->id);

        $this->expectException(DomainException::class);
        PaymentGateway::create([
            'provider' => PaymentGateway::PROVIDER_STRIPE,
            'name' => 'بوابة مزوّرة',
            'payment_method_id' => $methodA->id,
        ]);
    }

    /** @test */
    public function direct_model_write_cannot_forge_another_tenants_id(): void
    {
        $tenantA = Tenant::create(['name' => 'شركة ألف', 'slug' => 'pg-forge-a']);
        $tenantB = Tenant::create(['name' => 'شركة باء', 'slug' => 'pg-forge-b']);
        $context = app(TenantContext::class);
        $context->set($tenantA->id);

        $this->expectException(DomainException::class);
        PaymentGateway::create([
            'tenant_id' => $tenantB->id,
            'provider' => PaymentGateway::PROVIDER_TAP,
            'name' => 'تزوير المستأجر',
        ]);
    }

    /** @test */
    public function direct_model_write_without_tenant_context_is_rejected(): void
    {
        $tenant = Tenant::create(['name' => 'شركة', 'slug' => 'pg-missing-ctx']);
        $context = app(TenantContext::class);
        $context->set($tenant->id);
        $context->forget();

        $this->expectException(DomainException::class);
        PaymentGateway::create([
            'provider' => PaymentGateway::PROVIDER_CUSTOM,
            'name' => 'بدون سياق',
        ]);
    }
}
