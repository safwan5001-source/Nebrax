<?php

namespace Tests\Feature;

use App\Http\Resources\PaymentGatewayResource;
use App\Http\Resources\PaymentMethodResource;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Payment;
use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Models\Tenant;
use App\Services\PaymentGatewayService;
use App\Services\PaymentMethodChannelAvailabilityService;
use App\Models\SalesChannel;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PaymentGatewayFoundationTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private PaymentGatewayService $service;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'شركة بوابات الدفع',
            'slug' => 'payment-gateway-foundation',
            'vat_number' => '300000000000013',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->service = app(PaymentGatewayService::class);
    }

    /** @test */
    public function a_tenant_can_create_and_read_its_own_gateway_without_exposing_secrets(): void
    {
        $method = $this->method('بطاقة أونلاين');

        $gateway = $this->service->create([
            'provider' => PaymentGateway::PROVIDER_STRIPE,
            'name' => 'Stripe تجريبي',
            'name_en' => 'Stripe sandbox',
            'environment' => PaymentGateway::ENVIRONMENT_SANDBOX,
            'publishable_key' => 'pk_test_visible',
            'secret_key' => 'sk_test_super_secret',
            'webhook_secret' => 'whsec_inbound_secret',
            'extra_credentials' => ['account_id' => 'acct_secret'],
            'payment_method_id' => $method->id,
        ]);

        $this->assertSame($this->tenant->id, $gateway->tenant_id);
        $this->assertSame(PaymentGateway::PROVIDER_STRIPE, $gateway->provider);
        $this->assertSame($method->id, $gateway->payment_method_id);
        $this->assertTrue($gateway->hasSecretKey());

        $stored = DB::table('payment_gateways')->where('id', $gateway->id)->first();
        $this->assertNotSame('sk_test_super_secret', $stored->secret_key);
        $this->assertNotSame('whsec_inbound_secret', $stored->webhook_secret);
        $this->assertStringNotContainsString('sk_test_super_secret', (string) $stored->secret_key);
        $this->assertStringNotContainsString('acct_secret', (string) $stored->extra_credentials);

        $serialized = $gateway->toArray();
        $this->assertArrayNotHasKey('secret_key', $serialized);
        $this->assertArrayNotHasKey('webhook_secret', $serialized);
        $this->assertArrayNotHasKey('extra_credentials', $serialized);
        $this->assertStringNotContainsString('sk_test_super_secret', $gateway->toJson());

        $payload = (new PaymentGatewayResource($gateway))->resolve();
        $this->assertSame('pk_test_visible', $payload['publishable_key']);
        $this->assertTrue($payload['has_secret_key']);
        $this->assertTrue($payload['has_webhook_secret']);
        $this->assertTrue($payload['has_extra_credentials']);
        $this->assertArrayNotHasKey('secret_key', $payload);
        $this->assertArrayNotHasKey('webhook_secret', $payload);
        $this->assertArrayNotHasKey('extra_credentials', $payload);
        $this->assertStringNotContainsString('sk_test_super_secret', json_encode($payload));
        $this->assertStringNotContainsString('whsec_inbound_secret', json_encode($payload));
        $this->assertStringNotContainsString('acct_secret', json_encode($payload));
    }

    /** @test */
    public function tenant_a_cannot_read_update_or_delete_tenant_b_gateway(): void
    {
        $gatewayA = $this->service->create([
            'provider' => PaymentGateway::PROVIDER_TAP,
            'name' => 'Tap ألف',
            'secret_key' => 'sk_live_tenant_a',
        ]);

        $tenantB = Tenant::create(['name' => 'شركة باء', 'slug' => 'payment-gateway-foundation-b']);
        app(TenantContext::class)->set($tenantB->id);
        $serviceB = app(PaymentGatewayService::class);

        $this->assertSame(0, PaymentGateway::query()->count());
        $this->assertNull(PaymentGateway::query()->whereKey($gatewayA->id)->first());

        $this->expectException(ModelNotFoundException::class);
        try {
            $serviceB->find($gatewayA->id);
        } catch (ModelNotFoundException $e) {
            try {
                $serviceB->update($gatewayA, ['name' => 'مسروق']);
                $this->fail('Tenant B was able to update Tenant A gateway.');
            } catch (DomainException) {
                try {
                    $serviceB->delete($gatewayA);
                    $this->fail('Tenant B was able to delete Tenant A gateway.');
                } catch (DomainException) {
                    throw $e;
                }
            }
        }
    }

    /** @test */
    public function a_gateway_cannot_link_another_tenants_payment_method(): void
    {
        $methodA = $this->method('بطاقة ألف');

        $tenantB = Tenant::create(['name' => 'شركة باء', 'slug' => 'payment-gateway-method-b']);
        app(TenantContext::class)->set($tenantB->id);

        $this->expectException(DomainException::class);
        $this->service->create([
            'provider' => PaymentGateway::PROVIDER_PAYTABS,
            'name' => 'PayTabs باء',
            'payment_method_id' => $methodA->id,
        ]);
    }

    /** @test */
    public function missing_tenant_context_fails_safely(): void
    {
        app(TenantContext::class)->forget();

        $this->expectException(DomainException::class);
        $this->service->create([
            'provider' => PaymentGateway::PROVIDER_CUSTOM,
            'name' => 'بوابة بلا سياق',
        ]);
    }

    /** @test */
    public function updating_non_secret_fields_does_not_wipe_existing_secrets(): void
    {
        $gateway = $this->service->create([
            'provider' => PaymentGateway::PROVIDER_CHECKOUT,
            'name' => 'Checkout',
            'secret_key' => 'sk_keep_me',
            'webhook_secret' => 'whsec_keep_me',
        ]);

        $updated = $this->service->update($gateway, [
            'name' => 'Checkout محدّث',
            'is_active' => false,
        ]);

        $this->assertSame('Checkout محدّث', $updated->name);
        $this->assertFalse($updated->is_active);
        $this->assertSame('sk_keep_me', $this->service->providerCredentials($updated)['secret_key']);
        $this->assertSame('whsec_keep_me', $this->service->providerCredentials($updated)['webhook_secret']);
    }

    /** @test */
    public function pay_v2_2_channel_availability_and_payment_method_resource_remain_unchanged(): void
    {
        $method = PaymentMethod::create([
            'name' => 'بطاقة قناة',
            'settlement_type' => 'cash',
            'available_online' => true,
            'is_active' => true,
        ]);
        $channel = SalesChannel::create([
            'slug' => 'web',
            'name' => 'متجر',
            'type' => SalesChannel::TYPE_WEB,
            'is_active' => true,
        ]);

        $this->service->create([
            'provider' => PaymentGateway::PROVIDER_STRIPE,
            'name' => 'Stripe للقناة',
            'payment_method_id' => $method->id,
            'secret_key' => 'sk_must_not_leak_into_method',
        ]);

        $availability = app(PaymentMethodChannelAvailabilityService::class);
        $this->assertTrue($availability->isAvailable($method, $channel));

        $methodPayload = (new PaymentMethodResource($method->fresh()))->resolve();
        $this->assertArrayNotHasKey('secret_key', $methodPayload);
        $this->assertArrayNotHasKey('payment_gateway_id', $methodPayload);
        $this->assertTrue($methodPayload['available_online']);
        $this->assertStringNotContainsString('sk_must_not_leak_into_method', json_encode($methodPayload));
    }

    /** @test */
    public function gateway_writes_create_no_journal_or_payment_rows(): void
    {
        $before = [
            'payments' => Payment::count(),
            'journal_entries' => JournalEntry::count(),
            'journal_lines' => JournalLine::count(),
        ];

        $gateway = $this->service->create([
            'provider' => PaymentGateway::PROVIDER_CUSTOM,
            'name' => 'بدون أثر محاسبي',
            'secret_key' => 'sk_no_posting',
        ]);
        $this->service->update($gateway, ['is_active' => false]);
        $this->service->delete($gateway->fresh());

        $this->assertSame($before, [
            'payments' => Payment::count(),
            'journal_entries' => JournalEntry::count(),
            'journal_lines' => JournalLine::count(),
        ]);
    }

    private function method(string $name): PaymentMethod
    {
        return PaymentMethod::create([
            'name' => $name,
            'settlement_type' => 'bank',
            'available_online' => true,
            'is_active' => true,
        ]);
    }
}
