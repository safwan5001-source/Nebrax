<?php

namespace Tests\Feature;

use App\Models\CommerceCheckout;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\CommerceCheckoutService;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — PR-4 (Mobile Checkout)
 * ═══════════════════════════════════════════════════════════════
 *  يثبت القرار المعماري المطبَّق على Checkout (نفس Option A المعتمد لـ
 *  Cart في PR-3): هوية Checkout = tenant_id + sales_channel_id، وstorefront_id
 *  اختياري (NULL للجوال، إلزامي منطقياً للويب). نفس توكن X-Cart-Token
 *  المعتمد في PR-3 — لا آلية هوية جديدة.
 *
 *  تشغيل: php artisan test --filter=CommerceCheckoutApiTest
 */
class CommerceCheckoutApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const TOKEN_HEADER = 'X-Cart-Token';

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

    /** @return array{tenant: Tenant, channel: SalesChannel, storefront: Storefront} */
    private function seedWebStore(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر ويب {$slug}", 'slug' => 'web-'.$slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return ['tenant' => $tenant, 'channel' => $channel, 'storefront' => $storefront];
    }

    private function publishedProduct(Tenant $tenant, SalesChannel $channel, array $attrs = []): Product
    {
        app(TenantContext::class)->set($tenant->id);

        $product = Product::create(array_merge([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج منشور', 'name_en' => 'Published Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 5000, 'tax_rate' => 15,
            'is_active' => true,
            'avg_cost' => 9999, 'purchase_price' => 8000, 'quantity_on_hand' => 42,
            'internal_notes' => 'سرّي جداً', 'tags' => 'internal-tag',
        ], $attrs));

        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true,
        ]);

        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    private function cartHeaders(string $bearerToken, ?string $cartToken = null): array
    {
        $headers = $this->bearer($bearerToken);
        if ($cartToken !== null) {
            $headers[self::TOKEN_HEADER] = $cartToken;
        }

        return $headers;
    }

    /** يضيف صنفاً واحداً لسلة جديدة، ويعيد raw X-Cart-Token. */
    private function cartTokenWithItem(array $store, Product $product, int $quantity = 1): string
    {
        $response = $this->withHeaders($this->cartHeaders($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => $quantity])
            ->assertCreated();

        return $response->headers->get(self::TOKEN_HEADER);
    }

    private function createCheckout(array $store, ?string $cartToken): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->postJson('/commerce/v1/checkout', []);
    }

    private function getCheckout(array $store, ?string $cartToken): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->getJson('/commerce/v1/checkout');
    }

    private function patchContact(array $store, string $cartToken, array $body): TestResponse
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/contact', $body);
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

    private function complete(array $store, string $cartToken, ?string $idempotencyKey): TestResponse
    {
        $headers = $this->cartHeaders($store['token'], $cartToken);
        if ($idempotencyKey !== null) {
            $headers['Idempotency-Key'] = $idempotencyKey;
        }

        return $this->withHeaders($headers)->postJson('/commerce/v1/checkout/complete', []);
    }

    /** يملأ contact/address/delivery فيصبح Checkout جاهزاً للإتمام. */
    private function readyCheckout(array $store, string $cartToken): void
    {
        $this->patchContact($store, $cartToken, [
            'name' => 'سالم الأحمدي', 'phone' => '0501234567', 'email' => 'salem@example.com',
        ])->assertOk();
        $this->patchAddress($store, $cartToken, [
            'country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ',
            'street' => 'شارع الملك فهد', 'postal_code' => '31411',
        ])->assertOk();
        $this->patchDelivery($store, $cartToken, ['method' => 'pickup'])->assertOk();
    }

    /** تدفّق كامل: سلة + Checkout + جاهز للإتمام، يعيد raw cart token. */
    private function fullyReadyCheckout(array $store, Product $product): string
    {
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->createCheckout($store, $cartToken)->assertCreated();
        $this->readyCheckout($store, $cartToken);

        return $cartToken;
    }

    // ── 1. Mobile checkout from valid mobile cart ──────────────────────────

    /** @test */
    public function a_mobile_checkout_can_be_created_from_a_valid_mobile_cart(): void
    {
        $store = $this->seedMobileStore('mobile-checkout');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);

        $response = $this->createCheckout($store, $cartToken)->assertCreated();
        $response->assertJsonPath('data.status', CommerceCheckout::STATUS_ACTIVE);
        $response->assertJsonPath('data.cart.items.0.product_id', $product->id);
        $this->assertDatabaseCount('commerce_checkouts', 1);
    }

    // ── 2/3. storefront_id persistence (mobile NULL / web non-null) ────────

    /** @test */
    public function a_mobile_checkout_persists_with_a_null_storefront_id(): void
    {
        $store = $this->seedMobileStore('null-storefront-checkout');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->createCheckout($store, $cartToken)->assertCreated();

        $checkout = CommerceCheckout::withoutGlobalScopes()->firstOrFail();
        $this->assertNull($checkout->storefront_id);
        $this->assertSame($store['channel']->id, $checkout->sales_channel_id);
    }

    /** @test */
    public function a_web_checkout_persists_with_a_non_null_storefront_id(): void
    {
        $store = $this->seedWebStore('non-null-storefront-checkout');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);

        app(TenantContext::class)->set($store['tenant']->id);
        app(StorefrontContext::class)->set($store['tenant']->id, $store['channel']->id, $store['storefront']->id);
        $cart = app(CommerceCartService::class)->add(null, $product->id, 'base', 1);
        app(CommerceCheckoutService::class)->createOrResume($cart['token']);
        app(StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();

        $checkout = CommerceCheckout::withoutGlobalScopes()->firstOrFail();
        $this->assertNotNull($checkout->storefront_id);
        $this->assertSame($store['storefront']->id, $checkout->storefront_id);
    }

    // ── 4. invalid X-Cart-Token ──────────────────────────────────────────────

    /** @test */
    public function an_invalid_cart_token_is_treated_as_no_checkout_and_cleared(): void
    {
        $store = $this->seedMobileStore('invalid-token-checkout');

        $response = $this->getCheckout($store, 'not-a-real-token')
            ->assertOk()->assertJsonPath('data.status', null);
        $this->assertSame('', $response->headers->get(self::TOKEN_HEADER));

        $this->createCheckout($store, 'not-a-real-token')->assertStatus(404);
    }

    // ── 5. expired cart ──────────────────────────────────────────────────────

    /** @test */
    public function an_expired_cart_is_rejected_when_starting_checkout(): void
    {
        $store = $this->seedMobileStore('expired-cart-checkout');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);

        app(TenantContext::class)->set($store['tenant']->id);
        \App\Models\CommerceCart::query()->update(['expires_at' => now()->subMinute()]);
        app(TenantContext::class)->forget();

        $this->createCheckout($store, $cartToken)->assertStatus(404);
        $this->assertDatabaseCount('commerce_checkouts', 0);
    }

    // ── 6/19. cross-tenant checkout rejection / tenant isolation ───────────

    /** @test */
    public function a_checkout_created_under_one_tenant_is_invisible_to_a_different_tenant_context(): void
    {
        $a = $this->seedMobileStore('checkout-tenant-a');
        $b = $this->seedMobileStore('checkout-tenant-b');
        $productA = $this->publishedProduct($a['tenant'], $a['channel']);
        $cartTokenA = $this->cartTokenWithItem($a, $productA);
        $this->createCheckout($a, $cartTokenA)->assertCreated();

        // نفس التوكن، bearer المستأجر ب — يجب ألا يرى Checkout مستأجر أ إطلاقاً.
        $this->getCheckout($b, $cartTokenA)
            ->assertOk()->assertJsonPath('data.status', null);
        $this->patchContact($b, $cartTokenA, ['name' => 'x'])->assertStatus(404);

        app(TenantContext::class)->set($a['tenant']->id);
        $this->assertSame(1, CommerceCheckout::count());
        app(TenantContext::class)->forget();
    }

    // ── 7. cross-channel checkout rejection ─────────────────────────────────

    /** @test */
    public function a_checkout_is_invisible_across_a_different_sales_channel_for_the_same_tenant(): void
    {
        $store = $this->seedMobileStore('checkout-cross-channel');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->createCheckout($store, $cartToken)->assertCreated();

        app(TenantContext::class)->set($store['tenant']->id);
        $secondChannel = SalesChannel::create([
            'slug' => 'mobile-2', 'name' => 'تطبيق جوال ثانٍ', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($store['tenant']->id);
        app(StorefrontContext::class)->set($store['tenant']->id, $secondChannel->id);
        $lookup = app(CommerceCheckoutService::class)->current($cartToken);
        app(StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();

        $this->assertNull($lookup['checkout']);
    }

    // ── 8/9. web/mobile checkout isolation (both directions) ────────────────

    /** @test */
    public function a_mobile_cart_token_cannot_checkout_as_web_and_vice_versa(): void
    {
        $tenant = Tenant::create([
            'name' => 'متجر مزدوج دفع', 'slug' => 'dual-checkout-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $mobileChannel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'جوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);
        $webChannel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $webChannel->id, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $mobileClient = $this->service()->createClient($tenant, 'mobile-app', true);
        $mobileBearer = $this->service()->issueKey($mobileClient, 'default', [])->plainTextToken;
        $mobileProduct = $this->publishedProduct($tenant, $mobileChannel);
        $webProduct = $this->publishedProduct($tenant, $webChannel);
        $mobileStore = ['tenant' => $tenant, 'channel' => $mobileChannel, 'token' => $mobileBearer];

        $mobileCartToken = $this->cartTokenWithItem($mobileStore, $mobileProduct);
        $this->createCheckout($mobileStore, $mobileCartToken)->assertCreated();

        app(TenantContext::class)->set($tenant->id);
        app(StorefrontContext::class)->set($tenant->id, $webChannel->id, $storefront->id);
        $webCart = app(CommerceCartService::class)->add(null, $webProduct->id, 'base', 1);
        app(CommerceCheckoutService::class)->createOrResume($webCart['token']);
        $webCartToken = $webCart['token'];
        app(StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();

        // توكن سلة الجوال ضد سياق الويب (عبر الخدمة مباشرة).
        app(TenantContext::class)->set($tenant->id);
        app(StorefrontContext::class)->set($tenant->id, $webChannel->id, $storefront->id);
        $lookupMobileAsWeb = app(CommerceCheckoutService::class)->current($mobileCartToken);
        app(StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();
        $this->assertNull($lookupMobileAsWeb['checkout']);

        // توكن سلة الويب ضد /commerce/v1 (سياق الجوال).
        $webAsMobile = $this->getCheckout($mobileStore, $webCartToken)
            ->assertOk()->assertJsonPath('data.status', null);
        $this->assertSame('', $webAsMobile->headers->get(self::TOKEN_HEADER));
    }

    // ── 10. inactive Mobile SalesChannel ─────────────────────────────────────

    /** @test */
    public function an_inactive_mobile_channel_denies_checkout_access(): void
    {
        $store = $this->seedMobileStore('inactive-channel-checkout');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->createCheckout($store, $cartToken)->assertCreated();

        $store['channel']->update(['is_active' => false]);

        $this->getCheckout($store, $cartToken)->assertStatus(404);
    }

    // ── 11. invalid/inactive/unpublished product at completion ──────────────

    /** @test */
    public function completion_fails_review_required_when_a_line_becomes_unavailable(): void
    {
        $store = $this->seedMobileStore('completion-unavailable');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        app(TenantContext::class)->set($store['tenant']->id);
        $product->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $response = $this->complete($store, $cartToken, 'idem-unavail-001')->assertStatus(409);
        $response->assertJsonPath('error.code', 'review_required');
        $this->assertDatabaseCount('commerce_orders', 0);
    }

    // ── 12. Mobile SalesChannel pricing authoritative at completion ────────

    /** @test */
    public function completion_uses_the_mobile_channels_own_price_list(): void
    {
        $store = $this->seedMobileStore('completion-pricing');
        $product = $this->publishedProduct($store['tenant'], $store['channel'], ['sale_price' => 10000]);

        app(TenantContext::class)->set($store['tenant']->id);
        $priceList = PriceList::create(['name' => 'سعر الجوال', 'is_active' => true]);
        PriceListItem::create([
            'price_list_id' => $priceList->id, 'product_id' => $product->id,
            'unit_name' => $product->unit, 'price' => 6500,
        ]);
        $store['channel']->update(['default_price_list_id' => $priceList->id]);
        app(TenantContext::class)->forget();

        $cartToken = $this->fullyReadyCheckout($store, $product);

        $response = $this->complete($store, $cartToken, 'idem-pricing-001')->assertCreated();
        $response->assertJsonPath('data.order.total.amount_minor', 6500);
        $response->assertJsonPath('data.order.items.0.unit_price.amount_minor', 6500);
    }

    // ── 13. client cannot override tenant/channel/storefront ───────────────

    /** @test */
    public function client_supplied_context_fields_are_rejected_outright(): void
    {
        $store = $this->seedMobileStore('no-client-authority');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);

        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->postJson('/commerce/v1/checkout', [
                'tenant_id' => (string) Str::uuid(),
                'sales_channel_id' => (string) Str::uuid(),
                'storefront_id' => (string) Str::uuid(),
            ])->assertUnprocessable();

        $this->assertDatabaseCount('commerce_checkouts', 0);
    }

    // ── 14. no sensitive/cost field leakage ───────────────────────────────────

    /** @test */
    public function no_sensitive_or_cost_fields_leak_through_the_checkout_response(): void
    {
        $store = $this->seedMobileStore('checkout-no-leak');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);

        $response = $this->createCheckout($store, $cartToken)->assertCreated();
        $item = $response->json('data.cart.items.0');

        foreach (['avg_cost', 'purchase_price', 'quantity_on_hand', 'internal_notes', 'tags', 'min_sale_price', 'cost'] as $field) {
            $this->assertArrayNotHasKey($field, $item, "الحقل الحسّاس «{$field}» ظهر في استجابة Checkout.");
        }
    }

    // ── 15. duplicate/replay behavior (idempotency contract) ────────────────

    /** @test */
    public function completion_with_the_same_idempotency_key_replays_the_same_order(): void
    {
        $store = $this->seedMobileStore('completion-replay');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $first = $this->complete($store, $cartToken, 'idem-replay-001')->assertCreated();
        $second = $this->complete($store, $cartToken, 'idem-replay-001')->assertOk();

        $this->assertSame($first->json('data.order.id'), $second->json('data.order.id'));
        $second->assertJsonPath('data.replayed', true);
        $this->assertDatabaseCount('commerce_orders', 1);
    }

    /** @test */
    public function completion_with_a_different_idempotency_key_on_a_completed_checkout_conflicts(): void
    {
        $store = $this->seedMobileStore('completion-conflict');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $this->complete($store, $cartToken, 'idem-conflict-001')->assertCreated();
        $this->complete($store, $cartToken, 'idem-conflict-002')->assertStatus(409)
            ->assertJsonPath('error.code', 'idempotency_conflict');

        $this->assertDatabaseCount('commerce_orders', 1);
    }

    /** @test */
    public function completion_requires_an_idempotency_key(): void
    {
        $store = $this->seedMobileStore('completion-no-key');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $this->complete($store, $cartToken, null)->assertStatus(400)
            ->assertJsonPath('error.code', 'idempotency_key_required');
        $this->assertDatabaseCount('commerce_orders', 0);
    }

    /**
     * P1 (Codex review, PR #836) — closed by the Cart One-Shot Lifecycle
     * (owner decision: one CommerceCart backs at most one successful
     * CommerceOrder). `complete()` now moves the Cart to
     * `CommerceCart::STATUS_CONSUMED` in the same transaction that
     * completes the Checkout, so a second `POST checkout` on the same cart
     * token no longer resumes anything — the cart itself is no longer
     * `active`, so `CommerceCartService::findByToken()` treats it like any
     * other non-active cart and the request 404s with its token cleared.
     * `POST checkout/complete` keeps working via
     * `resolveForCompletion()`'s `allowConsumed: true` lookup, so
     * idempotency-key replay/conflict semantics are unaffected: no
     * `CommerceOrder` is ever created twice, and the original completed
     * order stays reachable by its own key.
     *
     * @test
     */
    public function a_second_post_checkout_after_completion_is_rejected_because_the_cart_is_consumed(): void
    {
        $store = $this->seedMobileStore('dup-order-guard');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $first = $this->complete($store, $cartToken, 'idem-guard-A')->assertCreated();
        $completedCheckoutId = CommerceCheckout::withoutGlobalScopes()->firstOrFail()->id;
        $this->assertDatabaseCount('commerce_checkouts', 1);
        $this->assertDatabaseCount('commerce_orders', 1);

        app(TenantContext::class)->set($store['tenant']->id);
        $this->assertSame(
            \App\Models\CommerceCart::STATUS_CONSUMED,
            \App\Models\CommerceCart::withoutGlobalScopes()->firstOrFail()->status,
        );
        app(TenantContext::class)->forget();

        // نفس توكن السلة — السلة استُهلكت الآن، فلا POST checkout يفتح دورةً جديدة.
        $this->createCheckout($store, $cartToken)->assertStatus(404);
        $this->assertDatabaseCount('commerce_checkouts', 1);

        app(TenantContext::class)->set($store['tenant']->id);
        $this->assertSame($completedCheckoutId, CommerceCheckout::withoutGlobalScopes()->firstOrFail()->id);
        app(TenantContext::class)->forget();

        // إتمام لاحق بمفتاح مختلف يدخل مسار replayOrConflict الآمن أصلاً — تعارض 409، لا طلب ثانٍ.
        $this->complete($store, $cartToken, 'idem-guard-B')->assertStatus(409)
            ->assertJsonPath('error.code', 'idempotency_conflict');

        // ونفس المفتاح الأصلي يُعيد نفس الطلب (replay)، لا طلباً ثانياً — رغم أن السلة استُهلكت.
        $replay = $this->complete($store, $cartToken, 'idem-guard-A')->assertOk();
        $replay->assertJsonPath('data.replayed', true);
        $this->assertSame($first->json('data.order.id'), $replay->json('data.order.id'));

        $this->assertDatabaseCount('commerce_checkouts', 1);
        $this->assertDatabaseCount('commerce_orders', 1);
    }

    // ── boundary: no accounting/inventory side effects ──────────────────────

    /** @test */
    public function no_accounting_or_inventory_side_effects_are_created_by_checkout_foundation(): void
    {
        $store = $this->seedMobileStore('checkout-no-side-effects');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->createCheckout($store, $cartToken)->assertCreated();
        $this->patchContact($store, $cartToken, ['name' => 'x', 'phone' => 'y'])->assertOk();
        $this->patchAddress($store, $cartToken, ['country' => 'SA', 'city' => 'x', 'street' => 'y'])->assertOk();
        $this->patchDelivery($store, $cartToken, ['method' => 'pickup'])->assertOk();

        $this->assertSame(0, \Illuminate\Support\Facades\DB::table('journal_entries')->count());
        $this->assertSame(0, \Illuminate\Support\Facades\DB::table('journal_lines')->count());
        $this->assertSame(0, \Illuminate\Support\Facades\DB::table('stock_movements')->count());
        $this->assertDatabaseCount('commerce_orders', 0);
    }

    /** @test */
    public function a_tenant_with_no_mobile_channel_is_denied_checkout(): void
    {
        $tenant = Tenant::create([
            'name' => 'بلا قناة دفع', 'slug' => 'no-channel-checkout-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        $client = $this->service()->createClient($tenant, 'mobile-app', true);
        $token = $this->service()->issueKey($client, 'default', [])->plainTextToken;

        $this->withHeaders($this->bearer($token))->getJson('/commerce/v1/checkout')->assertStatus(404);
    }

    // ── COM-MOBILE-ADDRESSES-1 (ADR-08) — building_no/additional_number ────
    // gap closure: these were never collectible at checkout at all, even
    // though CommerceOrderSnapshot already had a shipping_building_no column
    // no code path populated. Both are purely additive/optional — guest
    // checkout without them stays exactly as it already worked (see the
    // untouched `readyCheckout()`/`no_accounting_or_inventory_side_effects...`
    // tests above, which never send either field).

    /** @test */
    public function checkout_address_accepts_building_no_and_additional_number(): void
    {
        $store = $this->seedMobileStore('address-building-no');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->createCheckout($store, $cartToken)->assertCreated();

        $response = $this->patchAddress($store, $cartToken, [
            'country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ',
            'street' => 'شارع الملك فهد', 'building_no' => '1234', 'additional_number' => '5678',
            'postal_code' => '31411',
        ])->assertOk();

        $this->assertSame('1234', $response->json('data.delivery.address.building_no'));
        $this->assertSame('5678', $response->json('data.delivery.address.additional_number'));

        app(TenantContext::class)->set($store['tenant']->id);
        $checkout = CommerceCheckout::withoutGlobalScopes()->firstOrFail();
        $this->assertSame('1234', $checkout->delivery_building_no);
        $this->assertSame('5678', $checkout->delivery_additional_number);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function completion_propagates_building_no_and_additional_number_into_the_order_snapshot(): void
    {
        $store = $this->seedMobileStore('snapshot-building-no');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->cartTokenWithItem($store, $product);
        $this->createCheckout($store, $cartToken)->assertCreated();

        $this->patchContact($store, $cartToken, [
            'name' => 'سالم الأحمدي', 'phone' => '0501234567', 'email' => 'salem@example.com',
        ])->assertOk();
        $this->patchAddress($store, $cartToken, [
            'country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ',
            'street' => 'شارع الملك فهد', 'building_no' => '1234', 'additional_number' => '5678',
            'postal_code' => '31411',
        ])->assertOk();
        $this->patchDelivery($store, $cartToken, ['method' => 'pickup'])->assertOk();

        $response = $this->complete($store, $cartToken, 'idem-snapshot-building-no')->assertCreated();
        $orderId = $response->json('data.order.id');

        app(TenantContext::class)->set($store['tenant']->id);
        $snapshot = \App\Models\CommerceOrderSnapshot::withoutGlobalScopes()
            ->where('commerce_order_id', $orderId)->firstOrFail();
        $this->assertSame('1234', $snapshot->shipping_building_no);
        $this->assertSame('5678', $snapshot->shipping_additional_number);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function completion_without_building_no_or_additional_number_leaves_them_null_in_the_snapshot(): void
    {
        $store = $this->seedMobileStore('snapshot-no-building-no');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->fullyReadyCheckout($store, $product);

        $response = $this->complete($store, $cartToken, 'idem-snapshot-no-building-no')->assertCreated();
        $orderId = $response->json('data.order.id');

        app(TenantContext::class)->set($store['tenant']->id);
        $snapshot = \App\Models\CommerceOrderSnapshot::withoutGlobalScopes()
            ->where('commerce_order_id', $orderId)->firstOrFail();
        $this->assertNull($snapshot->shipping_building_no);
        $this->assertNull($snapshot->shipping_additional_number);
        app(TenantContext::class)->forget();
    }
}
