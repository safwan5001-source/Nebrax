<?php

namespace Tests\Feature;

use App\Models\CommerceCheckout;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommerceShippingZone;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\ShippingRateService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * COM-MOBILE-SHIPPING-1 (ADR-10) — أول محرك تسعير شحن حقيقي: مناطق
 * مُهيَّأة من التاجر (`commerce/workspace/shipping-zones`، RBAC
 * `commerce.manage`) تُحسَم عبر `ShippingRateService` وتصل إلى
 * `CommerceCheckout.delivery_amount_minor` ثم `CommerceOrder.total`.
 *
 * تشغيل: php artisan test --filter=CommerceShippingZoneTest
 */
class CommerceShippingZoneTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const TOKEN_HEADER = 'X-Cart-Token';

    // ── ShippingRateService: pure resolution ────────────────────────────

    /** @test */
    public function no_configured_zone_resolves_to_zero(): void
    {
        $tenant = $this->makeTenant('rate-none');
        app(TenantContext::class)->set($tenant->id);

        $this->assertSame(0, app(ShippingRateService::class)->resolveRateMinor('الدمام', 'المنطقة الشرقية'));

        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_matching_city_zone_resolves_its_rate(): void
    {
        $tenant = $this->makeTenant('rate-city');
        app(TenantContext::class)->set($tenant->id);
        CommerceShippingZone::create([
            'name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 2500,
        ]);

        $this->assertSame(2500, app(ShippingRateService::class)->resolveRateMinor('الدمام', null));

        app(TenantContext::class)->forget();
    }

    /** @test */
    public function city_match_is_preferred_over_region_match(): void
    {
        $tenant = $this->makeTenant('rate-priority');
        app(TenantContext::class)->set($tenant->id);
        CommerceShippingZone::create([
            'name' => 'الشرقية', 'match_type' => 'region', 'match_value' => 'المنطقة الشرقية', 'rate_amount_minor' => 3000,
        ]);
        CommerceShippingZone::create([
            'name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 1500,
        ]);

        $this->assertSame(1500, app(ShippingRateService::class)->resolveRateMinor('الدمام', 'المنطقة الشرقية'));

        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_region_zone_is_used_when_no_city_matches(): void
    {
        $tenant = $this->makeTenant('rate-region-fallback');
        app(TenantContext::class)->set($tenant->id);
        CommerceShippingZone::create([
            'name' => 'الشرقية', 'match_type' => 'region', 'match_value' => 'المنطقة الشرقية', 'rate_amount_minor' => 3000,
        ]);

        $this->assertSame(3000, app(ShippingRateService::class)->resolveRateMinor('الجبيل', 'المنطقة الشرقية'));

        app(TenantContext::class)->forget();
    }

    /** @test */
    public function matching_is_case_insensitive(): void
    {
        $tenant = $this->makeTenant('rate-case');
        app(TenantContext::class)->set($tenant->id);
        CommerceShippingZone::create([
            'name' => 'Riyadh', 'match_type' => 'city', 'match_value' => 'Riyadh', 'rate_amount_minor' => 1800,
        ]);

        $this->assertSame(1800, app(ShippingRateService::class)->resolveRateMinor('riyadh', null));
        $this->assertSame(1800, app(ShippingRateService::class)->resolveRateMinor('RIYADH', null));

        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_inactive_zone_is_never_matched(): void
    {
        $tenant = $this->makeTenant('rate-inactive');
        app(TenantContext::class)->set($tenant->id);
        CommerceShippingZone::create([
            'name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام',
            'rate_amount_minor' => 2500, 'is_active' => false,
        ]);

        $this->assertSame(0, app(ShippingRateService::class)->resolveRateMinor('الدمام', null));

        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_zone_configured_for_one_tenant_never_leaks_into_another(): void
    {
        $tenantA = $this->makeTenant('rate-tenant-a');
        app(TenantContext::class)->set($tenantA->id);
        CommerceShippingZone::create([
            'name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 2500,
        ]);
        app(TenantContext::class)->forget();

        $tenantB = $this->makeTenant('rate-tenant-b');
        app(TenantContext::class)->set($tenantB->id);
        $this->assertSame(0, app(ShippingRateService::class)->resolveRateMinor('الدمام', null));
        app(TenantContext::class)->forget();
    }

    private function makeTenant(string $slug): Tenant
    {
        return Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
    }

    // ── Merchant configuration API (commerce.manage) ────────────────────

    /** @test */
    public function an_owner_can_create_list_update_and_delete_a_zone(): void
    {
        $auth = $this->registerTenant('zones-owner', 'owner@zones-owner.test');

        $create = $this->withToken($auth['token'])->postJson('/api/commerce/workspace/shipping-zones', [
            'name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 2500,
        ])->assertCreated();
        $zoneId = $create->json('data.id');
        $this->assertSame(2500, $create->json('data.rate_amount_minor'));
        $this->assertTrue($create->json('data.is_active'));

        $this->withToken($auth['token'])->getJson('/api/commerce/workspace/shipping-zones')
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->withToken($auth['token'])->putJson('/api/commerce/workspace/shipping-zones/'.$zoneId, [
            'name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام',
            'rate_amount_minor' => 3000, 'is_active' => false,
        ])->assertOk()
            ->assertJsonPath('data.rate_amount_minor', 3000)
            ->assertJsonPath('data.is_active', false);

        $this->withToken($auth['token'])->deleteJson('/api/commerce/workspace/shipping-zones/'.$zoneId)
            ->assertOk();

        $this->withToken($auth['token'])->getJson('/api/commerce/workspace/shipping-zones')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    /** @test */
    public function a_role_without_commerce_manage_is_forbidden(): void
    {
        $auth = $this->registerTenant('zones-staff', 'owner@zones-staff.test');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@zones-staff.test');

        $this->withToken($staff)->getJson('/api/commerce/workspace/shipping-zones')->assertForbidden();
        $this->withToken($staff)->postJson('/api/commerce/workspace/shipping-zones', [
            'name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 2500,
        ])->assertForbidden();
    }

    /** @test */
    public function a_duplicate_case_insensitive_match_value_is_rejected(): void
    {
        $auth = $this->registerTenant('zones-dup', 'owner@zones-dup.test');

        $this->withToken($auth['token'])->postJson('/api/commerce/workspace/shipping-zones', [
            'name' => 'الرياض', 'match_type' => 'city', 'match_value' => 'Riyadh', 'rate_amount_minor' => 1800,
        ])->assertCreated();

        $this->withToken($auth['token'])->postJson('/api/commerce/workspace/shipping-zones', [
            'name' => 'الرياض ٢', 'match_type' => 'city', 'match_value' => 'RIYADH', 'rate_amount_minor' => 2000,
        ])->assertStatus(422);
    }

    // ── Checkout wiring: order-independence + order total ───────────────

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string} */
    private function seedMobileStore(string $slug): array
    {
        $tenant = $this->makeTenant($slug);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        $client = app(ApiClientKeyService::class)->createClient($tenant, 'mobile-app', true);
        $key = app(ApiClientKeyService::class)->issueKey($client, 'default', []);

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $key->plainTextToken];
    }

    private function publishedProduct(Tenant $tenant, SalesChannel $channel): Product
    {
        app(TenantContext::class)->set($tenant->id);

        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج منشور', 'name_en' => 'Published Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 5000, 'tax_rate' => 15, 'is_active' => true,
        ]);
        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true,
        ]);

        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    private function cartHeaders(string $bearerToken, ?string $cartToken = null): array
    {
        $headers = ['Authorization' => 'Bearer '.$bearerToken];
        if ($cartToken !== null) {
            $headers[self::TOKEN_HEADER] = $cartToken;
        }

        return $headers;
    }

    private function cartTokenWithItem(array $store, Product $product): string
    {
        $response = $this->withHeaders($this->cartHeaders($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated();

        return $response->headers->get(self::TOKEN_HEADER);
    }

    private function patchAddress(array $store, string $cartToken, array $body): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/address', $body);
    }

    private function patchDelivery(array $store, string $cartToken, array $body): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/delivery', $body);
    }

    private function complete(array $store, string $cartToken, string $idempotencyKey): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken) + ['Idempotency-Key' => $idempotencyKey])
            ->postJson('/commerce/v1/checkout/complete', []);
    }

    /** @test */
    public function selecting_standard_delivery_after_a_matching_address_prices_it_from_the_zone(): void
    {
        $store = $this->seedMobileStore('flow-address-first');
        app(TenantContext::class)->set($store['tenant']->id);
        CommerceShippingZone::create([
            'name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 2500,
        ]);
        app(TenantContext::class)->forget();

        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->postJson('/commerce/v1/checkout', [])->assertCreated();

        $this->patchAddress($store, $cartToken, ['country' => 'SA', 'city' => 'الدمام'])->assertOk();
        $delivery = $this->patchDelivery($store, $cartToken, ['method' => 'standard'])->assertOk();

        $this->assertSame(2500, $delivery->json('data.delivery.amount.amount_minor'));
    }

    /** @test */
    public function changing_address_after_selecting_standard_delivery_recomputes_the_rate(): void
    {
        $store = $this->seedMobileStore('flow-delivery-first');
        app(TenantContext::class)->set($store['tenant']->id);
        CommerceShippingZone::create([
            'name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 2500,
        ]);
        CommerceShippingZone::create([
            'name' => 'جدة', 'match_type' => 'city', 'match_value' => 'جدة', 'rate_amount_minor' => 4000,
        ]);
        app(TenantContext::class)->forget();

        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->postJson('/commerce/v1/checkout', [])->assertCreated();

        $this->patchAddress($store, $cartToken, ['country' => 'SA', 'city' => 'الدمام'])->assertOk();
        $this->patchDelivery($store, $cartToken, ['method' => 'standard'])
            ->assertOk()
            ->assertJsonPath('data.delivery.amount.amount_minor', 2500);

        // Order-independence: address changes again after the method is already set.
        $updated = $this->patchAddress($store, $cartToken, ['country' => 'SA', 'city' => 'جدة'])->assertOk();
        $this->assertSame(4000, $updated->json('data.delivery.amount.amount_minor'));
    }

    /** @test */
    public function pickup_never_charges_shipping_even_with_a_matching_zone(): void
    {
        $store = $this->seedMobileStore('flow-pickup');
        app(TenantContext::class)->set($store['tenant']->id);
        CommerceShippingZone::create([
            'name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 2500,
        ]);
        app(TenantContext::class)->forget();

        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->postJson('/commerce/v1/checkout', [])->assertCreated();

        $this->patchAddress($store, $cartToken, ['country' => 'SA', 'city' => 'الدمام'])->assertOk();
        $pickup = $this->patchDelivery($store, $cartToken, ['method' => 'pickup'])->assertOk();

        $this->assertSame(0, $pickup->json('data.delivery.amount.amount_minor'));
    }

    /** @test */
    public function a_tenant_with_no_configured_zones_still_completes_with_zero_delivery_amount(): void
    {
        $store = $this->seedMobileStore('flow-no-zones');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->postJson('/commerce/v1/checkout', [])->assertCreated();

        $this->patchAddress($store, $cartToken, ['country' => 'SA', 'city' => 'مدينة غير مهيّأة'])->assertOk();
        $this->patchDelivery($store, $cartToken, ['method' => 'standard'])
            ->assertOk()
            ->assertJsonPath('data.delivery.amount.amount_minor', 0);
    }

    /** @test */
    public function completion_adds_the_resolved_shipping_amount_to_the_order_total_and_exposes_it_in_the_serializer(): void
    {
        $store = $this->seedMobileStore('flow-complete');
        app(TenantContext::class)->set($store['tenant']->id);
        CommerceShippingZone::create([
            'name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 2500,
        ]);
        app(TenantContext::class)->forget();

        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->postJson('/commerce/v1/checkout', [])->assertCreated();

        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->patchJson('/commerce/v1/checkout/contact', [
            'name' => 'سالم الأحمدي', 'phone' => '0501234567',
        ])->assertOk();
        $this->patchAddress($store, $cartToken, ['country' => 'SA', 'city' => 'الدمام'])->assertOk();
        $this->patchDelivery($store, $cartToken, ['method' => 'standard'])->assertOk();

        $response = $this->complete($store, $cartToken, 'idem-flow-complete')->assertCreated();
        $orderId = $response->json('data.order.id');

        // Product line total (5000) + shipping (2500).
        $this->assertSame(7500, $response->json('data.order.total.amount_minor'));
        $this->assertSame(2500, $response->json('data.order.delivery.amount.amount_minor'));

        app(TenantContext::class)->set($store['tenant']->id);
        $order = CommerceOrder::withoutGlobalScopes()->findOrFail($orderId);
        $this->assertSame(7500, $order->total);
        $this->assertSame(2500, $order->delivery_amount_minor);

        $checkout = CommerceCheckout::withoutGlobalScopes()->where('id', $order->commerce_checkout_id)->firstOrFail();
        $this->assertSame(2500, $checkout->delivery_amount_minor);
        app(TenantContext::class)->forget();
    }
}
