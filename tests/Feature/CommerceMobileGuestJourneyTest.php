<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommerceShippingZone;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * COM-MOBILE-VERTICAL-TEST-1 (ADR-13 §2, guest journey) — one continuous
 * `/commerce/v1` scenario: catalog browse → cart → checkout (contact,
 * address, delivery, payment) → completion → signed guest order lookup.
 * Now incorporating the just-landed Shipping (ADR-10) and Payments (ADR-09)
 * legs into the same slice, per ADR-13 §5's own incremental-extension
 * instruction — the earlier partial slice (before either landed) always
 * priced delivery at a hardcoded `0` and never selected a payment method.
 *
 * This does **not** re-prove what the dense per-endpoint feature tests
 * already cover (validation edge cases, RBAC, concurrency) — it proves the
 * **composition** risk ADR-13 §2 names explicitly: the same `X-Cart-Token`
 * survives across every step from the first cart write through order
 * completion, the shipping zone resolved mid-checkout is the exact amount
 * folded into the final order total, the payment method selected mid-
 * checkout is the exact one snapshotted onto the completed order, and the
 * guest identity boundary (a signed reference, never a bearer token or a
 * bare id) holds all the way through to the standalone lookup endpoint.
 *
 * تشغيل: php artisan test --filter=CommerceMobileGuestJourneyTest
 */
class CommerceMobileGuestJourneyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const CART_TOKEN_HEADER = 'X-Cart-Token';

    /** @test */
    public function a_guest_completes_the_full_journey_from_catalogue_browse_to_signed_order_lookup(): void
    {
        $store = $this->seedMobileStore('guest-journey');
        $product = $this->publishedProduct($store, priceMinor: 5000);
        $this->seedShippingZone($store, city: 'الدمام', rateMinor: 2000);
        $method = $this->seedEnabledPaymentMethod($store, name: 'نقدي عند الاستلام');

        // ── 1. Catalog browse — no cart token exists yet ────────────────
        $catalog = $this->withHeaders($this->bearer($store['token']))
            ->getJson('/commerce/v1/products')->assertOk()->json('data');
        $this->assertNotEmpty($catalog);
        $this->assertSame($product->id, $catalog[0]['id']);

        // ── 2. Cart — the first write mints X-Cart-Token ────────────────
        $addResponse = $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 2])
            ->assertCreated();
        $cartToken = $addResponse->headers->get(self::CART_TOKEN_HEADER);
        $this->assertNotEmpty($cartToken, 'أول كتابة على السلة يجب أن تصدر X-Cart-Token.');
        $this->assertSame(10000, $addResponse->json('data.subtotal.amount_minor'));

        // The exact same token, presented again, resolves the same cart —
        // no new identity minted merely by reading it back.
        $reread = $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->getJson('/commerce/v1/cart')->assertOk();
        $this->assertNull($reread->headers->get(self::CART_TOKEN_HEADER), 'قراءة رمزٍ صالح لا تعيد رمزاً جديداً.');
        $this->assertCount(1, $reread->json('data.items'));

        // ── 3. Checkout — shares Cart's token, no separate identity ─────
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->postJson('/commerce/v1/checkout', [])->assertCreated();

        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/contact', ['name' => 'سالم الأحمدي', 'phone' => '0501234567'])
            ->assertOk()
            ->assertJsonPath('data.contact.name', 'سالم الأحمدي');

        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/address', [
                'country' => 'SA', 'city' => 'الدمام', 'street' => 'شارع الملك فهد',
            ])->assertOk();

        // Shipping (ADR-10): the configured zone rate for "الدمام" resolves
        // mid-checkout — never the client, never a hardcoded 0.
        $afterDelivery = $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/delivery', ['method' => 'standard'])
            ->assertOk()->json('data');
        $this->assertSame(2000, $afterDelivery['delivery']['amount']['amount_minor'], 'مبلغ التوصيل يجب أن يطابق منطقة الشحن المُهيَّأة.');

        // Payments (ADR-09): only the channel's own already-enabled method
        // can be selected — GET payment-methods is the same list PATCH
        // checkout/payment must accept.
        $available = $this->withHeaders($this->bearer($store['token']))
            ->getJson('/commerce/v1/payment-methods')->assertOk()->json('data.payment_methods');
        $this->assertSame($method->id, $available[0]['id']);

        $afterPayment = $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/payment', ['payment_method_id' => $method->id])
            ->assertOk()->json('data');
        $this->assertSame($method->id, $afterPayment['payment']['payment_method_id']);
        $this->assertSame('نقدي عند الاستلام', $afterPayment['payment']['payment_method_name']);
        // Preview only — the real commitment is a CommercePaymentIntent,
        // created only on successful completion below, never before.
        $this->assertSame('cod', $afterPayment['payment']['method']);

        // ── 4. Completion — one Idempotency-Key, one order ──────────────
        $completion = $this->withHeaders($this->cartHeaders($store['token'], $cartToken) + ['Idempotency-Key' => 'guest-journey-1'])
            ->postJson('/commerce/v1/checkout/complete', [])
            ->assertCreated()->json('data');

        $order = $completion['order'];
        // Composition: subtotal (10000) + the exact shipping amount
        // resolved above (2000) — never re-derived from a different source.
        $this->assertSame(12000, $order['total']['amount_minor']);
        $this->assertSame(2000, $order['delivery']['amount']['amount_minor']);
        $this->assertSame('standard', $order['delivery_method']);
        // The method selected mid-checkout is exactly what the order
        // snapshots — never re-resolved or silently dropped at completion.
        $this->assertSame('نقدي عند الاستلام', $order['payment']['payment_method_name']);
        $this->assertSame('cod', $order['payment']['method']);
        $this->assertSame('awaiting_collection', $order['payment']['status']);
        $this->assertFalse($completion['replayed']);
        $this->assertNotEmpty($completion['order_reference']);

        // ── 5. Standalone signed lookup — a fresh, cart-token-less call ─
        $lookup = $this->withHeaders(
            $this->bearer($store['token']) + ['X-Order-Reference' => $completion['order_reference']],
        )->getJson("/commerce/v1/orders/{$order['id']}")->assertOk()->json('data.order');

        $this->assertSame($order['id'], $lookup['id']);
        $this->assertSame($order['number'], $lookup['number']);
        $this->assertSame(12000, $lookup['total']['amount_minor']);
        $this->assertSame('نقدي عند الاستلام', $lookup['payment']['payment_method_name']);
        $this->assertNotEmpty($lookup['items']);
        $this->assertSame(2, $lookup['items'][0]['quantity']);
    }

    /** @test */
    public function completing_the_same_checkout_twice_with_the_same_idempotency_key_replays_the_identical_order(): void
    {
        $store = $this->seedMobileStore('guest-idempotent');
        $product = $this->publishedProduct($store, priceMinor: 3000);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $first = $this->withHeaders($this->cartHeaders($store['token'], $cartToken) + ['Idempotency-Key' => 'guest-replay-1'])
            ->postJson('/commerce/v1/checkout/complete', [])->assertCreated()->json('data');

        $second = $this->withHeaders($this->cartHeaders($store['token'], $cartToken) + ['Idempotency-Key' => 'guest-replay-1'])
            ->postJson('/commerce/v1/checkout/complete', [])->assertOk()->json('data');

        $this->assertFalse($first['replayed']);
        $this->assertTrue($second['replayed']);
        $this->assertSame($first['order']['id'], $second['order']['id']);
        $this->assertSame($first['order_reference'], $second['order_reference']);

        $this->assertSame(1, CommerceOrder::withoutGlobalScopes()->count(), 'لا طلب مكرّر — نفس الطلب حرفياً.');
    }

    /** @test */
    public function a_guest_order_is_invisible_without_the_exact_signed_reference_issued_for_it(): void
    {
        $store = $this->seedMobileStore('guest-boundary');
        $product = $this->publishedProduct($store, priceMinor: 4000);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $completion = $this->withHeaders($this->cartHeaders($store['token'], $cartToken) + ['Idempotency-Key' => 'guest-boundary-1'])
            ->postJson('/commerce/v1/checkout/complete', [])->assertCreated()->json('data');
        $orderId = $completion['order']['id'];

        // No reference at all.
        $this->withHeaders($this->bearer($store['token']))
            ->getJson("/commerce/v1/orders/{$orderId}")->assertStatus(404);

        // A syntactically-plausible but wrong reference.
        $this->withHeaders($this->bearer($store['token']) + ['X-Order-Reference' => 'v1.'.str_repeat('a', 64)])
            ->getJson("/commerce/v1/orders/{$orderId}")->assertStatus(404);

        // A second guest's real, validly-issued reference for a *different*
        // order — proves the signature is bound to this exact order id, not
        // merely "any reference this tenant/channel ever issued".
        // (`withHeaders()` merges into persistent per-test defaults in
        // Laravel's test client — flush first, or this "second guest"
        // would silently inherit the first guest's own, now-consumed,
        // X-Cart-Token from the calls above.)
        $this->flushHeaders();
        $otherCartToken = $this->fullyReadyCheckout($store, $product);
        $otherCompletion = $this->withHeaders($this->cartHeaders($store['token'], $otherCartToken) + ['Idempotency-Key' => 'guest-boundary-2'])
            ->postJson('/commerce/v1/checkout/complete', [])->assertCreated()->json('data');

        $this->withHeaders($this->bearer($store['token']) + ['X-Order-Reference' => $otherCompletion['order_reference']])
            ->getJson("/commerce/v1/orders/{$orderId}")->assertStatus(404);

        // The genuinely correct reference still works.
        $this->withHeaders($this->bearer($store['token']) + ['X-Order-Reference' => $completion['order_reference']])
            ->getJson("/commerce/v1/orders/{$orderId}")->assertOk();
    }

    /** @test */
    public function a_guest_order_never_appears_in_any_customers_order_history(): void
    {
        $store = $this->seedMobileStore('guest-vs-customer');
        $product = $this->publishedProduct($store, priceMinor: 2500);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $this->withHeaders($this->cartHeaders($store['token'], $cartToken) + ['Idempotency-Key' => 'guest-vs-customer-1'])
            ->postJson('/commerce/v1/checkout/complete', [])->assertCreated();

        // A customer who authenticates afterward, sharing the same store,
        // must see no trace of the guest's order in their own history.
        $customerToken = $this->authenticatedCustomer($store);
        $history = $this->withHeaders($this->withCustomerToken($store['token'], $customerToken))
            ->getJson('/commerce/v1/me/orders')->assertOk()->json('data');

        $this->assertSame([], $history, 'طلب ضيفٍ لا يظهر أبداً في سجلّ أي عميل.');
    }

    // ══ تركيبات ═════════════════════════════════════════════════════════

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

        $client = app(ApiClientKeyService::class)->createClient($tenant, 'mobile-app', true);
        $key = app(ApiClientKeyService::class)->issueKey($client, 'default', []);

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

    private function cartHeaders(string $bearerToken, ?string $cartToken = null): array
    {
        $headers = $this->bearer($bearerToken);
        if ($cartToken !== null) {
            $headers[self::CART_TOKEN_HEADER] = $cartToken;
        }

        return $headers;
    }

    private function publishedProduct(array $store, int $priceMinor): Product
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج منشور', 'name_en' => 'Published Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => $priceMinor, 'tax_rate' => 15, 'is_active' => true,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    private function seedShippingZone(array $store, string $city, int $rateMinor): CommerceShippingZone
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $zone = CommerceShippingZone::create([
            'name' => "منطقة {$city}", 'match_type' => 'city', 'match_value' => $city,
            'rate_amount_minor' => $rateMinor, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return $zone->fresh();
    }

    private function seedEnabledPaymentMethod(array $store, string $name): PaymentMethod
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $method = PaymentMethod::create([
            'name' => $name, 'settlement_type' => 'cash', 'available_online' => true, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return $method->fresh();
    }

    private function cartTokenWithItem(array $store, Product $product): string
    {
        $response = $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated();

        return $response->headers->get(self::CART_TOKEN_HEADER);
    }

    private function createCheckout(array $store, string $cartToken): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->postJson('/commerce/v1/checkout', []);
    }

    private function fullyReadyCheckout(array $store, Product $product): string
    {
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->createCheckout($store, $cartToken)->assertCreated();
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/contact', ['name' => 'سالم الأحمدي', 'phone' => '0501234567'])->assertOk();
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/address', ['country' => 'SA', 'city' => 'الرياض', 'street' => 'شارع'])->assertOk();
        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/delivery', ['method' => 'standard'])->assertOk();

        return $cartToken;
    }

    /** يسجّل عميلاً عبر OTP ويعيد رمز customer:access. */
    private function authenticatedCustomer(array $store): string
    {
        $phone = '+9665'.random_int(10000000, 99999999);
        $this->withHeaders($this->bearer($store['token']))->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone])->assertStatus(202);
        $code = \App\Services\Commerce\Otp\FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');

        return $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code])
            ->assertOk()->json('data.token');
    }
}
