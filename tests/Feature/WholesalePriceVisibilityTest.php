<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CustomerIdentity;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\WholesaleMembershipService;
use App\Services\PriceListService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch F — رؤية أسعار الجملة (EnsureWholesalePriceAccess)
 * ═══════════════════════════════════════════════════════════════
 *  قناةٌ موسومة `wholesale_membership_enabled` لا تُظهر أسعارها (منتجات/عروض/سلة/إتمام) إلا لمشترٍ بجلسة مربوطة بهذا
 *  الـ Host وعضوية `approved` والبوابة المنصّية مفتوحة. المصادقة وحدها لا تمنح شيئاً. القناة غير الموسومة (DTC) بلا تغيير.
 */
class WholesalePriceVisibilityTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'price-visibility-secret';

    private const BASE = 'http://laravel-internal.test/store/v1/';

    private Tenant $tenant;

    private SalesChannel $channel;

    private Product $product;

    private string $host = 'wholesale.price.test';

    protected function setUp(): void
    {
        parent::setUp();
        config(['commerce.wholesale_buyer_enabled' => true, 'storefront.gateway_secret' => self::SECRET]);
        [$this->tenant, $this->channel, $this->product] = $this->makeStore($this->host, true, 1000, 700);
    }

    /** @return array{0: Tenant, 1: SalesChannel, 2: Product} */
    private function makeStore(string $host, bool $wholesale, int $retail, ?int $listPrice, ?Tenant $tenant = null): array
    {
        $tenant ??= Tenant::create([
            'name' => $host, 'slug' => 'pv-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web-'.Str::random(5), 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        if ($wholesale) {
            $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        }
        $storefront = Storefront::create(['slug' => 's-'.Str::random(5), 'name' => 'Main', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        $product = Product::create(['name' => 'صنف', 'sku' => 'PV-'.Str::random(8), 'unit' => 'piece', 'sale_price' => $retail, 'is_active' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        if ($listPrice !== null) {
            $list = PriceList::create(['name' => 'Wholesale '.Str::random(5), 'is_active' => true]);
            app(PriceListService::class)->upsertItem($list, $product, ['price' => $listPrice]);
            $channel->update(['default_price_list_id' => $list->id]);
        }
        app(TenantContext::class)->forget();

        return [$tenant, $channel, $product];
    }

    private function headers(string $host, ?string $token = null): array
    {
        $headers = ['X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET];
        if ($token !== null) {
            $headers['X-Customer-Token'] = $token;
        }

        return $headers;
    }

    private function identity(Tenant $tenant, string $email): CustomerIdentity
    {
        app(TenantContext::class)->set($tenant->id);
        $identity = CustomerIdentity::create([
            'tenant_id' => $tenant->id, 'display_name' => 'Buyer', 'email' => $email, 'password' => 'correct-horse-9',
            'email_verified_at' => now(), 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return $identity;
    }

    private function login(string $email, string $host): string
    {
        return (string) $this->withHeaders($this->headers($host))
            ->postJson(self::BASE.'auth/login', ['email' => $email, 'password' => 'correct-horse-9'])
            ->assertOk()->json('data.token');
    }

    private function owner(Tenant $tenant): User
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create([
            'tenant_id' => $tenant->id, 'name' => 'owner', 'email' => 'owner-'.Str::random(6).'@staff.test',
            'password' => 'password123', 'role' => 'owner',
        ]);
        app(TenantContext::class)->forget();

        return $user;
    }

    /** Registers + applies + (optionally) approves; returns [identity, token, membershipId]. */
    private function buyer(string $email, ?string $finalAction = 'approve', ?Tenant $tenant = null, ?SalesChannel $channel = null, ?string $host = null): array
    {
        $tenant ??= $this->tenant;
        $channel ??= $this->channel;
        $host ??= $this->host;
        $identity = $this->identity($tenant, $email);
        $token = $this->login($email, $host);

        $owner = $this->owner($tenant);
        app(TenantContext::class)->set($tenant->id);
        $membership = app(WholesaleMembershipService::class)->apply($identity, $channel->id);
        if ($finalAction !== null) {
            app(WholesaleMembershipService::class)->transition($membership->id, $finalAction, $owner);
        }
        app(TenantContext::class)->forget();

        return [$identity, $token, $membership->id];
    }

    private function storeGet(string $path, string $host, ?string $token = null)
    {
        return $this->withHeaders($this->headers($host, $token))->getJson(self::BASE.$path);
    }

    private function addToCart(string $host, string $productId, ?string $token = null)
    {
        return $this->withHeaders($this->headers($host, $token))
            ->postJson(self::BASE.'cart/items', ['product_id' => $productId, 'quantity' => 1]);
    }

    /** @return list<array{0:string}> every price-bearing GET surface */
    private function priceSurfaces(): array
    {
        return ['products', 'products/'.$this->product->id, 'offers', 'cart', 'checkout', 'checkout/payment-methods'];
    }

    // ═══════════════════════ DTC: لا تغيير ═══════════════════════

    #[Test]
    public function an_unflagged_dtc_channel_is_untouched_whatever_the_deployment_flag(): void
    {
        [, , $dtcProduct] = $this->makeStore('dtc.price.test', false, 1234, null);

        foreach ([true, false] as $flag) {
            config(['commerce.wholesale_buyer_enabled' => $flag]);
            $this->storeGet('products', 'dtc.price.test')->assertOk()->assertJsonPath('data.0.price.amount_minor', 1234);
            $this->storeGet('products/'.$dtcProduct->id, 'dtc.price.test')->assertOk()->assertJsonPath('data.price.amount_minor', 1234);
            $this->storeGet('offers', 'dtc.price.test')->assertOk();
            $this->storeGet('cart', 'dtc.price.test')->assertOk();
            $this->addToCart('dtc.price.test', $dtcProduct->id)->assertCreated()
                ->assertJsonPath('data.items.0.unit_price.amount_minor', 1234);
        }
    }

    #[Test]
    public function a_stray_buyer_token_header_changes_nothing_on_a_dtc_channel(): void
    {
        $this->makeStore('dtc2.price.test', false, 500, null);

        $this->storeGet('products', 'dtc2.price.test', 'garbage-token')->assertOk()->assertJsonPath('data.0.price.amount_minor', 500);
    }

    // ═══════════════════════ قناة جملة: مغلقة بالبوابة ═══════════════════════

    #[Test]
    public function a_flagged_channel_is_dark_while_the_deployment_flag_is_off_even_for_an_approved_buyer(): void
    {
        [, $token] = $this->buyer('approved@pv.test');
        config(['commerce.wholesale_buyer_enabled' => false]);

        foreach ($this->priceSurfaces() as $path) {
            $response = $this->storeGet($path, $this->host, $token);
            $response->assertNotFound();
            $this->assertStringNotContainsString('700', $response->getContent());
            $this->assertStringNotContainsString('1000', $response->getContent());
        }
        $this->addToCart($this->host, $this->product->id, $token)->assertNotFound();
        $this->withHeaders($this->headers($this->host, $token))->postJson(self::BASE.'checkout/complete', [])->assertNotFound();
    }

    // ═══════════════════════ قناة جملة: المصادقة وحدها لا تكفي ═══════════════════════

    #[Test]
    public function anonymous_requests_to_a_flagged_channel_are_unauthenticated_and_leak_no_price(): void
    {
        foreach ($this->priceSurfaces() as $path) {
            $response = $this->storeGet($path, $this->host);
            $response->assertStatus(401);
            $this->assertStringNotContainsString('700', $response->getContent());
            $this->assertStringNotContainsString('1000', $response->getContent());
        }
        $this->addToCart($this->host, $this->product->id)->assertStatus(401);
    }

    #[Test]
    public function an_authenticated_buyer_without_an_approved_membership_sees_no_price(): void
    {
        [, $none] = $this->buyer('none@pv.test', null); // pending
        [, $rejected] = $this->buyer('rej@pv.test', 'reject');

        foreach ([$none, $rejected] as $token) {
            foreach ($this->priceSurfaces() as $path) {
                $this->storeGet($path, $this->host, $token)->assertForbidden();
            }
            $this->addToCart($this->host, $this->product->id, $token)->assertForbidden();
        }
    }

    #[Test]
    public function an_approved_buyer_sees_the_channel_list_price_consistently_on_list_detail_and_cart(): void
    {
        [, $token] = $this->buyer('ok@pv.test');

        $this->storeGet('products', $this->host, $token)->assertOk()->assertJsonPath('data.0.price.amount_minor', 700);
        $this->storeGet('products/'.$this->product->id, $this->host, $token)->assertOk()->assertJsonPath('data.price.amount_minor', 700);
        $this->addToCart($this->host, $this->product->id, $token)->assertCreated()
            ->assertJsonPath('data.items.0.unit_price.amount_minor', 700);
        $this->storeGet('checkout', $this->host, $token)->assertOk();
    }

    #[Test]
    public function suspension_and_reinstatement_take_effect_on_the_same_session_immediately(): void
    {
        [, $token, $membershipId] = $this->buyer('flip@pv.test');
        $this->storeGet('products', $this->host, $token)->assertOk();

        $owner = $this->owner($this->tenant);
        app(TenantContext::class)->set($this->tenant->id);
        app(WholesaleMembershipService::class)->transition($membershipId, 'suspend', $owner);
        app(TenantContext::class)->forget();
        $this->storeGet('products', $this->host, $token)->assertForbidden();
        $this->storeGet('products/'.$this->product->id, $this->host, $token)->assertForbidden();

        app(TenantContext::class)->set($this->tenant->id);
        app(WholesaleMembershipService::class)->transition($membershipId, 'reinstate', $owner);
        app(TenantContext::class)->forget();
        $this->storeGet('products', $this->host, $token)->assertOk()->assertJsonPath('data.0.price.amount_minor', 700);
    }

    // ═══════════════════════ العزل ═══════════════════════

    #[Test]
    public function a_session_from_another_channel_or_tenant_never_unlocks_this_channel(): void
    {
        // same tenant, second flagged channel/host
        [, $channel2] = $this->makeStore('wholesale2.price.test', true, 900, 600, $this->tenant);
        [, $token2] = $this->buyer('two@pv.test', 'approve', $this->tenant, $channel2, 'wholesale2.price.test');
        $this->storeGet('products', $this->host, $token2)->assertStatus(401);       // token bound to channel 2 only
        $this->storeGet('products', 'wholesale2.price.test', $token2)->assertOk()->assertJsonPath('data.0.price.amount_minor', 600);

        // different tenant
        [$tenantB, $channelB] = $this->makeStore('wholesale3.price.test', true, 800, 500);
        [, $tokenB] = $this->buyer('three@pv.test', 'approve', $tenantB, $channelB, 'wholesale3.price.test');
        $this->storeGet('products', $this->host, $tokenB)->assertStatus(401);
        $this->storeGet('products', 'wholesale3.price.test', $tokenB)->assertOk()->assertJsonPath('data.0.price.amount_minor', 500);
    }

    #[Test]
    public function approval_on_one_channel_does_not_unlock_a_second_flagged_channel_of_the_same_tenant(): void
    {
        [, $channel2] = $this->makeStore('wholesale4.price.test', true, 900, 600, $this->tenant);
        [$identity, $token1] = $this->buyer('x@pv.test');          // approved on channel 1 only
        $token2 = $this->login('x@pv.test', 'wholesale4.price.test'); // valid session on channel 2, no membership there

        $this->storeGet('products', $this->host, $token1)->assertOk();
        $this->storeGet('products', 'wholesale4.price.test', $token2)->assertForbidden();
    }
}
