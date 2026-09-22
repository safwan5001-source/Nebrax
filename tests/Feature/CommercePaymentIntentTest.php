<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\CommercePaymentIntentService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use RuntimeException;
use Tests\TestCase;

/**
 * COM-MOBILE-PAYMENTS-1 (ADR-04, ADR-09) — Payment Intent orchestration:
 * `method` derived from delivery method (`cod`/`pay_on_pickup`, no vendor),
 * never marked paid at order creation, an explicit `collect`/`cancel`
 * transition, and an optional `payment_method_id` selection gated by the
 * existing `PaymentMethodChannelAvailabilityService`.
 *
 * تشغيل: php artisan test --filter=CommercePaymentIntentTest
 */
class CommercePaymentIntentTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const TOKEN_HEADER = 'X-Cart-Token';

    // ── CommercePaymentIntentService: state machine ─────────────────────

    /** @test */
    public function an_order_completion_creates_an_awaiting_collection_intent_never_paid(): void
    {
        $store = $this->seedMobileStore('intent-create');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $response = $this->complete($store, $cartToken, 'idem-intent-create')->assertCreated();
        $orderId = $response->json('data.order.id');

        $this->assertSame('cod', $response->json('data.order.payment.method'));
        $this->assertSame('awaiting_collection', $response->json('data.order.payment.status'));

        app(TenantContext::class)->set($store['tenant']->id);
        $order = CommerceOrder::withoutGlobalScopes()->findOrFail($orderId);
        $intent = CommercePaymentIntent::withoutGlobalScopes()->where('commerce_order_id', $order->id)->firstOrFail();
        $this->assertSame(CommercePaymentIntent::METHOD_COD, $intent->method);
        $this->assertSame(CommercePaymentIntent::STATUS_AWAITING_COLLECTION, $intent->status);
        $this->assertSame($order->total, $intent->amount_minor);
        $this->assertNull($intent->collected_at);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function pickup_delivery_derives_the_pay_on_pickup_method(): void
    {
        $store = $this->seedMobileStore('intent-pickup');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->createCheckout($store, $cartToken)->assertCreated();
        $this->patchContact($store, $cartToken)->assertOk();
        $this->patchAddress($store, $cartToken)->assertOk();
        $this->patchDelivery($store, $cartToken, 'pickup')->assertOk();

        $response = $this->complete($store, $cartToken, 'idem-intent-pickup')->assertCreated();

        $this->assertSame('pay_on_pickup', $response->json('data.order.payment.method'));
    }

    /** @test */
    public function no_order_is_marked_paid_merely_because_it_was_created(): void
    {
        $store = $this->seedMobileStore('intent-not-paid');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $this->complete($store, $cartToken, 'idem-not-paid')->assertCreated();

        app(TenantContext::class)->set($store['tenant']->id);
        $this->assertSame(0, CommercePaymentIntent::withoutGlobalScopes()->where('status', CommercePaymentIntent::STATUS_COLLECTED)->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function collecting_transitions_to_collected_and_records_a_timestamp(): void
    {
        $tenant = $this->makeTenant('intent-collect');
        app(TenantContext::class)->set($tenant->id);
        $intent = $this->makeIntent($tenant);

        $collected = app(CommercePaymentIntentService::class)->markCollected($intent, 'استُلم نقداً');

        $this->assertSame(CommercePaymentIntent::STATUS_COLLECTED, $collected->status);
        $this->assertNotNull($collected->collected_at);
        $this->assertSame('استُلم نقداً', $collected->collection_note);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function collecting_an_already_collected_intent_is_rejected(): void
    {
        $tenant = $this->makeTenant('intent-collect-twice');
        app(TenantContext::class)->set($tenant->id);
        $intent = $this->makeIntent($tenant);
        app(CommercePaymentIntentService::class)->markCollected($intent);

        $this->expectException(RuntimeException::class);
        app(CommercePaymentIntentService::class)->markCollected($intent->fresh());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function cancelling_a_collected_intent_is_rejected(): void
    {
        $tenant = $this->makeTenant('intent-cancel-collected');
        app(TenantContext::class)->set($tenant->id);
        $intent = $this->makeIntent($tenant);
        app(CommercePaymentIntentService::class)->markCollected($intent);

        $this->expectException(RuntimeException::class);
        app(CommercePaymentIntentService::class)->cancel($intent->fresh());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function cancelling_an_awaiting_intent_succeeds_and_is_final(): void
    {
        $tenant = $this->makeTenant('intent-cancel');
        app(TenantContext::class)->set($tenant->id);
        $intent = $this->makeIntent($tenant);

        $cancelled = app(CommercePaymentIntentService::class)->cancel($intent);
        $this->assertSame(CommercePaymentIntent::STATUS_CANCELLED, $cancelled->status);

        $this->expectException(RuntimeException::class);
        app(CommercePaymentIntentService::class)->cancel($cancelled->fresh());
        app(TenantContext::class)->forget();
    }

    /**
     * Codex review (PR #940, P1): collect/cancel must lock and re-check the
     * row, not trust the caller's own in-memory status — `update()` mutates
     * the freshly-queried row the service locks, never the `$intent`
     * instance the caller passed in, so that instance's own `status`
     * attribute is *still* `awaiting_collection` after a first successful
     * collect. Passing that same stale instance to `markCollected()` again
     * proves the service checks the locked DB row, not the caller's copy.
     */
    /** @test */
    public function collecting_the_same_stale_intent_instance_twice_is_rejected_on_the_second_call(): void
    {
        $tenant = $this->makeTenant('intent-collect-stale');
        app(TenantContext::class)->set($tenant->id);
        $intent = $this->makeIntent($tenant);

        app(CommercePaymentIntentService::class)->markCollected($intent);
        $this->assertSame(CommercePaymentIntent::STATUS_AWAITING_COLLECTION, $intent->status);

        $this->expectException(RuntimeException::class);
        app(CommercePaymentIntentService::class)->markCollected($intent);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function cancelling_the_same_stale_intent_instance_after_it_was_collected_is_rejected(): void
    {
        $tenant = $this->makeTenant('intent-cancel-stale');
        app(TenantContext::class)->set($tenant->id);
        $intent = $this->makeIntent($tenant);

        app(CommercePaymentIntentService::class)->markCollected($intent);
        $this->assertSame(CommercePaymentIntent::STATUS_AWAITING_COLLECTION, $intent->status);

        $this->expectException(RuntimeException::class);
        app(CommercePaymentIntentService::class)->cancel($intent);
        app(TenantContext::class)->forget();
    }

    private function makeTenant(string $slug): Tenant
    {
        return Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
    }

    private function makeIntent(Tenant $tenant): CommercePaymentIntent
    {
        $channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        $product = Product::create(['name' => 'منتج', 'sale_price' => 5000]);
        $order = app(\App\Services\Commerce\CommerceOrderService::class)->create(
            ['sales_channel_id' => $channel->id],
            [['product_id' => $product->id, 'quantity' => 1]],
        );

        return app(CommercePaymentIntentService::class)->createForOrder($order, null, 'standard');
    }

    // ── Merchant/staff API: collect + cancel (RBAC) ─────────────────────

    /** @test */
    public function staff_with_payments_manage_can_collect_and_cancel(): void
    {
        $auth = $this->registerTenant('intent-staff', 'owner@intent-staff.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $intent = $this->makeIntent(Tenant::findOrFail($auth['tenant_id']));
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])->postJson("/api/commerce/payment-intents/{$intent->id}/collect", ['note' => 'تم الاستلام'])
            ->assertOk()
            ->assertJsonPath('data.status', 'collected');
    }

    /** @test */
    public function a_role_without_payments_manage_cannot_collect(): void
    {
        $auth = $this->registerTenant('intent-staff-forbidden', 'owner@intent-staff-forbidden.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $intent = $this->makeIntent(Tenant::findOrFail($auth['tenant_id']));
        app(TenantContext::class)->forget();
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@intent-staff-forbidden.test');

        $this->withToken($staff)->postJson("/api/commerce/payment-intents/{$intent->id}/collect")->assertForbidden();
    }

    /** @test */
    public function collecting_an_already_collected_intent_via_the_api_returns_422(): void
    {
        $auth = $this->registerTenant('intent-api-twice', 'owner@intent-api-twice.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $intent = $this->makeIntent(Tenant::findOrFail($auth['tenant_id']));
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])->postJson("/api/commerce/payment-intents/{$intent->id}/collect")->assertOk();
        $this->withToken($auth['token'])->postJson("/api/commerce/payment-intents/{$intent->id}/collect")->assertStatus(422);
    }

    // ── Checkout wiring: optional payment method + availability gating ──

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

    private function createCheckout(array $store, string $cartToken): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->postJson('/commerce/v1/checkout', []);
    }

    private function patchContact(array $store, string $cartToken): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->patchJson('/commerce/v1/checkout/contact', [
            'name' => 'سالم الأحمدي', 'phone' => '0501234567',
        ]);
    }

    private function patchAddress(array $store, string $cartToken): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->patchJson('/commerce/v1/checkout/address', [
            'country' => 'SA', 'city' => 'الدمام', 'street' => 'شارع الملك فهد',
        ]);
    }

    private function patchDelivery(array $store, string $cartToken, string $method): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->patchJson('/commerce/v1/checkout/delivery', [
            'method' => $method,
        ]);
    }

    private function patchPayment(array $store, string $cartToken, string $paymentMethodId): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))->patchJson('/commerce/v1/checkout/payment', [
            'payment_method_id' => $paymentMethodId,
        ]);
    }

    private function complete(array $store, string $cartToken, string $idempotencyKey): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken) + ['Idempotency-Key' => $idempotencyKey])
            ->postJson('/commerce/v1/checkout/complete', []);
    }

    /** يملأ contact/address/delivery(standard) فيصبح Checkout جاهزاً للإتمام. */
    private function fullyReadyCheckout(array $store, Product $product): string
    {
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->createCheckout($store, $cartToken)->assertCreated();
        $this->patchContact($store, $cartToken)->assertOk();
        $this->patchAddress($store, $cartToken)->assertOk();
        $this->patchDelivery($store, $cartToken, 'standard')->assertOk();

        return $cartToken;
    }

    /** @test */
    public function payment_methods_listing_is_empty_by_default_until_a_channel_explicitly_enables_one(): void
    {
        $store = $this->seedMobileStore('methods-empty');
        app(TenantContext::class)->set($store['tenant']->id);
        PaymentMethod::create(['name' => 'نقدي', 'settlement_type' => 'cash', 'available_online' => false, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $this->withHeaders($this->cartHeaders($store['token']))->getJson('/commerce/v1/payment-methods')
            ->assertOk()
            ->assertJsonCount(0, 'data.payment_methods');
    }

    /** @test */
    public function an_online_enabled_payment_method_appears_in_the_listing(): void
    {
        $store = $this->seedMobileStore('methods-online');
        app(TenantContext::class)->set($store['tenant']->id);
        $method = PaymentMethod::create(['name' => 'نقدي', 'settlement_type' => 'cash', 'available_online' => true, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $response = $this->withHeaders($this->cartHeaders($store['token']))->getJson('/commerce/v1/payment-methods')->assertOk();
        $this->assertSame($method->id, $response->json('data.payment_methods.0.id'));
    }

    /** @test */
    public function selecting_an_available_payment_method_persists_and_completion_snapshots_its_name(): void
    {
        $store = $this->seedMobileStore('methods-select');
        app(TenantContext::class)->set($store['tenant']->id);
        $method = PaymentMethod::create(['name' => 'نقدي', 'settlement_type' => 'cash', 'available_online' => true, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->fullyReadyCheckout($store, $product);
        $this->patchPayment($store, $cartToken, $method->id)
            ->assertOk()
            ->assertJsonPath('data.payment.payment_method_id', $method->id);

        $response = $this->complete($store, $cartToken, 'idem-methods-select')->assertCreated();
        $this->assertSame('نقدي', $response->json('data.order.payment.payment_method_name'));
    }

    /** @test */
    public function selecting_a_payment_method_not_enabled_for_the_channel_is_rejected(): void
    {
        $store = $this->seedMobileStore('methods-unavailable');
        app(TenantContext::class)->set($store['tenant']->id);
        $method = PaymentMethod::create(['name' => 'تحويل بنكي', 'settlement_type' => 'bank', 'available_online' => false, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $this->patchPayment($store, $cartToken, $method->id)->assertStatus(422);
    }

    /** @test */
    public function completion_succeeds_with_no_payment_method_ever_selected(): void
    {
        $store = $this->seedMobileStore('methods-none-selected');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $response = $this->complete($store, $cartToken, 'idem-methods-none')->assertCreated();

        $this->assertNull($response->json('data.order.payment.payment_method_name'));
        $this->assertSame('awaiting_collection', $response->json('data.order.payment.status'));
    }

    /**
     * Codex review (PR #940, P2): a method valid at selection time can be
     * disabled for the channel before completion (`setAvailability()`).
     * Completion must re-check availability, not just `is_active` — a
     * selection that is no longer valid must fail closed, never silently
     * attach to the order.
     */
    /** @test */
    public function completion_rejects_a_selected_method_disabled_for_the_channel_after_selection(): void
    {
        $store = $this->seedMobileStore('methods-disabled-after-select');
        app(TenantContext::class)->set($store['tenant']->id);
        $method = PaymentMethod::create(['name' => 'نقدي', 'settlement_type' => 'cash', 'available_online' => true, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->fullyReadyCheckout($store, $product);
        $this->patchPayment($store, $cartToken, $method->id)->assertOk();

        app(TenantContext::class)->set($store['tenant']->id);
        $method->update(['available_online' => false]);
        app(TenantContext::class)->forget();

        $this->complete($store, $cartToken, 'idem-methods-disabled-after-select')->assertStatus(422);
    }

    /**
     * Codex review (PR #940, P2): `StorefrontCheckout`/`StorefrontOrder`
     * treat `payment` as always present; `emptyResponse()` (no checkout
     * created yet) must include it too, or the frontend mapper reads
     * `payment.payment_method_id` off `undefined` and throws.
     */
    /** @test */
    public function a_checkout_response_before_any_checkout_exists_still_has_a_present_but_null_payment_shape(): void
    {
        $store = $this->seedMobileStore('payment-shape-empty');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);

        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->getJson('/commerce/v1/checkout')
            ->assertOk()
            ->assertJsonPath('data.payment.payment_method_id', null)
            ->assertJsonPath('data.payment.payment_method_name', null)
            ->assertJsonPath('data.payment.method', null);
    }
}
