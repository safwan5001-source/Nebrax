<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceCheckout;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Models\Warehouse;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\PriceListService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * COM-CHECKOUT-1B — إتمامٌ idempotent: revalidation نهائي، إنشاء CommerceOrder
 * واحد بالضبط، وحدود المخزون/الدفع/الفاتورة. يبني على ثوابت
 * StorefrontCheckoutApiTest (COM-CHECKOUT-1A) بنفس أنماط الثقة والعزل.
 */
class StorefrontCheckoutCompletionApiTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'checkout-gateway-secret';

    /** @return array{tenant: Tenant, channel: SalesChannel, storefront: Storefront, domain: StorefrontDomain} */
    private function store(string $host, string $currency = 'SAR'): array
    {
        $tenant = Tenant::create([
            'name' => $host, 'slug' => 'checkout-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => $currency, 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $host,
            'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return compact('tenant', 'channel', 'storefront', 'domain');
    }

    private function product(Tenant $tenant, SalesChannel $channel, array $attributes = [], bool $published = true): Product
    {
        app(TenantContext::class)->set($tenant->id);
        $product = Product::create(array_merge([
            'name' => 'Checkout completion product', 'sku' => 'CHKC-'.Str::random(8),
            'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true,
        ], $attributes));
        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => $published,
        ]);
        app(TenantContext::class)->forget();

        return $product;
    }

    private function mutationHeaders(string $host, string $secret = self::SECRET): array
    {
        config(['storefront.gateway_secret' => self::SECRET]);

        return [
            'X-Storefront-Forwarded-Host' => $host,
            'X-Storefront-Gateway-Secret' => $secret,
        ];
    }

    /** Adds one item to a fresh cart on $host and returns the raw awj_cart_token. */
    private function cartTokenWithItem(string $host, Product $product, int $quantity = 1, string $unitKey = 'base'): string
    {
        config(['storefront.gateway_secret' => self::SECRET]);
        $response = $this->withHeaders($this->mutationHeaders($host))
            ->postJson('http://laravel-internal.test/store/v1/cart/items', [
                'product_id' => $product->id, 'quantity' => $quantity, 'unit_key' => $unitKey,
            ])->assertCreated();

        return $response->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
    }

    private function createCheckout(string $host, ?string $token): TestResponse
    {
        $test = $this->withHeaders($this->mutationHeaders($host))->withCredentials();
        if ($token !== null) {
            $test = $test->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token);
        }

        return $test->postJson('http://laravel-internal.test/store/v1/checkout', []);
    }

    /** Fills contact/address/delivery so the checkout is ready for completion. */
    private function readyCheckout(string $host, string $token): void
    {
        $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->patchJson('http://laravel-internal.test/store/v1/checkout/contact', [
                'name' => 'سالم الأحمدي', 'phone' => '0501234567', 'email' => 'salem@example.com',
            ])->assertOk();

        $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->patchJson('http://laravel-internal.test/store/v1/checkout/address', [
                'country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ',
                'street' => 'شارع الملك فهد', 'postal_code' => '31411',
            ])->assertOk();

        $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->patchJson('http://laravel-internal.test/store/v1/checkout/delivery', ['method' => 'pickup'])
            ->assertOk();
    }

    private function complete(string $host, string $token, ?string $idempotencyKey): TestResponse
    {
        $test = $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token);
        if ($idempotencyKey !== null) {
            $test = $test->withHeaders(['Idempotency-Key' => $idempotencyKey]);
        }

        return $test->postJson('http://laravel-internal.test/store/v1/checkout/complete', []);
    }

    /** Full flow: store + product + cart + checkout + ready, returns the raw cart token. */
    private function fullyReadyCheckout(string $host, Tenant $tenant, SalesChannel $channel, Product $product): string
    {
        $token = $this->cartTokenWithItem($host, $product);
        $this->createCheckout($host, $token)->assertCreated();
        $this->readyCheckout($host, $token);

        return $token;
    }

    /** @test */
    public function a_guest_completion_creates_exactly_one_commerce_order(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-ok.test');
        $product = $this->product($tenant, $channel);
        $token = $this->fullyReadyCheckout('checkout-complete-ok.test', $tenant, $channel, $product);

        $response = $this->complete('checkout-complete-ok.test', $token, 'idem-key-001')->assertCreated();

        $response->assertJsonPath('data.replayed', false);
        $response->assertJsonPath('data.order.status', CommerceOrder::STATUS_CONFIRMED);
        $response->assertJsonPath('data.order.items.0.product_id', $product->id);
        $response->assertJsonPath('data.order.total.amount_minor', 5000);
        $this->assertDatabaseCount('commerce_orders', 1);

        app(TenantContext::class)->set($tenant->id);
        $order = CommerceOrder::firstOrFail();
        $this->assertTrue($order->isConfirmed());
        $this->assertTrue($order->originatesFromCheckout());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function the_order_is_correctly_linked_to_checkout_storefront_and_sales_channel(): void
    {
        ['tenant' => $tenant, 'channel' => $channel, 'storefront' => $storefront] = $this->store('checkout-complete-link.test');
        $product = $this->product($tenant, $channel);
        $token = $this->fullyReadyCheckout('checkout-complete-link.test', $tenant, $channel, $product);
        $this->complete('checkout-complete-link.test', $token, 'idem-key-link')->assertCreated();

        app(TenantContext::class)->set($tenant->id);
        $checkout = CommerceCheckout::firstOrFail();
        $order = CommerceOrder::firstOrFail();
        $this->assertSame($tenant->id, $order->tenant_id);
        $this->assertSame($storefront->id, $order->storefront_id);
        $this->assertSame($channel->id, $order->sales_channel_id);
        $this->assertSame($checkout->id, $order->commerce_checkout_id);
        $this->assertSame(CommerceCheckout::STATUS_COMPLETED, $checkout->fresh()->status);
        $this->assertNull($order->partner_id);
        $this->assertNull($order->customer_identity_id);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function the_order_carries_the_correct_contact_and_delivery_snapshots(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-snap.test');
        $product = $this->product($tenant, $channel);
        $token = $this->fullyReadyCheckout('checkout-complete-snap.test', $tenant, $channel, $product);
        $response = $this->complete('checkout-complete-snap.test', $token, 'idem-key-snap')->assertCreated();

        $response->assertJsonPath('data.order.delivery_method', 'pickup');
        $response->assertJsonPath('data.order.contact.name', 'سالم الأحمدي');
        $response->assertJsonPath('data.order.contact.phone', '0501234567');
        $response->assertJsonPath('data.order.delivery.city', 'الدمام');
        $response->assertJsonPath('data.order.delivery.street', 'شارع الملك فهد');

        app(TenantContext::class)->set($tenant->id);
        $order = CommerceOrder::with('snapshot')->firstOrFail();
        $this->assertSame('سالم الأحمدي', $order->snapshot->customer_name);
        $this->assertSame('الدمام', $order->snapshot->shipping_city);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function completion_without_an_idempotency_key_is_rejected(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-noidem.test');
        $product = $this->product($tenant, $channel);
        $token = $this->fullyReadyCheckout('checkout-complete-noidem.test', $tenant, $channel, $product);

        $this->complete('checkout-complete-noidem.test', $token, null)
            ->assertStatus(400)
            ->assertJsonPath('error.code', 'idempotency_key_required');

        $this->assertDatabaseCount('commerce_orders', 0);
    }

    /** @test */
    public function replaying_the_same_idempotency_key_returns_the_same_order_without_duplicating_it(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-replay.test');
        $product = $this->product($tenant, $channel);
        $token = $this->fullyReadyCheckout('checkout-complete-replay.test', $tenant, $channel, $product);

        $first = $this->complete('checkout-complete-replay.test', $token, 'idem-key-replay')->assertCreated();
        $second = $this->complete('checkout-complete-replay.test', $token, 'idem-key-replay')->assertOk();

        $this->assertSame($first->json('data.order.id'), $second->json('data.order.id'));
        $this->assertFalse($first->json('data.replayed'));
        $this->assertTrue($second->json('data.replayed'));
        $this->assertDatabaseCount('commerce_orders', 1);
    }

    /** @test */
    public function a_different_idempotency_key_after_completion_never_creates_a_second_order(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-conflict.test');
        $product = $this->product($tenant, $channel);
        $token = $this->fullyReadyCheckout('checkout-complete-conflict.test', $tenant, $channel, $product);

        $this->complete('checkout-complete-conflict.test', $token, 'idem-key-first')->assertCreated();
        $this->complete('checkout-complete-conflict.test', $token, 'idem-key-second')
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'idempotency_conflict');

        $this->assertDatabaseCount('commerce_orders', 1);
    }

    /**
     * P1 (Codex review, PR #836) — closed by the Cart One-Shot Lifecycle
     * (owner decision: one CommerceCart backs at most one successful
     * CommerceOrder), on the web path too — `CommerceCheckoutService` is
     * shared between `/store/v1` and `/commerce/v1`, so the same fix
     * protects both without any change to `/store/v1`'s own contract (no
     * new Idempotency-Key on `POST checkout`). `complete()` now moves the
     * Cart to `consumed` in the same transaction that completes the
     * Checkout, so a second `POST checkout` on the same cart cookie no
     * longer resumes anything — it 404s like any other non-active cart.
     * `POST checkout/complete` keeps replaying/conflicting correctly via
     * `resolveForCompletion()`'s `allowConsumed: true` lookup.
     *
     * @test
     */
    public function a_second_post_checkout_after_completion_is_rejected_on_the_web_path_too_because_the_cart_is_consumed(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-dup-guard.test');
        $product = $this->product($tenant, $channel);
        $token = $this->fullyReadyCheckout('checkout-complete-dup-guard.test', $tenant, $channel, $product);

        $first = $this->complete('checkout-complete-dup-guard.test', $token, 'idem-web-guard-A')->assertCreated();
        $this->assertDatabaseCount('commerce_checkouts', 1);
        $this->assertDatabaseCount('commerce_orders', 1);
        $this->assertSame(\App\Models\CommerceCart::STATUS_CONSUMED, \App\Models\CommerceCart::withoutGlobalScopes()->firstOrFail()->status);

        $this->createCheckout('checkout-complete-dup-guard.test', $token)->assertStatus(404);
        $this->assertDatabaseCount('commerce_checkouts', 1);

        $this->complete('checkout-complete-dup-guard.test', $token, 'idem-web-guard-B')
            ->assertStatus(409)->assertJsonPath('error.code', 'idempotency_conflict');

        $replay = $this->complete('checkout-complete-dup-guard.test', $token, 'idem-web-guard-A')->assertOk();
        $this->assertSame($first->json('data.order.id'), $replay->json('data.order.id'));
        $this->assertDatabaseCount('commerce_checkouts', 1);
        $this->assertDatabaseCount('commerce_orders', 1);
    }

    /**
     * يعيد استعمال نمط `StorefrontCartApiTest::deleting_an_alternative_unit_price_...`
     * حرفياً: سعرٌ صريح لوحدة بديلة كان محسوماً وقت الإضافة للسلة، ثم يُحذف
     * قبل الإتمام — أقرب سيناريو حقيقي قابل للاختبار لـ"تغيّر السعر" في نظامٍ
     * لا يخزّن سعراً سابقاً على السطر إطلاقاً (Cart/Checkout كلاهما لا يُثبّتان
     * سعراً — التقرير النهائي يوثّق هذا القيد صراحةً).
     *
     * @test
     */
    public function a_price_that_becomes_unresolved_before_completion_requires_review_and_creates_no_order(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-price.test');
        app(TenantContext::class)->set($tenant->id);
        $template = UnitTemplate::create(['name' => 'Price gone units', 'base_unit' => 'piece']);
        $carton = $template->units()->create(['name' => 'carton', 'factor' => 10]);
        $list = PriceList::create(['name' => 'Price gone list', 'is_active' => true]);
        $channel->update(['default_price_list_id' => $list->id]);
        app(TenantContext::class)->forget();
        $product = $this->product($tenant, $channel, ['unit_template_id' => $template->id]);
        app(TenantContext::class)->set($tenant->id);
        $item = app(PriceListService::class)->upsertItem($list, $product, ['unit_name' => 'carton', 'price' => 9000]);
        app(TenantContext::class)->forget();

        $token = $this->cartTokenWithItem('checkout-complete-price.test', $product, 1, 'unit:'.$carton->id);
        $this->createCheckout('checkout-complete-price.test', $token)->assertCreated();
        $this->readyCheckout('checkout-complete-price.test', $token);

        app(TenantContext::class)->set($tenant->id);
        $item->delete();
        app(TenantContext::class)->forget();

        $response = $this->complete('checkout-complete-price.test', $token, 'idem-key-price')
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'review_required');

        $this->assertSame('price_unresolved', $response->json('error.details.items.0.reason'));
        $this->assertDatabaseCount('commerce_orders', 0);
        app(TenantContext::class)->set($tenant->id);
        $this->assertSame(CommerceCheckout::STATUS_ACTIVE, CommerceCheckout::first()->status);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_unpublished_product_at_completion_requires_review_and_creates_no_order(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-unpub.test');
        $product = $this->product($tenant, $channel);
        $token = $this->fullyReadyCheckout('checkout-complete-unpub.test', $tenant, $channel, $product);

        app(TenantContext::class)->set($tenant->id);
        CommerceListing::query()->where('product_id', $product->id)->update(['is_published' => false]);
        app(TenantContext::class)->forget();

        $response = $this->complete('checkout-complete-unpub.test', $token, 'idem-key-unpub')
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'review_required');

        $this->assertSame('unavailable', $response->json('error.details.items.0.reason'));
        $this->assertDatabaseCount('commerce_orders', 0);
    }

    /** @test */
    public function insufficient_stock_at_completion_prevents_order_creation_without_reserving_anything(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-stock.test');
        $product = $this->product($tenant, $channel, ['track_inventory' => true]);
        app(TenantContext::class)->set($tenant->id);
        $warehouse = Warehouse::create(['name' => 'مخزن إتمام', 'code' => 'CHKC-W1', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($channel->id, $warehouse->id);
        ProductWarehouseStock::create(['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 1]);
        app(TenantContext::class)->forget();

        $token = $this->cartTokenWithItem('checkout-complete-stock.test', $product, 5);
        $this->createCheckout('checkout-complete-stock.test', $token)->assertCreated();
        $this->readyCheckout('checkout-complete-stock.test', $token);

        $response = $this->complete('checkout-complete-stock.test', $token, 'idem-key-stock')
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'review_required');

        $this->assertSame('insufficient_stock', $response->json('error.details.items.0.reason'));
        $this->assertDatabaseCount('commerce_orders', 0);
        $this->assertDatabaseCount('inventory_reservations', 0);
    }

    /**
     * Post-Review P1 — documents the real, honest contract rather than
     * asserting a false one: the availability check in `revalidateAndPrice()`
     * is a point-in-time read, not an allocation. Two independent checkouts
     * for the same product, each individually within available stock at the
     * moment each completes, can BOTH succeed even though their combined
     * quantity exceeds on-hand stock — because completion never consumes or
     * reserves anything (no InventoryReservation, no StockMovement is
     * created anywhere in 1B). Overselling prevention requires an
     * allocation/reservation policy, which is explicitly out of scope here
     * (ADR-02 §5, still undecided). This is not a bug to fix in this PR; it
     * is the documented boundary of what a stock *check* (vs. a stock
     * *reservation*) can guarantee.
     *
     * @test
     */
    public function two_independent_checkouts_can_both_complete_against_the_same_limited_stock(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-oversell.test');
        $product = $this->product($tenant, $channel, ['track_inventory' => true]);
        app(TenantContext::class)->set($tenant->id);
        $warehouse = Warehouse::create(['name' => 'مخزن تعارض', 'code' => 'CHKC-W2', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($channel->id, $warehouse->id);
        ProductWarehouseStock::create(['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 5]);
        app(TenantContext::class)->forget();

        // Both raw cart tokens are minted before either checkout is touched:
        // withUnencryptedCookie() (used by createCheckout()/readyCheckout())
        // persists as a default cookie across subsequent calls within one
        // test method (Laravel TestCase behavior), so minting token B after
        // driving checkout A through readyCheckout() would silently reuse
        // cart A's cookie instead of creating an independent cart.
        $tokenA = $this->cartTokenWithItem('checkout-complete-oversell.test', $product, 5);
        $tokenB = $this->cartTokenWithItem('checkout-complete-oversell.test', $product, 5);

        $this->createCheckout('checkout-complete-oversell.test', $tokenA)->assertCreated();
        $this->readyCheckout('checkout-complete-oversell.test', $tokenA);
        $this->createCheckout('checkout-complete-oversell.test', $tokenB)->assertCreated();
        $this->readyCheckout('checkout-complete-oversell.test', $tokenB);

        // Both checkouts independently saw 5 available and both complete —
        // the second is not blocked by the first, because the first never
        // consumed or reserved the stock it checked.
        $this->complete('checkout-complete-oversell.test', $tokenA, 'idem-key-oversell-a')->assertCreated();
        $this->complete('checkout-complete-oversell.test', $tokenB, 'idem-key-oversell-b')->assertCreated();

        $this->assertDatabaseCount('commerce_orders', 2);
        $this->assertDatabaseCount('inventory_reservations', 0);
        app(TenantContext::class)->set($tenant->id);
        $this->assertSame(5, ProductWarehouseStock::first()->quantity); // on-hand is untouched by either completion
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_expired_checkout_cannot_be_completed(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-expchk.test');
        $product = $this->product($tenant, $channel);
        $token = $this->fullyReadyCheckout('checkout-complete-expchk.test', $tenant, $channel, $product);

        app(TenantContext::class)->set($tenant->id);
        CommerceCheckout::query()->update(['expires_at' => now()->subMinute()]);
        app(TenantContext::class)->forget();

        $this->complete('checkout-complete-expchk.test', $token, 'idem-key-expchk')->assertNotFound();
        $this->assertDatabaseCount('commerce_orders', 0);
    }

    /** @test */
    public function an_expired_cart_cannot_be_completed_even_with_a_still_open_checkout(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-expcart.test');
        $product = $this->product($tenant, $channel);
        $token = $this->fullyReadyCheckout('checkout-complete-expcart.test', $tenant, $channel, $product);

        app(TenantContext::class)->set($tenant->id);
        CommerceCart::query()->update(['expires_at' => now()->subMinute()]);
        app(TenantContext::class)->forget();

        $this->complete('checkout-complete-expcart.test', $token, 'idem-key-expcart')->assertNotFound();
        $this->assertDatabaseCount('commerce_orders', 0);
    }

    /** @test */
    public function completion_fails_closed_across_tenant_storefront_and_sales_channel_contexts(): void
    {
        $a = $this->store('checkout-complete-ctx-a.test');
        $b = $this->store('checkout-complete-ctx-b.test');
        $productA = $this->product($a['tenant'], $a['channel']);
        $tokenA = $this->fullyReadyCheckout('checkout-complete-ctx-a.test', $a['tenant'], $a['channel'], $productA);

        // Same raw token, resolved under a completely different tenant/storefront/channel host.
        $this->complete('checkout-complete-ctx-b.test', $tokenA, 'idem-key-cross')->assertNotFound();

        $this->assertDatabaseCount('commerce_orders', 0);
        app(TenantContext::class)->set($a['tenant']->id);
        $this->assertSame(CommerceCheckout::STATUS_ACTIVE, CommerceCheckout::first()->status);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function completion_creates_no_accounting_inventory_or_reservation_side_effects(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-complete-noeffect.test');
        $product = $this->product($tenant, $channel);
        $token = $this->fullyReadyCheckout('checkout-complete-noeffect.test', $tenant, $channel, $product);
        $this->complete('checkout-complete-noeffect.test', $token, 'idem-key-noeffect')->assertCreated();

        $this->assertSame(0, DB::table('journal_entries')->count());
        $this->assertSame(0, DB::table('journal_lines')->count());
        $this->assertSame(0, DB::table('stock_movements')->count());
        $this->assertSame(0, DB::table('inventory_reservations')->count());
        $this->assertSame(0, DB::table('payments')->count());
        $this->assertSame(0, DB::table('invoices')->count());
        $this->assertDatabaseCount('commerce_orders', 1);
    }
}
