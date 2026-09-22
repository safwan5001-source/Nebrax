<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\Otp\FakeOtpProvider;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COM-MOBILE-ORDER-HISTORY-1 — authenticated customer order history
 * ═══════════════════════════════════════════════════════════════
 *  `GET /commerce/v1/me/orders` (list) and `GET /commerce/v1/me/orders/{id}`
 *  (detail) — ownership is `CustomerContext::customerIdentityId()` alone
 *  (`CommerceOrderService::ownedOrders()`), reached only through the
 *  existing `X-Customer-Token` required-auth route group. Distinct from
 *  the guest signed-reference `GET /commerce/v1/orders/{id}` endpoint,
 *  covered by `CommerceOrderStatusApiTest`.
 *
 *  تشغيل: php artisan test --filter=CommerceCustomerOrderApiTest
 */
class CommerceCustomerOrderApiTest extends TestCase
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

    /** يكمل Checkout موثَّقاً بالكامل (سلة + عنوان + توصيل + إتمام) ويعيد معرّف الطلب. */
    private function completedOrderId(array $store, string $customerToken, Product $product, string $idempotencyKey): string
    {
        $cartToken = $this->withHeaders($this->withCartAndCustomerToken($store['token'], $customerToken))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated()->headers->get('X-Cart-Token');

        $headers = fn () => $this->withCartAndCustomerToken($store['token'], $customerToken, $cartToken);

        $this->withHeaders($headers())->postJson('/commerce/v1/checkout', [])->assertCreated();
        $this->withHeaders($headers())->patchJson('/commerce/v1/checkout/contact', [
            'name' => 'سالم الأحمدي', 'phone' => '0501234567', 'email' => 'salem@example.com',
        ])->assertOk();
        $this->withHeaders($headers())->patchJson('/commerce/v1/checkout/address', [
            'country' => 'SA', 'region' => 'المنطقة الشرقية', 'city' => 'الدمام', 'district' => 'الشاطئ',
            'street' => 'شارع الملك فهد', 'building_no' => '1234', 'additional_number' => '5678',
            'postal_code' => '31411',
        ])->assertOk();
        $this->withHeaders($headers())->patchJson('/commerce/v1/checkout/delivery', ['method' => 'pickup'])->assertOk();

        $response = $this->withHeaders($headers() + ['Idempotency-Key' => $idempotencyKey])
            ->postJson('/commerce/v1/checkout/complete', [])->assertCreated();

        return $response->json('data.order.id');
    }

    private function listOrders(array $store, string $customerToken, array $query = []): TestResponse
    {
        return $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->getJson('/commerce/v1/me/orders?'.http_build_query($query));
    }

    private function showOrder(array $store, string $customerToken, string $orderId): TestResponse
    {
        return $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->getJson("/commerce/v1/me/orders/{$orderId}");
    }

    // ── List ──────────────────────────────────────────────────────────────

    /** @test */
    public function an_authenticated_customer_can_list_their_own_completed_orders(): void
    {
        $store = $this->seedMobileStore('order-history-list');
        $product = $this->product($store['tenant'], $store['channel'], 'OH-LIST-1');
        $customerToken = $this->customerToken($store, '+966500000200');

        $orderId = $this->completedOrderId($store, $customerToken, $product, 'idem-oh-list-1');

        $response = $this->listOrders($store, $customerToken)->assertOk();

        $response->assertJsonCount(1, 'data');
        $response->assertJsonPath('data.0.id', $orderId);
        $response->assertJsonPath('data.0.status', CommerceOrder::STATUS_CONFIRMED);
        $response->assertJsonPath('data.0.delivery_method', 'pickup');
        $response->assertJsonPath('data.0.total.amount_minor', 10000);
        $response->assertJsonPath('data.0.total.currency', 'SAR');
        $this->assertNotNull($response->json('data.0.number'));
        $this->assertNotNull($response->json('data.0.created_at'));
        $response->assertJsonPath('meta.pagination.total', 1);
    }

    /** @test */
    public function newest_orders_list_first_by_default(): void
    {
        $store = $this->seedMobileStore('order-history-sort');
        $product = $this->product($store['tenant'], $store['channel'], 'OH-SORT-1');
        $customerToken = $this->customerToken($store, '+966500000201');

        $firstOrderId = $this->completedOrderId($store, $customerToken, $product, 'idem-oh-sort-1');
        $this->travel(2)->seconds();
        $secondOrderId = $this->completedOrderId($store, $customerToken, $product, 'idem-oh-sort-2');

        $response = $this->listOrders($store, $customerToken)->assertOk();

        $response->assertJsonPath('data.0.id', $secondOrderId);
        $response->assertJsonPath('data.1.id', $firstOrderId);
    }

    /** @test */
    public function order_list_is_isolated_per_customer(): void
    {
        $store = $this->seedMobileStore('order-history-isolation');
        $product = $this->product($store['tenant'], $store['channel'], 'OH-ISO-1');
        $ownerToken = $this->customerToken($store, '+966500000202');
        $otherToken = $this->customerToken($store, '+966500000203');

        $this->completedOrderId($store, $ownerToken, $product, 'idem-oh-iso-1');

        $this->listOrders($store, $ownerToken)->assertOk()->assertJsonCount(1, 'data');
        $this->listOrders($store, $otherToken)->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function a_guest_completed_order_never_appears_in_any_customers_history(): void
    {
        $store = $this->seedMobileStore('order-history-guest');
        $product = $this->product($store['tenant'], $store['channel'], 'OH-GUEST-1');
        $customerToken = $this->customerToken($store, '+966500000204');

        // Guest checkout — no X-Customer-Token anywhere in this flow.
        $cartToken = $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated()->headers->get('X-Cart-Token');
        $guestHeaders = fn () => $this->bearer($store['token']) + ['X-Cart-Token' => $cartToken];
        $this->withHeaders($guestHeaders())->postJson('/commerce/v1/checkout', [])->assertCreated();
        $this->withHeaders($guestHeaders())->patchJson('/commerce/v1/checkout/contact', [
            'name' => 'ضيف', 'phone' => '0509999999',
        ])->assertOk();
        $this->withHeaders($guestHeaders())->patchJson('/commerce/v1/checkout/address', [
            'country' => 'US', 'city' => 'Springfield', 'street' => 'Main St',
        ])->assertOk();
        $this->withHeaders($guestHeaders())->patchJson('/commerce/v1/checkout/delivery', ['method' => 'pickup'])->assertOk();
        $guestOrder = $this->withHeaders($guestHeaders() + ['Idempotency-Key' => 'idem-oh-guest-1'])
            ->postJson('/commerce/v1/checkout/complete', [])->assertCreated();

        app(TenantContext::class)->set($store['tenant']->id);
        $order = CommerceOrder::withoutGlobalScopes()->findOrFail($guestOrder->json('data.order.id'));
        $this->assertNull($order->customer_identity_id);
        app(TenantContext::class)->forget();

        $this->listOrders($store, $customerToken)->assertOk()->assertJsonCount(0, 'data');
        $this->showOrder($store, $customerToken, $guestOrder->json('data.order.id'))->assertStatus(404);
    }

    /** @test */
    public function listing_orders_without_a_customer_token_is_rejected(): void
    {
        $store = $this->seedMobileStore('order-history-no-token');

        $this->withHeaders($this->bearer($store['token']))
            ->getJson('/commerce/v1/me/orders')
            ->assertStatus(401);
    }

    // ── Detail ────────────────────────────────────────────────────────────

    /** @test */
    public function an_authenticated_customer_can_view_their_own_order_detail(): void
    {
        $store = $this->seedMobileStore('order-history-detail');
        $product = $this->product($store['tenant'], $store['channel'], 'OH-DETAIL-1');
        $customerToken = $this->customerToken($store, '+966500000205');

        $orderId = $this->completedOrderId($store, $customerToken, $product, 'idem-oh-detail-1');

        $response = $this->showOrder($store, $customerToken, $orderId)->assertOk();

        $response->assertJsonPath('data.order.id', $orderId);
        $response->assertJsonPath('data.order.contact.name', 'سالم الأحمدي');
        $response->assertJsonPath('data.order.delivery.country', 'SA');
        $response->assertJsonPath('data.order.delivery.region', 'المنطقة الشرقية');
        $response->assertJsonPath('data.order.delivery.city', 'الدمام');
        $response->assertJsonPath('data.order.delivery.building_no', '1234');
        $response->assertJsonPath('data.order.delivery.additional_number', '5678');
        $response->assertJsonPath('data.order.items.0.product_id', $product->id);
        $response->assertJsonPath('data.order.items.0.quantity', 1);
    }

    /** @test */
    public function viewing_a_foreign_customers_order_is_rejected(): void
    {
        $store = $this->seedMobileStore('order-history-foreign');
        $product = $this->product($store['tenant'], $store['channel'], 'OH-FOREIGN-1');
        $ownerToken = $this->customerToken($store, '+966500000206');
        $attackerToken = $this->customerToken($store, '+966500000207');

        $orderId = $this->completedOrderId($store, $ownerToken, $product, 'idem-oh-foreign-1');

        $this->showOrder($store, $attackerToken, $orderId)
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');
    }

    /** @test */
    public function a_nonexistent_order_id_returns_the_same_non_revealing_404(): void
    {
        $store = $this->seedMobileStore('order-history-missing');
        $customerToken = $this->customerToken($store, '+966500000208');

        $this->showOrder($store, $customerToken, (string) Str::uuid())
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');
    }

    /** @test */
    public function viewing_order_detail_without_a_customer_token_is_rejected(): void
    {
        $store = $this->seedMobileStore('order-history-detail-no-token');

        $this->withHeaders($this->bearer($store['token']))
            ->getJson('/commerce/v1/me/orders/'.Str::uuid())
            ->assertStatus(401);
    }

    /** @test */
    public function order_detail_and_list_expose_no_sensitive_internal_fields(): void
    {
        $store = $this->seedMobileStore('order-history-leak');
        $product = $this->product($store['tenant'], $store['channel'], 'OH-LEAK-1');
        $customerToken = $this->customerToken($store, '+966500000209');

        $orderId = $this->completedOrderId($store, $customerToken, $product, 'idem-oh-leak-1');

        $listPayload = json_encode($this->listOrders($store, $customerToken)->json('data'));
        $detailPayload = json_encode($this->showOrder($store, $customerToken, $orderId)->json('data.order'));

        foreach (['tenant_id', 'sales_channel_id', 'storefront_id', 'customer_identity_id', 'partner_id', 'cost', 'ledger', 'api_client'] as $needle) {
            $this->assertStringNotContainsString($needle, $listPayload);
            $this->assertStringNotContainsString($needle, $detailPayload);
        }
    }
}
