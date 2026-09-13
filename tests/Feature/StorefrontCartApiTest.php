<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceCartItem;
use App\Models\CommerceListing;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Services\Commerce\CommerceCartService;
use App\Services\PriceListService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class StorefrontCartApiTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'cart-gateway-secret';

    /** @return array{tenant: Tenant, channel: SalesChannel, storefront: Storefront, domain: StorefrontDomain} */
    private function store(string $host, string $currency = 'SAR'): array
    {
        $tenant = Tenant::create([
            'name' => $host, 'slug' => 'cart-'.Str::random(8),
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
            'name' => 'Cart product', 'sku' => 'CART-'.Str::random(8),
            'unit' => 'piece', 'sale_price' => 1250, 'is_active' => true,
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

    private function add(string $host, Product $product, array $extra = [], ?string $token = null)
    {
        $test = $this->withHeaders($this->mutationHeaders($host));
        if ($token !== null) {
            $test = $test->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token);
        }

        return $test->postJson('http://laravel-internal.test/store/v1/cart/items', array_merge([
            'product_id' => $product->id, 'quantity' => 1,
        ], $extra));
    }

    /** @test */
    public function get_is_non_creating_and_first_valid_add_stores_only_a_hash_in_a_secure_cookie_contract(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('cart-one.test');
        $product = $this->product($tenant, $channel);

        $this->getJson('http://cart-one.test/store/v1/cart')
            ->assertOk()->assertJsonPath('data.items', []);
        $this->assertDatabaseCount('commerce_carts', 0);

        $response = $this->add('cart-one.test', $product)->assertCreated();
        $cookie = $response->getCookie(CommerceCartService::COOKIE_NAME, false);
        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('lax', strtolower((string) $cookie->getSameSite()));
        $this->assertSame('/', $cookie->getPath());
        $this->assertNull($cookie->getDomain());
        $raw = $cookie->getValue();
        $this->assertSame(43, strlen($raw));
        $cart = CommerceCart::withoutGlobalScopes()->firstOrFail();
        $this->assertSame(hash('sha256', $raw), $cart->token_hash);
        $this->assertNotSame($raw, $cart->token_hash);
        $this->assertStringNotContainsString($raw, $response->getContent());
    }

    /** @test */
    public function mutations_require_the_strict_gateway_but_catalog_style_get_remains_host_resolvable(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('cart-gateway.test');
        $product = $this->product($tenant, $channel);
        config(['storefront.gateway_secret' => self::SECRET]);

        $this->postJson('http://cart-gateway.test/store/v1/cart/items', [
            'product_id' => $product->id, 'quantity' => 1,
        ])->assertNotFound();
        $this->withHeaders($this->mutationHeaders('cart-gateway.test', 'wrong'))
            ->postJson('http://laravel-internal.test/store/v1/cart/items', [
                'product_id' => $product->id, 'quantity' => 1,
            ])->assertNotFound();
        $this->getJson('http://cart-gateway.test/store/v1/cart')->assertOk();
        $this->add('cart-gateway.test', $product)->assertCreated();
        $this->assertDatabaseCount('commerce_carts', 1);
    }

    /** @test */
    public function invalid_expired_and_context_mismatched_tokens_fail_closed_and_clear_the_cookie(): void
    {
        $a = $this->store('cart-a.test');
        $b = $this->store('cart-b.test');
        $product = $this->product($a['tenant'], $a['channel']);
        $created = $this->add('cart-a.test', $product)->assertCreated();
        $token = $created->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();

        $this->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, 'invalid-token')
            ->getJson('http://cart-a.test/store/v1/cart')->assertOk()
            ->assertCookieExpired(CommerceCartService::COOKIE_NAME);
        $this->withHeaders($this->mutationHeaders('cart-b.test'))->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->getJson('http://laravel-internal.test/store/v1/cart')->assertOk()
            ->assertJsonPath('data.items', [])->assertCookieExpired(CommerceCartService::COOKIE_NAME);

        app(TenantContext::class)->set($a['tenant']->id);
        CommerceCart::query()->update(['expires_at' => now()->subSecond()]);
        app(TenantContext::class)->forget();
        $this->withHeaders($this->mutationHeaders('cart-a.test'))->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->getJson('http://laravel-internal.test/store/v1/cart')->assertOk()
            ->assertCookieExpired(CommerceCartService::COOKIE_NAME);
        $this->assertSame(CommerceCart::STATUS_EXPIRED, CommerceCart::withoutGlobalScopes()->first()->status);
    }

    /** @test */
    public function product_tenant_activity_and_channel_publication_are_enforced_without_tenant_scope_bypass(): void
    {
        $a = $this->store('eligibility-a.test');
        $b = $this->store('eligibility-b.test');
        $active = $this->product($a['tenant'], $a['channel']);
        $unpublished = $this->product($a['tenant'], $a['channel'], [], false);
        $inactive = $this->product($a['tenant'], $a['channel'], ['is_active' => false]);
        $foreign = $this->product($b['tenant'], $b['channel']);

        $this->add('eligibility-a.test', $active)->assertCreated();
        $this->add('eligibility-a.test', $unpublished)->assertUnprocessable();
        $this->add('eligibility-a.test', $inactive)->assertUnprocessable();
        $this->add('eligibility-a.test', $foreign)->assertUnprocessable();
        $this->assertDatabaseCount('commerce_carts', 1);
    }

    /** @test */
    public function canonical_uom_rules_and_explicit_alternative_pricing_are_enforced(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $store = $this->store('uom-cart.test');
        app(TenantContext::class)->set($tenant->id);
        $template = UnitTemplate::create(['name' => 'Cases', 'base_unit' => 'piece']);
        $case = $template->units()->create(['name' => 'case', 'factor' => 12]);
        $other = UnitTemplate::create(['name' => 'Other', 'base_unit' => 'piece'])
            ->units()->create(['name' => 'other-case', 'factor' => 24]);
        $list = PriceList::create(['name' => 'Web prices', 'is_active' => true]);
        $channel->update(['default_price_list_id' => $list->id]);
        app(TenantContext::class)->forget();
        $product = $this->product($tenant, $channel, ['unit_template_id' => $template->id, 'sale_price' => 1000]);

        $this->add('uom-cart.test', $product, ['unit_key' => 'unit:'.$case->id])->assertUnprocessable();
        app(TenantContext::class)->set($tenant->id);
        app(PriceListService::class)->upsertItem($list, $product, ['unit_name' => 'case', 'price' => 11000]);
        app(TenantContext::class)->forget();
        $response = $this->add('uom-cart.test', $product, ['unit_key' => 'unit:'.$case->id, 'quantity' => 2])
            ->assertCreated()
            ->assertJsonPath('data.items.0.unit_price.amount_minor', 11000)
            ->assertJsonPath('data.items.0.line_total.amount_minor', 22000);
        $token = $response->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
        $this->add('uom-cart.test', $product, ['unit_key' => 'base'], $token)
            ->assertOk()->assertJsonCount(2, 'data.items');
        $this->add('uom-cart.test', $product, ['unit_key' => 'unit:'.$other->id])->assertUnprocessable();
        $this->add('uom-cart.test', $product, ['unit_key' => 'case'])->assertUnprocessable();
        $this->assertNotSame(24000, $response->json('data.items.0.line_total.amount_minor'));
    }

    /** @test */
    public function repeated_identity_merges_different_uom_separates_and_patch_delete_work(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('behavior-cart.test', 'AED');
        $product = $this->product($tenant, $channel);
        $first = $this->add('behavior-cart.test', $product, ['quantity' => 2])->assertCreated();
        $token = $first->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
        $second = $this->add('behavior-cart.test', $product, ['quantity' => 3], $token)
            ->assertOk()->assertJsonPath('data.items.0.quantity', 5)
            ->assertJsonPath('data.subtotal.amount_minor', 6250)
            ->assertJsonPath('data.currency', 'AED');
        $item = $second->json('data.items.0.id');

        $this->withHeaders($this->mutationHeaders('behavior-cart.test'))->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->patchJson("http://laravel-internal.test/store/v1/cart/items/{$item}", ['quantity' => 4])
            ->assertOk()->assertJsonPath('data.items.0.quantity', 4);
        $this->withHeaders($this->mutationHeaders('behavior-cart.test'))->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->deleteJson("http://laravel-internal.test/store/v1/cart/items/{$item}")
            ->assertOk()->assertJsonPath('data.items', []);
        $this->assertDatabaseCount('commerce_cart_items', 0);
    }

    /** @test */
    public function unavailable_lines_are_retained_zeroed_not_updatable_and_removable(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('unavailable-cart.test');
        $product = $this->product($tenant, $channel);
        $created = $this->add('unavailable-cart.test', $product, ['quantity' => 2])->assertCreated();
        $token = $created->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
        $item = $created->json('data.items.0.id');

        app(TenantContext::class)->set($tenant->id);
        $product->update(['name' => 'Renamed cart product']);
        app(TenantContext::class)->forget();

        $this->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->getJson('http://unavailable-cart.test/store/v1/cart')->assertOk()
            ->assertJsonPath('data.items.0.available', true)
            ->assertJsonPath('data.items.0.product_name', 'Renamed cart product');

        app(TenantContext::class)->set($tenant->id);
        CommerceListing::query()->where('product_id', $product->id)->update(['is_published' => false]);
        app(TenantContext::class)->forget();

        $this->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->getJson('http://unavailable-cart.test/store/v1/cart')->assertOk()
            ->assertJsonPath('data.items.0.available', false)
            ->assertJsonPath('data.items.0.product_name', 'Cart product');

        app(TenantContext::class)->set($tenant->id);
        CommerceListing::query()->where('product_id', $product->id)->update(['is_published' => true]);
        $product->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $this->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->getJson('http://unavailable-cart.test/store/v1/cart')->assertOk()
            ->assertJsonPath('data.items.0.available', false);

        app(TenantContext::class)->set($tenant->id);
        $product->update(['is_active' => true]);
        $product->delete();
        app(TenantContext::class)->forget();

        $this->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->getJson('http://unavailable-cart.test/store/v1/cart')->assertOk()
            ->assertJsonPath('data.items.0.available', false)
            ->assertJsonPath('data.items.0.product_name', 'Cart product')
            ->assertJsonPath('data.items.0.line_total.amount_minor', 0)
            ->assertJsonPath('data.subtotal.amount_minor', 0)
            ->assertJsonPath('data.has_unavailable_items', true);
        $this->withHeaders($this->mutationHeaders('unavailable-cart.test'))->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->patchJson("http://laravel-internal.test/store/v1/cart/items/{$item}", ['quantity' => 3])
            ->assertUnprocessable();
        $this->withHeaders($this->mutationHeaders('unavailable-cart.test'))->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->deleteJson("http://laravel-internal.test/store/v1/cart/items/{$item}")->assertOk();
    }

    /** @test */
    public function authority_fields_bad_quantities_and_database_duplicate_lines_are_rejected(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('validation-cart.test');
        $product = $this->product($tenant, $channel);
        foreach ([0, -1, 1.5, 'one'] as $quantity) {
            $this->add('validation-cart.test', $product, ['quantity' => $quantity])->assertUnprocessable();
        }
        $this->add('validation-cart.test', $product, ['price' => 1])->assertUnprocessable();
        $created = $this->add('validation-cart.test', $product)->assertCreated();
        $cart = CommerceCart::withoutGlobalScopes()->firstOrFail();
        $line = CommerceCartItem::withoutGlobalScopes()->firstOrFail();

        $this->expectException(QueryException::class);
        CommerceCartItem::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'cart_id' => $cart->id, 'product_id' => $product->id,
            'product_name_snapshot' => 'duplicate', 'unit_key' => $line->unit_key, 'quantity' => 1,
        ]);
    }

    /** @test */
    public function reads_recalculate_prices_without_inventory_order_or_accounting_side_effects(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('reprice-cart.test');
        $product = $this->product($tenant, $channel, ['sale_price' => 500]);
        $created = $this->add('reprice-cart.test', $product, ['quantity' => 2])->assertCreated();
        $token = $created->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
        app(TenantContext::class)->set($tenant->id);
        $product->update(['sale_price' => 750]);
        app(TenantContext::class)->forget();

        $this->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->getJson('http://reprice-cart.test/store/v1/cart')->assertOk()
            ->assertJsonPath('data.subtotal.amount_minor', 1500);
        foreach (['commerce_orders', 'invoices', 'payments', 'stock_movements', 'inventory_reservations', 'journal_entries'] as $table) {
            $this->assertSame(0, DB::table($table)->count(), "Unexpected side effect in {$table}");
        }
    }
}
