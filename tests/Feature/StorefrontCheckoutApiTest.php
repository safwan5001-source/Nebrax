<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceCheckout;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\CommerceCheckoutService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/** COM-CHECKOUT-1A — Checkout foundation: creation, contact/address/delivery, context isolation. */
class StorefrontCheckoutApiTest extends TestCase
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

    private function product(Tenant $tenant, SalesChannel $channel): Product
    {
        app(TenantContext::class)->set($tenant->id);
        $product = Product::create([
            'name' => 'Checkout product', 'sku' => 'CHK-'.Str::random(8),
            'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true,
        ]);
        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true,
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
    private function cartTokenWithItem(string $host, Product $product): string
    {
        config(['storefront.gateway_secret' => self::SECRET]);
        $response = $this->withHeaders($this->mutationHeaders($host))
            ->postJson('http://laravel-internal.test/store/v1/cart/items', [
                'product_id' => $product->id, 'quantity' => 1,
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

    /**
     * Always sets the forwarded-host header explicitly for $host, overwriting
     * any host a prior call in the same test set via withHeaders() — Laravel's
     * TestCase accumulates default headers across calls within one test method,
     * so a bare host-only getJson() after an earlier withHeaders() call would
     * silently keep resolving the *previous* host instead. Matches
     * StorefrontCartApiTest's own established pattern for cross-context checks.
     */
    private function getCheckout(string $host, ?string $token): TestResponse
    {
        $test = $this->withHeaders($this->mutationHeaders($host))->withCredentials();
        if ($token !== null) {
            $test = $test->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token);
        }

        return $test->getJson('http://laravel-internal.test/store/v1/checkout');
    }

    private function patchContact(string $host, string $token, array $body): TestResponse
    {
        return $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->patchJson('http://laravel-internal.test/store/v1/checkout/contact', $body);
    }

    private function patchAddress(string $host, string $token, array $body): TestResponse
    {
        return $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->patchJson('http://laravel-internal.test/store/v1/checkout/address', $body);
    }

    private function patchDelivery(string $host, string $token, array $body): TestResponse
    {
        return $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->patchJson('http://laravel-internal.test/store/v1/checkout/delivery', $body);
    }

    /** @test */
    public function a_guest_can_create_a_checkout_from_their_cart_with_no_partner_id_involved(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-guest.test');
        $product = $this->product($tenant, $channel);
        $token = $this->cartTokenWithItem('checkout-guest.test', $product);

        $response = $this->createCheckout('checkout-guest.test', $token)->assertCreated();

        $response->assertJsonPath('data.status', CommerceCheckout::STATUS_ACTIVE);
        $response->assertJsonPath('data.contact.name', null);
        $response->assertJsonPath('data.cart.items.0.product_id', $product->id);
        $this->assertDatabaseCount('commerce_checkouts', 1);

        app(TenantContext::class)->set($tenant->id);
        $this->assertNull(CommerceCheckout::first()->contact_name);
        $this->assertNotNull(CommerceCheckout::first()->cart_id);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function checkout_is_bound_to_the_exact_cart_tenant_storefront_and_channel_it_was_created_in(): void
    {
        ['tenant' => $tenant, 'channel' => $channel, 'storefront' => $storefront] = $this->store('checkout-bind.test');
        $product = $this->product($tenant, $channel);
        $token = $this->cartTokenWithItem('checkout-bind.test', $product);

        $this->createCheckout('checkout-bind.test', $token)->assertCreated();

        app(TenantContext::class)->set($tenant->id);
        $checkout = CommerceCheckout::firstOrFail();
        $cart = CommerceCart::withoutGlobalScopes()->findOrFail($checkout->cart_id);
        $this->assertSame($tenant->id, $checkout->tenant_id);
        $this->assertSame($storefront->id, $checkout->storefront_id);
        $this->assertSame($channel->id, $checkout->sales_channel_id);
        $this->assertSame($cart->storefront_id, $checkout->storefront_id);
        $this->assertSame($cart->sales_channel_id, $checkout->sales_channel_id);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function repeated_post_resumes_the_same_open_checkout_instead_of_creating_a_second_one(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-resume.test');
        $product = $this->product($tenant, $channel);
        $token = $this->cartTokenWithItem('checkout-resume.test', $product);

        $first = $this->createCheckout('checkout-resume.test', $token)->assertCreated();
        $second = $this->createCheckout('checkout-resume.test', $token)->assertOk();

        $this->assertDatabaseCount('commerce_checkouts', 1);
        $this->assertNotNull($first);
        $this->assertNotNull($second);
    }

    /** @test */
    public function get_retrieves_only_the_current_valid_checkout_and_an_expired_one_reads_as_none(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-get.test');
        $product = $this->product($tenant, $channel);
        $token = $this->cartTokenWithItem('checkout-get.test', $product);
        $this->createCheckout('checkout-get.test', $token)->assertCreated();

        $this->getCheckout('checkout-get.test', $token)
            ->assertOk()->assertJsonPath('data.status', CommerceCheckout::STATUS_ACTIVE);

        app(TenantContext::class)->set($tenant->id);
        CommerceCheckout::query()->update(['expires_at' => now()->subMinute()]);
        app(TenantContext::class)->forget();

        $this->getCheckout('checkout-get.test', $token)
            ->assertOk()->assertJsonPath('data.status', null);

        app(TenantContext::class)->set($tenant->id);
        $this->assertSame(CommerceCheckout::STATUS_EXPIRED, CommerceCheckout::first()->status);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function get_with_no_cart_cookie_returns_an_empty_checkout_without_creating_anything(): void
    {
        $this->store('checkout-fresh.test');

        $this->getCheckout('checkout-fresh.test', null)
            ->assertOk()->assertJsonPath('data.status', null)
            ->assertJsonPath('data.cart.items', []);

        $this->assertDatabaseCount('commerce_checkouts', 0);
        $this->assertDatabaseCount('commerce_carts', 0);
    }

    /** @test */
    public function post_checkout_never_creates_a_cart_and_fails_closed_with_no_cart_cookie(): void
    {
        $this->store('checkout-nocart.test');

        $this->createCheckout('checkout-nocart.test', null)->assertNotFound();

        $this->assertDatabaseCount('commerce_carts', 0);
        $this->assertDatabaseCount('commerce_checkouts', 0);
    }

    /** @test */
    public function an_expired_cart_is_rejected_when_starting_checkout(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-expcart.test');
        $product = $this->product($tenant, $channel);
        $token = $this->cartTokenWithItem('checkout-expcart.test', $product);

        app(TenantContext::class)->set($tenant->id);
        CommerceCart::query()->update(['expires_at' => now()->subMinute()]);
        app(TenantContext::class)->forget();

        $this->createCheckout('checkout-expcart.test', $token)->assertNotFound();
        $this->assertDatabaseCount('commerce_checkouts', 0);
    }

    /** @test */
    public function contact_update_persists_name_phone_and_optional_email(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-contact.test');
        $product = $this->product($tenant, $channel);
        $token = $this->cartTokenWithItem('checkout-contact.test', $product);
        $this->createCheckout('checkout-contact.test', $token)->assertCreated();

        $this->patchContact('checkout-contact.test', $token, [
            'name' => 'سالم الأحمدي', 'phone' => '0501234567', 'email' => 'salem@example.com',
        ])->assertOk()
            ->assertJsonPath('data.contact.name', 'سالم الأحمدي')
            ->assertJsonPath('data.contact.phone', '0501234567')
            ->assertJsonPath('data.contact.email', 'salem@example.com');

        // Partial PATCH updates only the given field.
        $this->patchContact('checkout-contact.test', $token, ['phone' => '0559876543'])
            ->assertOk()
            ->assertJsonPath('data.contact.name', 'سالم الأحمدي')
            ->assertJsonPath('data.contact.phone', '0559876543');
    }

    /** @test */
    public function address_update_persists_the_delivery_snapshot_fields(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-address.test');
        $product = $this->product($tenant, $channel);
        $token = $this->cartTokenWithItem('checkout-address.test', $product);
        $this->createCheckout('checkout-address.test', $token)->assertCreated();

        $this->patchAddress('checkout-address.test', $token, [
            'country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ',
            'street' => 'شارع الملك فهد', 'postal_code' => '31411', 'notes' => 'اتصل قبل الوصول',
        ])->assertOk()
            ->assertJsonPath('data.delivery.address.country', 'SA')
            ->assertJsonPath('data.delivery.address.city', 'الدمام')
            ->assertJsonPath('data.delivery.address.district', 'الشاطئ')
            ->assertJsonPath('data.delivery.address.street', 'شارع الملك فهد')
            ->assertJsonPath('data.delivery.address.postal_code', '31411')
            ->assertJsonPath('data.delivery.address.notes', 'اتصل قبل الوصول');
    }

    /** @test */
    public function delivery_update_accepts_only_a_known_method_and_never_a_client_supplied_monetary_value(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-delivery.test');
        $product = $this->product($tenant, $channel);
        $token = $this->cartTokenWithItem('checkout-delivery.test', $product);
        $this->createCheckout('checkout-delivery.test', $token)->assertCreated();

        // A client-supplied monetary field is rejected outright — never silently ignored.
        $this->patchDelivery('checkout-delivery.test', $token, [
            'method' => 'pickup', 'amount' => 99999,
        ])->assertUnprocessable();

        $this->patchDelivery('checkout-delivery.test', $token, [
            'method' => 'pickup', 'price' => 1,
        ])->assertUnprocessable();

        // An unknown method (not in the server's fixed list) is rejected too.
        $this->patchDelivery('checkout-delivery.test', $token, ['method' => 'drone'])
            ->assertUnprocessable();

        // A known method is accepted; the amount is always server-set to zero
        // (no real shipping-rate authority exists yet — see CommerceCheckoutService).
        $this->patchDelivery('checkout-delivery.test', $token, ['method' => 'pickup'])
            ->assertOk()
            ->assertJsonPath('data.delivery.method', 'pickup')
            ->assertJsonPath('data.delivery.amount.amount_minor', 0);

        app(TenantContext::class)->set($tenant->id);
        $this->assertSame(0, CommerceCheckout::first()->delivery_amount_minor);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function mutations_require_the_strict_gateway_while_get_remains_host_resolvable(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-gateway.test');

        // GET resolves via the literal incoming Host alone — no gateway secret
        // needed. This must be the first HTTP call in the test: withHeaders()
        // on Laravel's TestCase accumulates default headers across calls within
        // one test method, so calling this after a withHeaders()-using helper
        // would no longer prove header-less resolution.
        $this->getJson('http://checkout-gateway.test/store/v1/checkout')
            ->assertOk()->assertJsonPath('data.status', null);

        $product = $this->product($tenant, $channel);
        $token = $this->cartTokenWithItem('checkout-gateway.test', $product);

        $this->postJson('http://checkout-gateway.test/store/v1/checkout', [])->assertNotFound();
        $this->withHeaders($this->mutationHeaders('checkout-gateway.test', 'wrong-secret'))
            ->postJson('http://laravel-internal.test/store/v1/checkout', [])->assertNotFound();

        $this->createCheckout('checkout-gateway.test', $token)->assertCreated();
    }

    /** @test */
    public function a_checkout_created_under_one_tenant_is_invisible_to_a_different_tenant_context(): void
    {
        $a = $this->store('checkout-tenant-a.test');
        $b = $this->store('checkout-tenant-b.test');
        $productA = $this->product($a['tenant'], $a['channel']);
        $tokenA = $this->cartTokenWithItem('checkout-tenant-a.test', $productA);
        $this->createCheckout('checkout-tenant-a.test', $tokenA)->assertCreated();

        // Same raw token, resolved under tenant B's host — must not leak tenant A's checkout.
        $this->getCheckout('checkout-tenant-b.test', $tokenA)
            ->assertOk()->assertJsonPath('data.status', null);
        $this->patchContact('checkout-tenant-b.test', $tokenA, ['name' => 'x'])->assertNotFound();

        app(TenantContext::class)->set($a['tenant']->id);
        $this->assertSame(1, CommerceCheckout::count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_checkout_is_invisible_across_a_different_storefront_in_the_same_tenant(): void
    {
        $tenant = Tenant::create([
            'name' => 'multi-store', 'slug' => 'multi-store-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefrontA = Storefront::create(['slug' => 'store-a', 'name' => 'A', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        $storefrontB = Storefront::create(['slug' => 'store-b', 'name' => 'B', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefrontA->id, 'hostname' => 'checkout-store-a.test',
            'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        StorefrontDomain::create([
            'storefront_id' => $storefrontB->id, 'hostname' => 'checkout-store-b.test',
            'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        $product = $this->product($tenant, $channel);
        app(TenantContext::class)->forget();

        $token = $this->cartTokenWithItem('checkout-store-a.test', $product);
        $this->createCheckout('checkout-store-a.test', $token)->assertCreated();

        // Same tenant, same channel, different storefront — must still fail closed.
        $this->getCheckout('checkout-store-b.test', $token)
            ->assertOk()->assertJsonPath('data.status', null);
        $this->patchContact('checkout-store-b.test', $token, ['name' => 'x'])->assertNotFound();
    }

    /** @test */
    public function a_checkout_is_invisible_across_a_different_sales_channel_in_the_same_storefront_context(): void
    {
        // Cart itself already scopes by (storefront_id, sales_channel_id) pair at
        // token lookup — a cart token minted for channel A's context cannot resolve
        // under channel B's host at all, so checkout (which defers entirely to the
        // same cart lookup) inherits the same channel isolation automatically.
        $a = $this->store('checkout-channel-a.test');
        $b = $this->store('checkout-channel-b.test');
        $productA = $this->product($a['tenant'], $a['channel']);
        $tokenA = $this->cartTokenWithItem('checkout-channel-a.test', $productA);
        $this->createCheckout('checkout-channel-a.test', $tokenA)->assertCreated();

        $this->getCheckout('checkout-channel-b.test', $tokenA)
            ->assertOk()->assertJsonPath('data.status', null);
    }

    /** @test */
    public function no_accounting_or_inventory_side_effects_are_ever_created_by_checkout_foundation(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-noeffect.test');
        $product = $this->product($tenant, $channel);
        $token = $this->cartTokenWithItem('checkout-noeffect.test', $product);
        $this->createCheckout('checkout-noeffect.test', $token)->assertCreated();
        $this->patchContact('checkout-noeffect.test', $token, ['name' => 'x', 'phone' => 'y'])->assertOk();
        $this->patchAddress('checkout-noeffect.test', $token, ['country' => 'SA', 'city' => 'x', 'street' => 'y'])->assertOk();
        $this->patchDelivery('checkout-noeffect.test', $token, ['method' => 'pickup'])->assertOk();

        $this->assertSame(0, DB::table('journal_entries')->count());
        $this->assertSame(0, DB::table('journal_lines')->count());
        $this->assertSame(0, DB::table('stock_movements')->count());
        $this->assertDatabaseCount('commerce_orders', 0);
    }

    /** @test */
    public function updating_a_completed_or_expired_checkout_fails_closed(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('checkout-terminal.test');
        $product = $this->product($tenant, $channel);
        $token = $this->cartTokenWithItem('checkout-terminal.test', $product);
        $this->createCheckout('checkout-terminal.test', $token)->assertCreated();

        app(TenantContext::class)->set($tenant->id);
        CommerceCheckout::query()->update(['status' => CommerceCheckout::STATUS_COMPLETED]);
        app(TenantContext::class)->forget();

        $this->patchContact('checkout-terminal.test', $token, ['name' => 'x'])->assertNotFound();
    }

    /** @test */
    public function the_checkout_service_never_reaches_for_a_client_amount_on_delivery(): void
    {
        $this->assertSame(['pickup', 'standard'], CommerceCheckoutService::DELIVERY_METHODS);
    }
}
