<?php

namespace Tests\Feature;

use App\Models\CommerceCustomerAddress;
use App\Models\CommerceListing;
use App\Models\CustomerIdentity;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\Otp\FakeOtpProvider;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — COM-MOBILE-ADDRESSES-1 (ADR-08)
 * ═══════════════════════════════════════════════════════════════
 *  CRUD over the authenticated customer's own saved address book. Every
 *  route is reached through the existing `X-Customer-Token` required-auth
 *  group (`AuthenticateCommerceCustomer` + `EstablishCustomerContext`,
 *  unmodified) — never a new auth mechanism. Covers: full CRUD, per-customer
 *  and per-tenant isolation, default-shipping/default-billing exclusivity,
 *  and country-aware Saudi National Address validation.
 *
 *  تشغيل: php artisan test --filter=CommerceCustomerAddressApiTest
 */
class CommerceCustomerAddressApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string} */
    private function seedMobileStore(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        $client = $this->service()->createClient($tenant, 'mobile-app', true);
        $key = $this->service()->issueKey($client, 'default', []);

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $key->plainTextToken];
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    private function withCustomerToken(string $apiToken, string $customerToken): array
    {
        return $this->bearer($apiToken) + ['X-Customer-Token' => $customerToken];
    }

    private function withCartAndCustomerToken(string $apiToken, string $customerToken, ?string $cartToken = null): array
    {
        $headers = $this->withCustomerToken($apiToken, $customerToken);
        if ($cartToken !== null) {
            $headers['X-Cart-Token'] = $cartToken;
        }

        return $headers;
    }

    private function product(Tenant $tenant, SalesChannel $channel, string $sku, int $price = 10000): Product
    {
        app(TenantContext::class)->set($tenant->id);
        $product = Product::create([
            'name' => "منتج {$sku}", 'sku' => $sku, 'sale_price' => $price, 'unit' => 'piece', 'is_active' => true,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    /** يسجّل عميلاً جديداً عبر OTP ويعيد توكنه الخاص جاهزاً لترويسة X-Customer-Token. */
    private function customerToken(array $store, string $phone): string
    {
        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $verify = $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->bearer($store['token']))->assertOk();

        return $verify->json('data.token');
    }

    /** @return array<string, mixed> */
    private function saudiAddressPayload(array $overrides = []): array
    {
        return array_merge([
            'label' => 'المنزل',
            'recipient_name' => 'سالم الأحمدي',
            'phone' => '0501234567',
            'country' => 'SA',
            'city' => 'الدمام',
            'district' => 'الشاطئ',
            'street' => 'شارع الملك فهد',
            'building_no' => '1234',
            'additional_number' => '5678',
            'postal_code' => '31411',
        ], $overrides);
    }

    // ── CRUD happy path ──────────────────────────────────────────────────

    /** @test */
    public function a_customer_can_create_list_update_and_delete_their_own_address(): void
    {
        $store = $this->seedMobileStore('addr-crud');
        $token = $this->customerToken($store, '+966500000101');
        $headers = $this->withCustomerToken($store['token'], $token);

        $create = $this->withHeaders($headers)->postJson('/commerce/v1/addresses', $this->saudiAddressPayload())
            ->assertCreated();
        $addressId = $create->json('data.id');
        $create->assertJsonPath('data.building_no', '1234');
        $create->assertJsonPath('data.additional_number', '5678');

        $list = $this->withHeaders($headers)->getJson('/commerce/v1/addresses')->assertOk();
        $this->assertCount(1, $list->json('data.data'));

        $this->withHeaders($headers)->patchJson("/commerce/v1/addresses/{$addressId}", ['city' => 'الجبيل'])
            ->assertOk()
            ->assertJsonPath('data.city', 'الجبيل');

        $this->withHeaders($headers)->deleteJson("/commerce/v1/addresses/{$addressId}")
            ->assertOk()
            ->assertJsonPath('data.deleted', true);

        $this->withHeaders($headers)->getJson('/commerce/v1/addresses')->assertOk()
            ->assertJsonCount(0, 'data.data');
    }

    /** @test */
    public function addresses_require_a_valid_customer_token(): void
    {
        $store = $this->seedMobileStore('addr-no-token');

        $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/addresses', $this->saudiAddressPayload())
            ->assertStatus(401);
    }

    // ── Isolation ────────────────────────────────────────────────────────

    /** @test */
    public function one_customers_addresses_are_invisible_to_another_customer_in_the_same_tenant(): void
    {
        $store = $this->seedMobileStore('addr-cross-customer');
        $tokenA = $this->customerToken($store, '+966500000102');
        $tokenB = $this->customerToken($store, '+966500000103');

        $create = $this->withHeaders($this->withCustomerToken($store['token'], $tokenA))
            ->postJson('/commerce/v1/addresses', $this->saudiAddressPayload())
            ->assertCreated();
        $addressId = $create->json('data.id');

        $this->withHeaders($this->withCustomerToken($store['token'], $tokenB))
            ->getJson('/commerce/v1/addresses')->assertOk()
            ->assertJsonCount(0, 'data.data');

        $this->withHeaders($this->withCustomerToken($store['token'], $tokenB))
            ->patchJson("/commerce/v1/addresses/{$addressId}", ['city' => 'مسروق'])
            ->assertStatus(422);

        $this->withHeaders($this->withCustomerToken($store['token'], $tokenB))
            ->deleteJson("/commerce/v1/addresses/{$addressId}")
            ->assertStatus(422);
    }

    /** @test */
    public function addresses_are_isolated_per_tenant_even_for_the_same_phone_number(): void
    {
        $storeA = $this->seedMobileStore('addr-tenant-a');
        $storeB = $this->seedMobileStore('addr-tenant-b');
        $phone = '+966500000104';

        $tokenA = $this->customerToken($storeA, $phone);
        $this->withHeaders($this->withCustomerToken($storeA['token'], $tokenA))
            ->postJson('/commerce/v1/addresses', $this->saudiAddressPayload())
            ->assertCreated();

        $tokenB = $this->customerToken($storeB, $phone);
        $this->withHeaders($this->withCustomerToken($storeB['token'], $tokenB))
            ->getJson('/commerce/v1/addresses')->assertOk()
            ->assertJsonCount(0, 'data.data');
    }

    // ── Default shipping/billing exclusivity ────────────────────────────

    /** @test */
    public function setting_a_new_default_shipping_address_clears_the_previous_one(): void
    {
        $store = $this->seedMobileStore('addr-default-shipping');
        $token = $this->customerToken($store, '+966500000105');
        $headers = $this->withCustomerToken($store['token'], $token);

        $first = $this->withHeaders($headers)->postJson('/commerce/v1/addresses', $this->saudiAddressPayload([
            'is_default_shipping' => true,
        ]))->assertCreated();
        $this->assertTrue($first->json('data.is_default_shipping'));

        $second = $this->withHeaders($headers)->postJson('/commerce/v1/addresses', $this->saudiAddressPayload([
            'label' => 'العمل', 'is_default_shipping' => true,
        ]))->assertCreated();
        $this->assertTrue($second->json('data.is_default_shipping'));

        $refreshedFirst = $this->withHeaders($headers)->getJson('/commerce/v1/addresses')->assertOk();
        $rows = collect($refreshedFirst->json('data.data'));
        $this->assertTrue($rows->firstWhere('id', $second->json('data.id'))['is_default_shipping']);
        $this->assertFalse($rows->firstWhere('id', $first->json('data.id'))['is_default_shipping']);
    }

    /** @test */
    public function default_shipping_and_default_billing_are_independent(): void
    {
        $store = $this->seedMobileStore('addr-default-independent');
        $token = $this->customerToken($store, '+966500000106');
        $headers = $this->withCustomerToken($store['token'], $token);

        $address = $this->withHeaders($headers)->postJson('/commerce/v1/addresses', $this->saudiAddressPayload([
            'is_default_shipping' => true, 'is_default_billing' => true,
        ]))->assertCreated();

        $this->assertTrue($address->json('data.is_default_shipping'));
        $this->assertTrue($address->json('data.is_default_billing'));
    }

    /** @test */
    public function the_database_enforces_at_most_one_default_shipping_address_per_customer(): void
    {
        $store = $this->seedMobileStore('addr-db-guard');
        app(TenantContext::class)->set($store['tenant']->id);
        $identity = CustomerIdentity::create([
            'tenant_id' => $store['tenant']->id, 'display_name' => 'ع',
            'phone' => '+966500000107', 'phone_verified_at' => now(), 'is_active' => true,
        ]);

        CommerceCustomerAddress::create(array_merge($this->saudiAddressPayload(), [
            'tenant_id' => $store['tenant']->id, 'customer_identity_id' => $identity->id,
            'is_default_shipping' => true,
        ]));

        $this->expectException(\Illuminate\Database\QueryException::class);
        CommerceCustomerAddress::create(array_merge($this->saudiAddressPayload(['label' => 'ثانٍ']), [
            'tenant_id' => $store['tenant']->id, 'customer_identity_id' => $identity->id,
            'is_default_shipping' => true,
        ]));
    }

    // ── Country-aware validation ─────────────────────────────────────────

    /** @test */
    public function a_saudi_address_requires_district_building_no_postal_code_and_additional_number(): void
    {
        $store = $this->seedMobileStore('addr-sa-required');
        $token = $this->customerToken($store, '+966500000108');
        $headers = $this->withCustomerToken($store['token'], $token);

        $this->withHeaders($headers)->postJson('/commerce/v1/addresses', $this->saudiAddressPayload([
            'district' => null, 'building_no' => null, 'additional_number' => null, 'postal_code' => null,
        ]))->assertStatus(422);
    }

    /** @test */
    public function a_non_saudi_address_never_requires_saudi_national_address_fields(): void
    {
        $store = $this->seedMobileStore('addr-non-sa');
        $token = $this->customerToken($store, '+966500000109');
        $headers = $this->withCustomerToken($store['token'], $token);

        $this->withHeaders($headers)->postJson('/commerce/v1/addresses', [
            'recipient_name' => 'John Smith', 'phone' => '+15551234567',
            'country' => 'US', 'city' => 'Springfield', 'street' => 'Main St',
        ])->assertCreated();
    }

    /** @test */
    public function the_universal_fields_remain_required_regardless_of_country(): void
    {
        $store = $this->seedMobileStore('addr-universal-required');
        $token = $this->customerToken($store, '+966500000110');
        $headers = $this->withCustomerToken($store['token'], $token);

        $this->withHeaders($headers)->postJson('/commerce/v1/addresses', [
            'country' => 'US', 'city' => 'Springfield', 'street' => 'Main St',
        ])->assertStatus(422);
    }

    /** @test */
    public function short_address_stays_optional_even_for_a_saudi_address(): void
    {
        $store = $this->seedMobileStore('addr-short-address-optional');
        $token = $this->customerToken($store, '+966500000111');
        $headers = $this->withCustomerToken($store['token'], $token);

        $this->withHeaders($headers)->postJson('/commerce/v1/addresses', $this->saudiAddressPayload())
            ->assertCreated()
            ->assertJsonPath('data.short_address', null);
    }

    // ── Select a saved address at checkout (COM-MOBILE-ADDRESSES-1, deferred feature) ──

    /** @test */
    public function selecting_a_saved_address_copies_its_fields_into_the_checkout_delivery_address(): void
    {
        $store = $this->seedMobileStore('addr-checkout-select');
        $product = $this->product($store['tenant'], $store['channel'], 'ADDR-CHECKOUT-1');
        $customerToken = $this->customerToken($store, '+966500000112');

        $address = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->postJson('/commerce/v1/addresses', $this->saudiAddressPayload())
            ->assertCreated();
        $addressId = $address->json('data.id');

        $cartToken = $this->withHeaders($this->withCartAndCustomerToken($store['token'], $customerToken))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated()->headers->get('X-Cart-Token');
        $this->withHeaders($this->withCartAndCustomerToken($store['token'], $customerToken, $cartToken))
            ->postJson('/commerce/v1/checkout', [])->assertCreated();

        $response = $this->withHeaders($this->withCartAndCustomerToken($store['token'], $customerToken, $cartToken))
            ->patchJson('/commerce/v1/checkout/address', ['address_id' => $addressId])
            ->assertOk();

        $response->assertJsonPath('data.delivery.address.city', 'الدمام');
        $response->assertJsonPath('data.delivery.address.district', 'الشاطئ');
        $response->assertJsonPath('data.delivery.address.street', 'شارع الملك فهد');
        $response->assertJsonPath('data.delivery.address.postal_code', '31411');
    }

    /** @test */
    public function selecting_a_saved_address_alongside_manual_fields_is_rejected(): void
    {
        $store = $this->seedMobileStore('addr-checkout-mixed');
        $product = $this->product($store['tenant'], $store['channel'], 'ADDR-CHECKOUT-2');
        $customerToken = $this->customerToken($store, '+966500000113');

        $address = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->postJson('/commerce/v1/addresses', $this->saudiAddressPayload())
            ->assertCreated();

        $cartToken = $this->withHeaders($this->withCartAndCustomerToken($store['token'], $customerToken))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated()->headers->get('X-Cart-Token');
        $this->withHeaders($this->withCartAndCustomerToken($store['token'], $customerToken, $cartToken))
            ->postJson('/commerce/v1/checkout', [])->assertCreated();

        $this->withHeaders($this->withCartAndCustomerToken($store['token'], $customerToken, $cartToken))
            ->patchJson('/commerce/v1/checkout/address', ['address_id' => $address->json('data.id'), 'city' => 'الرياض'])
            ->assertStatus(422);
    }

    /** @test */
    public function selecting_a_foreign_customers_address_at_checkout_is_rejected(): void
    {
        $store = $this->seedMobileStore('addr-checkout-foreign');
        $product = $this->product($store['tenant'], $store['channel'], 'ADDR-CHECKOUT-3');
        $ownerToken = $this->customerToken($store, '+966500000114');
        $attackerToken = $this->customerToken($store, '+966500000115');

        $address = $this->withHeaders($this->withCustomerToken($store['token'], $ownerToken))
            ->postJson('/commerce/v1/addresses', $this->saudiAddressPayload())
            ->assertCreated();

        $cartToken = $this->withHeaders($this->withCartAndCustomerToken($store['token'], $attackerToken))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated()->headers->get('X-Cart-Token');
        $this->withHeaders($this->withCartAndCustomerToken($store['token'], $attackerToken, $cartToken))
            ->postJson('/commerce/v1/checkout', [])->assertCreated();

        $this->withHeaders($this->withCartAndCustomerToken($store['token'], $attackerToken, $cartToken))
            ->patchJson('/commerce/v1/checkout/address', ['address_id' => $address->json('data.id')])
            ->assertStatus(422);
    }

    /** @test */
    public function selecting_a_saved_address_as_a_guest_checkout_is_rejected(): void
    {
        $store = $this->seedMobileStore('addr-checkout-guest');
        $product = $this->product($store['tenant'], $store['channel'], 'ADDR-CHECKOUT-4');

        $cartToken = $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated()->headers->get('X-Cart-Token');
        $this->withHeaders($this->bearer($store['token']) + ['X-Cart-Token' => $cartToken])
            ->postJson('/commerce/v1/checkout', [])->assertCreated();

        $this->withHeaders($this->bearer($store['token']) + ['X-Cart-Token' => $cartToken])
            ->patchJson('/commerce/v1/checkout/address', ['address_id' => (string) Str::uuid()])
            ->assertStatus(422);
    }

    /** @test */
    public function a_selected_address_is_copied_not_referenced_surviving_a_later_edit(): void
    {
        $store = $this->seedMobileStore('addr-checkout-snapshot');
        $product = $this->product($store['tenant'], $store['channel'], 'ADDR-CHECKOUT-5');
        $customerToken = $this->customerToken($store, '+966500000116');

        $address = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->postJson('/commerce/v1/addresses', $this->saudiAddressPayload())
            ->assertCreated();
        $addressId = $address->json('data.id');

        $cartToken = $this->withHeaders($this->withCartAndCustomerToken($store['token'], $customerToken))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated()->headers->get('X-Cart-Token');
        $this->withHeaders($this->withCartAndCustomerToken($store['token'], $customerToken, $cartToken))
            ->postJson('/commerce/v1/checkout', [])->assertCreated();
        $this->withHeaders($this->withCartAndCustomerToken($store['token'], $customerToken, $cartToken))
            ->patchJson('/commerce/v1/checkout/address', ['address_id' => $addressId])
            ->assertOk();

        // Edit the saved address after selecting it — the checkout must not
        // silently change underneath the customer (copy, not reference).
        $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->patchJson("/commerce/v1/addresses/{$addressId}", ['city' => 'الجبيل'])
            ->assertOk();

        $checkout = $this->withHeaders($this->withCartAndCustomerToken($store['token'], $customerToken, $cartToken))
            ->getJson('/commerce/v1/checkout')->assertOk();
        $checkout->assertJsonPath('data.delivery.address.city', 'الدمام');
    }
}
