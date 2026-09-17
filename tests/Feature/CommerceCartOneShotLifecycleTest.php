<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceCheckout;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
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
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Cart One-Shot Lifecycle (PR #836 follow-up)
 * ═══════════════════════════════════════════════════════════════
 * Owner decision: one `CommerceCart` backs at most one successful
 * `CommerceOrder`. `active → checkout → successful CommerceOrder →
 * consumed`. A subsequent purchase always requires a brand-new Cart and
 * Cart Token — a consumed Cart is never reopened, mutated, or reused to
 * start another Checkout. Shared between `/store/v1` (web) and
 * `/commerce/v1` (mobile) because the invariant lives in
 * `CommerceCartService`/`CommerceCheckoutService`, consumed by both
 * controllers identically.
 *
 * تشغيل: php artisan test --filter=CommerceCartOneShotLifecycleTest
 */
class CommerceCartOneShotLifecycleTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const MOBILE_HEADER = 'X-Cart-Token';

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

    /**
     * `withHeaders()` merges into PHPUnit's per-test `$defaultHeaders` and
     * that merge **persists across requests within the same test** — so the
     * `X-Cart-Token` header must always be set explicitly (empty string when
     * none is intended), never omitted, or a later request would silently
     * keep carrying an earlier test's cart token.
     */
    private function mobileHeaders(string $bearerToken, ?string $cartToken = null): array
    {
        return $this->bearer($bearerToken) + [self::MOBILE_HEADER => $cartToken ?? ''];
    }

    private function mobileCartTokenWithItem(array $store, Product $product, int $quantity = 1): string
    {
        $response = $this->withHeaders($this->mobileHeaders($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => $quantity])
            ->assertCreated();

        return $response->headers->get(self::MOBILE_HEADER);
    }

    private function mobileCreateCheckout(array $store, ?string $cartToken): TestResponse
    {
        return $this->withHeaders($this->mobileHeaders($store['token'], $cartToken))
            ->postJson('/commerce/v1/checkout', []);
    }

    private function mobileReadyCheckout(array $store, string $cartToken): void
    {
        $this->withHeaders($this->mobileHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/contact', ['name' => 'سالم', 'phone' => '0501234567'])
            ->assertOk();
        $this->withHeaders($this->mobileHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/address', ['country' => 'SA', 'city' => 'الدمام', 'street' => 'شارع الملك فهد'])
            ->assertOk();
        $this->withHeaders($this->mobileHeaders($store['token'], $cartToken))
            ->patchJson('/commerce/v1/checkout/delivery', ['method' => 'pickup'])
            ->assertOk();
    }

    /** يضيف صنفاً، يفتح Checkout، يملأ بياناته — يعيد raw cart token جاهزاً للإتمام. */
    private function mobileFullyReadyCheckout(array $store, Product $product): string
    {
        $cartToken = $this->mobileCartTokenWithItem($store, $product);
        $this->mobileCreateCheckout($store, $cartToken)->assertCreated();
        $this->mobileReadyCheckout($store, $cartToken);

        return $cartToken;
    }

    private function mobileComplete(array $store, string $cartToken, ?string $idempotencyKey): TestResponse
    {
        $headers = $this->mobileHeaders($store['token'], $cartToken);
        if ($idempotencyKey !== null) {
            $headers['Idempotency-Key'] = $idempotencyKey;
        }

        return $this->withHeaders($headers)->postJson('/commerce/v1/checkout/complete', []);
    }

    private function cartFor(Tenant $tenant, string $token): CommerceCart
    {
        app(TenantContext::class)->set($tenant->id);
        $cart = CommerceCart::query()
            ->where('token_hash', hash('sha256', $token))
            ->withoutGlobalScopes()
            ->firstOrFail();
        app(TenantContext::class)->forget();

        return $cart;
    }

    // ── 1/2. new Cart starts active, active Cart can create Checkout ───────

    #[Test]
    public function a_new_cart_starts_active_and_can_create_a_checkout(): void
    {
        $store = $this->seedMobileStore('lifecycle-new-cart');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->mobileCartTokenWithItem($store, $product);

        $cart = $this->cartFor($store['tenant'], $cartToken);
        $this->assertSame(CommerceCart::STATUS_ACTIVE, $cart->status);

        $this->mobileCreateCheckout($store, $cartToken)->assertCreated();
    }

    // ── 3/4/5. successful completion: one Order, Checkout completed, Cart consumed ──

    #[Test]
    public function successful_completion_creates_one_order_marks_checkout_completed_and_cart_consumed(): void
    {
        $store = $this->seedMobileStore('lifecycle-success');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->mobileFullyReadyCheckout($store, $product);

        $this->mobileComplete($store, $cartToken, 'lifecycle-success-key')->assertCreated();

        $this->assertSame(1, CommerceOrder::withoutGlobalScopes()->count());

        app(TenantContext::class)->set($store['tenant']->id);
        $checkout = CommerceCheckout::withoutGlobalScopes()->firstOrFail();
        $this->assertSame(CommerceCheckout::STATUS_COMPLETED, $checkout->status);
        app(TenantContext::class)->forget();

        $cart = $this->cartFor($store['tenant'], $cartToken);
        $this->assertSame(CommerceCart::STATUS_CONSUMED, $cart->status);
    }

    // ── 6. atomicity: a failed completion leaves Order/Checkout/Cart untouched ──

    #[Test]
    public function a_completion_that_fails_review_leaves_order_checkout_and_cart_untouched(): void
    {
        $store = $this->seedMobileStore('lifecycle-atomic');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->mobileCartTokenWithItem($store, $product);
        $this->mobileCreateCheckout($store, $cartToken)->assertCreated();
        // Deliberately incomplete: no contact/delivery filled in, so complete() must
        // throw CheckoutReviewRequiredException before ever creating anything.

        $this->mobileComplete($store, $cartToken, 'lifecycle-atomic-key')->assertStatus(409);

        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());

        app(TenantContext::class)->set($store['tenant']->id);
        $checkout = CommerceCheckout::withoutGlobalScopes()->firstOrFail();
        $this->assertTrue($checkout->isOpen());
        app(TenantContext::class)->forget();

        $cart = $this->cartFor($store['tenant'], $cartToken);
        $this->assertSame(CommerceCart::STATUS_ACTIVE, $cart->status);
    }

    // ── 7/8/9. consumed Cart rejects mutations ──────────────────────────────

    #[Test]
    public function a_consumed_cart_rejects_add_update_and_remove(): void
    {
        $store = $this->seedMobileStore('lifecycle-mutations');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->mobileFullyReadyCheckout($store, $product);
        $this->mobileComplete($store, $cartToken, 'lifecycle-mutations-key')->assertCreated();

        $cart = $this->cartFor($store['tenant'], $cartToken);
        app(TenantContext::class)->set($store['tenant']->id);
        $itemId = $cart->items()->withoutGlobalScopes()->first()->id;
        app(TenantContext::class)->forget();

        // add
        $this->withHeaders($this->mobileHeaders($store['token'], $cartToken))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertStatus(404);

        // update
        $this->withHeaders($this->mobileHeaders($store['token'], $cartToken))
            ->patchJson("/commerce/v1/cart/items/{$itemId}", ['quantity' => 2])
            ->assertStatus(404);

        // remove
        $this->withHeaders($this->mobileHeaders($store['token'], $cartToken))
            ->deleteJson("/commerce/v1/cart/items/{$itemId}")
            ->assertStatus(404);

        // السلة لم تُلمَس البتة.
        app(TenantContext::class)->set($store['tenant']->id);
        $this->assertSame(1, $cart->items()->withoutGlobalScopes()->count());
        $this->assertSame(1, $cart->fresh()->items()->withoutGlobalScopes()->first()->quantity);
        app(TenantContext::class)->forget();
    }

    // ── 10/11. consumed Cart cannot create a new Checkout / second Order ───

    #[Test]
    public function a_consumed_cart_cannot_start_a_new_checkout_or_produce_a_second_order(): void
    {
        $store = $this->seedMobileStore('lifecycle-no-second-order');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->mobileFullyReadyCheckout($store, $product);
        $this->mobileComplete($store, $cartToken, 'lifecycle-no-second-key')->assertCreated();

        $this->mobileCreateCheckout($store, $cartToken)->assertStatus(404);
        $this->assertSame(1, CommerceCheckout::withoutGlobalScopes()->count());
        $this->assertSame(1, CommerceOrder::withoutGlobalScopes()->count());
    }

    // ── 12/13. replay/conflict semantics survive consumption ───────────────

    #[Test]
    public function the_same_completion_key_replays_correctly_after_consumption_and_a_different_key_still_conflicts(): void
    {
        $store = $this->seedMobileStore('lifecycle-replay');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->mobileFullyReadyCheckout($store, $product);

        $first = $this->mobileComplete($store, $cartToken, 'lifecycle-replay-key')->assertCreated();

        $replay = $this->mobileComplete($store, $cartToken, 'lifecycle-replay-key')->assertOk();
        $replay->assertJsonPath('data.replayed', true);
        $this->assertSame($first->json('data.order.id'), $replay->json('data.order.id'));

        $this->mobileComplete($store, $cartToken, 'lifecycle-different-key')->assertStatus(409)
            ->assertJsonPath('error.code', 'idempotency_conflict');

        $this->assertSame(1, CommerceOrder::withoutGlobalScopes()->count());
    }

    // ── P2-1 review follow-up: consumed Cart replay still respects its own expiry ──

    /**
     * `consumed` is terminal but not "never expires" — `findByToken(...,
     * allowConsumed: true)` must still honor the Cart's own `expires_at`
     * bearer lifetime, not just its status. Replay within that window keeps
     * working exactly as before.
     */
    #[Test]
    public function a_consumed_cart_can_replay_the_completed_order_before_its_token_expires(): void
    {
        $store = $this->seedMobileStore('lifecycle-expiry-before');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->mobileFullyReadyCheckout($store, $product);

        $first = $this->mobileComplete($store, $cartToken, 'lifecycle-expiry-before-key')->assertCreated();
        $replay = $this->mobileComplete($store, $cartToken, 'lifecycle-expiry-before-key')->assertOk();
        $replay->assertJsonPath('data.replayed', true);
        $this->assertSame($first->json('data.order.id'), $replay->json('data.order.id'));
    }

    /**
     * Once a consumed Cart's own `expires_at` has passed, its token must fail
     * closed on resolution (404, cleared token) — even for a replay of the
     * exact original `Idempotency-Key` — and the Cart's `status` must stay
     * `consumed` (never silently rewritten to `expired` by this check, unlike
     * the `active` branch's own lazy demotion).
     */
    #[Test]
    public function a_consumed_cart_cannot_resolve_through_its_token_after_expiry_and_status_stays_consumed(): void
    {
        $store = $this->seedMobileStore('lifecycle-expiry-after');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->mobileFullyReadyCheckout($store, $product);
        $this->mobileComplete($store, $cartToken, 'lifecycle-expiry-after-key')->assertCreated();

        $cart = $this->cartFor($store['tenant'], $cartToken);
        app(TenantContext::class)->set($store['tenant']->id);
        $cart->update(['expires_at' => now()->subMinute()]);
        app(TenantContext::class)->forget();

        $this->mobileComplete($store, $cartToken, 'lifecycle-expiry-after-key')->assertStatus(404);

        $this->assertSame(CommerceCart::STATUS_CONSUMED, $cart->fresh()->status);
    }

    /** Web parity: the same expiry boundary applies through `/store/v1`'s shared services. */
    #[Test]
    public function the_web_path_enforces_the_same_consumed_cart_expiry_boundary(): void
    {
        $store = $this->seedWebStore('lifecycle-expiry-web');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);

        app(TenantContext::class)->set($store['tenant']->id);
        app(StorefrontContext::class)->set($store['tenant']->id, $store['channel']->id, $store['storefront']->id);
        $cart = app(CommerceCartService::class)->add(null, $product->id, 'base', 1);
        $rawToken = $cart['token'];
        $created = app(CommerceCheckoutService::class)->createOrResume($rawToken);
        app(CommerceCheckoutService::class)->updateContact($created['checkout'], ['contact_name' => 'ويب', 'contact_phone' => '0501234567']);
        app(CommerceCheckoutService::class)->updateAddress($created['checkout'], ['delivery_country' => 'SA', 'delivery_city' => 'الرياض', 'delivery_street' => 'شارع']);
        app(CommerceCheckoutService::class)->updateDelivery($created['checkout'], 'pickup');
        app(CommerceCheckoutService::class)->complete($created['checkout'], hash('sha256', 'web-expiry-key'), 'fp-web-expiry');
        app(StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();

        $cartRow = $this->cartFor($store['tenant'], $rawToken);
        app(TenantContext::class)->set($store['tenant']->id);
        $cartRow->update(['expires_at' => now()->subMinute()]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($store['tenant']->id);
        app(StorefrontContext::class)->set($store['tenant']->id, $store['channel']->id, $store['storefront']->id);
        $lookup = app(CommerceCartService::class)->findByToken($rawToken, allowConsumed: true);
        app(StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();

        $this->assertTrue($lookup['invalid']);
        $this->assertNull($lookup['cart']);
        $this->assertSame(CommerceCart::STATUS_CONSUMED, $cartRow->fresh()->status);
    }

    // ── P2-2 review follow-up: consumed-cart replay resolves the order-linked Checkout ──

    /**
     * Historical shape possible before this PR's fixes: a Cart with a real
     * completed Checkout (linked to a `CommerceOrder`) *and* a later, still-
     * open Checkout — the exact shape `createOrResume()`'s original bug could
     * leave behind before it was fixed. `resolveForCompletion()` must resolve
     * the order-linked Checkout for a `consumed` Cart's replay, never the
     * merely-newer open one — otherwise the original `Idempotency-Key` 404s
     * instead of replaying the real order.
     */
    #[Test]
    public function a_consumed_cart_with_a_later_open_checkout_still_replays_through_the_order_linked_checkout(): void
    {
        $store = $this->seedMobileStore('lifecycle-replay-resolution');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $cartToken = $this->mobileFullyReadyCheckout($store, $product);

        $first = $this->mobileComplete($store, $cartToken, 'lifecycle-replay-resolution-key')->assertCreated();
        $orderId = $first->json('data.order.id');

        $cart = $this->cartFor($store['tenant'], $cartToken);
        app(TenantContext::class)->set($store['tenant']->id);
        $this->assertSame(CommerceCart::STATUS_CONSUMED, $cart->fresh()->status);

        // Simulate the historical pre-fix shape directly — never reachable
        // through the current API (createOrResume() blocks it on a consumed
        // Cart), but real historical rows written before this fix could
        // carry exactly this shape.
        $laterCheckout = CommerceCheckout::create([
            'storefront_id' => null,
            'sales_channel_id' => $store['channel']->id,
            'cart_id' => $cart->id,
            'status' => CommerceCheckout::STATUS_ACTIVE,
            'expires_at' => now()->addHour(),
        ]);
        app(TenantContext::class)->forget();

        // Replay with the ORIGINAL idempotency key must still resolve the
        // real, order-linked Checkout — not the newer open one — and return
        // the same order, never a 404 and never a second order.
        $replay = $this->mobileComplete($store, $cartToken, 'lifecycle-replay-resolution-key')->assertOk();
        $replay->assertJsonPath('data.replayed', true);
        $this->assertSame($orderId, $replay->json('data.order.id'));

        $this->assertSame(1, CommerceOrder::withoutGlobalScopes()->count());
        $this->assertSame(2, CommerceCheckout::withoutGlobalScopes()->where('cart_id', $cart->id)->count());

        app(TenantContext::class)->set($store['tenant']->id);
        $this->assertSame(CommerceCheckout::STATUS_ACTIVE, $laterCheckout->fresh()->status);
        app(TenantContext::class)->forget();
    }

    // ── 14/15. old token cannot start a new purchase; a new Cart/token can ──

    #[Test]
    public function the_old_cart_token_cannot_start_a_new_purchase_but_a_new_cart_token_can(): void
    {
        $store = $this->seedMobileStore('lifecycle-purchase-again');
        $productA = $this->publishedProduct($store['tenant'], $store['channel'], ['sku' => 'SKU-A-'.Str::random(6)]);
        $productB = $this->publishedProduct($store['tenant'], $store['channel'], ['sku' => 'SKU-B-'.Str::random(6)]);

        $tokenA = $this->mobileFullyReadyCheckout($store, $productA);
        $orderA = $this->mobileComplete($store, $tokenA, 'lifecycle-purchase-again-A')->assertCreated();

        // نفس توكن السلة A — لا يجوز أن يبدأ شراءً جديداً بأي شكل.
        $this->withHeaders($this->mobileHeaders($store['token'], $tokenA))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $productB->id, 'quantity' => 1])
            ->assertStatus(404);
        $this->mobileCreateCheckout($store, $tokenA)->assertStatus(404);

        // توكن سلة B جديد تماماً — شراءٌ ثانٍ حقيقي، مستقل تماماً عن A.
        $tokenB = $this->mobileFullyReadyCheckout($store, $productB);
        $this->assertNotSame($tokenA, $tokenB);
        $orderB = $this->mobileComplete($store, $tokenB, 'lifecycle-purchase-again-B')->assertCreated();

        $this->assertNotSame($orderA->json('data.order.id'), $orderB->json('data.order.id'));
        $this->assertSame(2, CommerceOrder::withoutGlobalScopes()->count());
        $this->assertSame(2, CommerceCheckout::withoutGlobalScopes()->count());

        app(TenantContext::class)->set($store['tenant']->id);
        $orderBRow = CommerceOrder::withoutGlobalScopes()->findOrFail($orderB->json('data.order.id'));
        $cartB = $this->cartFor($store['tenant'], $tokenB);
        $this->assertSame($cartB->id, $orderBRow->checkout->cart_id);
        app(TenantContext::class)->forget();
    }

    // ── 16. Web behavior remains correct (full lifecycle via /store/v1) ────

    #[Test]
    public function the_full_lifecycle_holds_identically_for_the_web_storefront_path(): void
    {
        $store = $this->seedWebStore('lifecycle-web');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);

        app(TenantContext::class)->set($store['tenant']->id);
        app(StorefrontContext::class)->set($store['tenant']->id, $store['channel']->id, $store['storefront']->id);
        $cart = app(CommerceCartService::class)->add(null, $product->id, 'base', 1);
        $rawToken = $cart['token'];
        $created = app(CommerceCheckoutService::class)->createOrResume($rawToken);
        app(CommerceCheckoutService::class)->updateContact($created['checkout'], ['contact_name' => 'ويب', 'contact_phone' => '0501234567']);
        app(CommerceCheckoutService::class)->updateAddress($created['checkout'], ['delivery_country' => 'SA', 'delivery_city' => 'الرياض', 'delivery_street' => 'شارع']);
        app(CommerceCheckoutService::class)->updateDelivery($created['checkout'], 'pickup');
        $result = app(CommerceCheckoutService::class)->complete($created['checkout'], hash('sha256', 'web-key'), 'fp-web');
        app(StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();

        $this->assertFalse($result['replayed']);
        $this->assertSame(1, CommerceOrder::withoutGlobalScopes()->count());

        $cartRow = $this->cartFor($store['tenant'], $rawToken);
        $this->assertSame(CommerceCart::STATUS_CONSUMED, $cartRow->status);

        // نفس توكن السلة لا يبدأ شراءً جديداً على الويب أيضاً.
        app(TenantContext::class)->set($store['tenant']->id);
        app(StorefrontContext::class)->set($store['tenant']->id, $store['channel']->id, $store['storefront']->id);
        $lookup = app(CommerceCartService::class)->findByToken($rawToken);
        app(StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();
        $this->assertTrue($lookup['invalid']);
        $this->assertNull($lookup['cart']);
    }

    // ── 18/19/20. isolation: a consumed cart's token does not leak across tenant/channel/web-mobile ──

    #[Test]
    public function a_consumed_carts_token_stays_isolated_across_tenant_channel_and_web_mobile_boundaries(): void
    {
        $storeA = $this->seedMobileStore('lifecycle-isolation-a');
        $storeB = $this->seedMobileStore('lifecycle-isolation-b');
        $productA = $this->publishedProduct($storeA['tenant'], $storeA['channel']);
        $tokenA = $this->mobileFullyReadyCheckout($storeA, $productA);
        $this->mobileComplete($storeA, $tokenA, 'lifecycle-isolation-key')->assertCreated();

        // نفس التوكن تحت مستأجرٍ آخر تماماً — غير مرئي إطلاقاً، لا حتى كسلةٍ مستهلَكة.
        $this->withHeaders($this->mobileHeaders($storeB['token'], $tokenA))
            ->postJson('/commerce/v1/checkout', [])
            ->assertStatus(404);

        // نفس المستأجر، قناة جوّال ثانية — التوكن مرتبطٌ بالقناة الأولى فقط.
        app(TenantContext::class)->set($storeA['tenant']->id);
        $secondChannel = SalesChannel::create([
            'slug' => 'mobile-2', 'name' => 'تطبيق جوال ثانٍ', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($storeA['tenant']->id);
        app(StorefrontContext::class)->set($storeA['tenant']->id, $secondChannel->id);
        $lookup = app(CommerceCartService::class)->findByToken($tokenA, allowConsumed: true);
        app(StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();
        $this->assertTrue($lookup['invalid']);

        // الويب لا يرى توكن سلة الجوال المستهلَكة أبداً (X-Cart-Token مستقل عن كوكي الويب أصلاً).
        app(TenantContext::class)->set($storeA['tenant']->id);
        $webChannel = SalesChannel::create([
            'slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $webStorefront = Storefront::create([
            'slug' => 'main-2', 'name' => 'Main 2', 'sales_channel_id' => $webChannel->id, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($storeA['tenant']->id);
        app(StorefrontContext::class)->set($storeA['tenant']->id, $webChannel->id, $webStorefront->id);
        $webLookup = app(CommerceCartService::class)->findByToken($tokenA, allowConsumed: true);
        app(StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();
        $this->assertTrue($webLookup['invalid']);
    }
}
