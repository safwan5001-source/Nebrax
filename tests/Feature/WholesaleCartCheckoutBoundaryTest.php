<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderLine;
use App\Models\CustomerIdentity;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\WholesaleMembershipService;
use App\Services\PriceListService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch G — هل يصلح سلة/إتمام AWJ تحت قناة الجملة؟ (تقييم بالأدلة)
 * ═══════════════════════════════════════════════════════════════
 *  القسم A يثبت المتغيّرات الأمنية والسعرية التي **تتحقق فعلاً** (ربط القناة بالمضيف، عضوية معتمدة في كل طلب، سعر الخادم،
 *  إعادة التحقق عند الإتمام، تسجيل مصدر السعر، عدم خلط عربات القنوات). القسم B يوثّق بالاختبار **الفجوات** التي تمنع تفعيل
 *  الإتمام للجملة — ولا يُنشئ محوّلاً ولا يتجاوزها: اختبارات القسم B تُثبّت السلوك الحالي كي يتغيّر قرارٌ صريح لا صدفة.
 */
class WholesaleCartCheckoutBoundaryTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'ws-cart-gateway-secret';

    private const INTERNAL = 'http://laravel-internal.test/store/v1/';

    private const WS = 'wholesale.cart.test';

    private const DTC = 'retail.cart.test';

    private Tenant $tenant;

    private SalesChannel $wsChannel;

    private SalesChannel $dtcChannel;

    private Product $product;

    private PriceList $list;

    protected function setUp(): void
    {
        parent::setUp();
        config(['commerce.wholesale_buyer_enabled' => true, 'storefront.gateway_secret' => self::SECRET]);

        $this->tenant = Tenant::create([
            'name' => 'ws-cart', 'slug' => 'wsc-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($this->tenant->id);

        $this->wsChannel = $this->web(self::WS, wholesale: true);
        $this->dtcChannel = $this->web(self::DTC, wholesale: false);

        $this->product = Product::create(['name' => 'صنف جملة', 'sku' => 'WSC-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 1000, 'is_active' => true]);
        foreach ([$this->wsChannel, $this->dtcChannel] as $channel) {
            CommerceListing::create(['product_id' => $this->product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        }
        $this->list = PriceList::create(['name' => 'Wholesale '.Str::random(4), 'is_active' => true]);
        app(PriceListService::class)->upsertItem($this->list, $this->product, ['price' => 700]);
        $this->wsChannel->update(['default_price_list_id' => $this->list->id]);
        app(TenantContext::class)->forget();
    }

    private function web(string $host, bool $wholesale): SalesChannel
    {
        $channel = SalesChannel::create(['slug' => 'c-'.Str::random(5), 'name' => $host, 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        if ($wholesale) {
            $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        }
        $storefront = Storefront::create(['slug' => 's-'.Str::random(5), 'name' => $host, 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);

        return $channel;
    }

    /** @return array{0: string, 1: string} [buyer token, membership id] — an APPROVED buyer on the wholesale host. */
    private function approvedBuyer(string $email = 'buyer@cart.test'): array
    {
        app(TenantContext::class)->set($this->tenant->id);
        $identity = CustomerIdentity::create([
            'tenant_id' => $this->tenant->id, 'display_name' => 'Buyer', 'email' => $email, 'password' => 'correct-horse-9',
            'email_verified_at' => now(), 'is_active' => true,
        ]);
        $owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'owner', 'email' => 'o-'.Str::random(6).'@s.test', 'password' => 'password123', 'role' => 'owner']);
        $membership = app(WholesaleMembershipService::class)->apply($identity, $this->wsChannel->id);
        app(WholesaleMembershipService::class)->transition($membership->id, 'approve', $owner);
        app(TenantContext::class)->forget();

        $token = (string) $this->withHeaders($this->headers(self::WS))
            ->postJson(self::INTERNAL.'auth/login', ['email' => $email, 'password' => 'correct-horse-9'])
            ->assertOk()->json('data.token');

        return [$token, $membership->id];
    }

    private function suspend(string $membershipId): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $owner = User::query()->where('role', 'owner')->firstOrFail();
        app(WholesaleMembershipService::class)->transition($membershipId, 'suspend', $owner);
        app(TenantContext::class)->forget();
    }

    private function headers(string $host, ?string $buyer = null, ?string $cartToken = null, ?string $idem = null): array
    {
        $h = ['X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET];
        if ($buyer !== null) {
            $h['X-Customer-Token'] = $buyer;
        }
        if ($idem !== null) {
            $h['Idempotency-Key'] = $idem;
        }

        return $h;
    }

    private function api(string $method, string $path, string $host, ?string $buyer, ?string $cart, array $body = [], ?string $idem = null): TestResponse
    {
        $t = $this->withHeaders($this->headers($host, $buyer, null, $idem))->withCredentials();
        if ($cart !== null) {
            $t = $t->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $cart);
        }

        return $t->json($method, self::INTERNAL.$path, $body);
    }

    private function addItem(string $host, ?string $buyer, ?string $cart = null): TestResponse
    {
        return $this->api('POST', 'cart/items', $host, $buyer, $cart, ['product_id' => $this->product->id, 'quantity' => 2, 'unit_key' => 'base']);
    }

    private function cookie(TestResponse $r): string
    {
        return $r->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
    }

    /** Drives contact/address/delivery for a created checkout. */
    private function readyCheckout(string $host, ?string $buyer, string $cart): void
    {
        $this->api('POST', 'checkout', $host, $buyer, $cart)->assertCreated();
        $this->api('PATCH', 'checkout/contact', $host, $buyer, $cart, ['name' => 'سالم', 'phone' => '0501234567', 'email' => 's@example.com'])->assertOk();
        $this->api('PATCH', 'checkout/address', $host, $buyer, $cart, ['country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ', 'street' => 'الملك فهد', 'postal_code' => '31411'])->assertOk();
        $this->api('PATCH', 'checkout/delivery', $host, $buyer, $cart, ['method' => 'pickup'])->assertOk();
    }

    // ═══════════════════ A · ما يتحقق فعلاً ═══════════════════

    #[Test]
    public function a_approved_buyer_cart_and_order_use_the_server_resolved_list_price_and_record_its_source(): void
    {
        [$buyer] = $this->approvedBuyer();

        $add = $this->addItem(self::WS, $buyer)->assertCreated();
        $add->assertJsonPath('data.items.0.unit_price.amount_minor', 700);
        $cart = $this->cookie($add);

        $this->readyCheckout(self::WS, $buyer, $cart);
        $done = $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-ws-1')->assertCreated();
        $done->assertJsonPath('data.order.total.amount_minor', 1400);

        $line = CommerceOrderLine::withoutGlobalScopes()->firstOrFail();
        $this->assertSame(700, $line->unit_price);
        $this->assertSame('price_list', $line->price_source);
        $this->assertSame($this->list->id, $line->price_list_id);
        $this->assertSame($this->wsChannel->id, CommerceOrder::withoutGlobalScopes()->firstOrFail()->sales_channel_id);
    }

    #[Test]
    public function a_price_in_the_request_is_never_trusted(): void
    {
        [$buyer] = $this->approvedBuyer();

        $r = $this->api('POST', 'cart/items', self::WS, $buyer, null, [
            'product_id' => $this->product->id, 'quantity' => 1, 'unit_key' => 'base', 'unit_price' => 1,
        ]);

        // either rejected outright or ignored — it can never become the price
        if ($r->getStatusCode() === 201) {
            $r->assertJsonPath('data.items.0.unit_price.amount_minor', 700);
        } else {
            $this->assertSame(422, $r->getStatusCode());
        }
    }

    #[Test]
    public function completion_revalidates_the_price_against_the_current_list(): void
    {
        [$buyer] = $this->approvedBuyer();
        $cart = $this->cookie($this->addItem(self::WS, $buyer)->assertCreated());
        $this->readyCheckout(self::WS, $buyer, $cart);

        // staff re-prices the list between add-to-cart and completion
        app(TenantContext::class)->set($this->tenant->id);
        app(PriceListService::class)->upsertItem($this->list, $this->product, ['price' => 650]);
        app(TenantContext::class)->forget();

        $done = $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-ws-2')->assertCreated();
        $done->assertJsonPath('data.order.total.amount_minor', 1300);
        $this->assertSame(650, CommerceOrderLine::withoutGlobalScopes()->firstOrFail()->unit_price);
    }

    #[Test]
    public function membership_is_rechecked_on_every_cart_and_checkout_request_so_a_suspension_stops_an_in_flight_order(): void
    {
        [$buyer, $membershipId] = $this->approvedBuyer();
        $cart = $this->cookie($this->addItem(self::WS, $buyer)->assertCreated());
        $this->readyCheckout(self::WS, $buyer, $cart);

        $this->suspend($membershipId);

        $this->api('GET', 'cart', self::WS, $buyer, $cart)->assertForbidden();
        $this->api('GET', 'checkout', self::WS, $buyer, $cart)->assertForbidden();
        $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-ws-3')->assertForbidden();
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count(), 'no order is created for a suspended buyer');
    }

    #[Test]
    public function an_anonymous_visitor_never_gets_a_wholesale_cart_or_a_dtc_fallback_cart(): void
    {
        $this->addItem(self::WS, null)->assertUnauthorized();
        $this->api('GET', 'cart', self::WS, null, null)->assertUnauthorized();
        $this->assertSame(0, CommerceCart::withoutGlobalScopes()->count(), 'no cart (wholesale or otherwise) is created');
    }

    #[Test]
    public function a_cart_token_never_crosses_channels_in_either_direction(): void
    {
        [$buyer] = $this->approvedBuyer();

        $wsCart = $this->cookie($this->addItem(self::WS, $buyer)->assertCreated());
        $dtcCart = $this->cookie($this->addItem(self::DTC, null)->assertCreated());
        $this->assertNotSame($wsCart, $dtcCart);

        // the wholesale cart token on the DTC host: not that cart (empty/fresh), and prices stay DTC
        $onDtc = $this->api('GET', 'cart', self::DTC, null, $wsCart)->assertOk();
        $this->assertSame([], $onDtc->json('data.items'));

        // the DTC cart token on the wholesale host: not that cart either — and it does not leak DTC retail items
        $onWs = $this->api('GET', 'cart', self::WS, $buyer, $dtcCart)->assertOk();
        $this->assertSame([], $onWs->json('data.items'));

        // each channel's cart row is bound to its own channel
        $channels = CommerceCart::withoutGlobalScopes()->pluck('sales_channel_id')->sort()->values()->all();
        $this->assertSame(collect([$this->wsChannel->id, $this->dtcChannel->id])->sort()->values()->all(), $channels);
    }

    #[Test]
    public function the_same_checkout_completion_is_idempotent_and_creates_one_order(): void
    {
        [$buyer] = $this->approvedBuyer();
        $cart = $this->cookie($this->addItem(self::WS, $buyer)->assertCreated());
        $this->readyCheckout(self::WS, $buyer, $cart);

        $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-same')->assertCreated();
        $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-same')->assertStatus(200)->assertJsonPath('data.replayed', true);

        $this->assertSame(1, CommerceOrder::withoutGlobalScopes()->count());
    }

    // ═══════════════════ B · الفجوات (تمنع تفعيل الإتمام للجملة) ═══════════════════

    #[Test]
    public function blocker_the_order_is_not_attributed_to_the_approved_buyer(): void
    {
        [$buyer] = $this->approvedBuyer();
        $cart = $this->cookie($this->addItem(self::WS, $buyer)->assertCreated());
        $this->readyCheckout(self::WS, $buyer, $cart);
        $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-blk-1')->assertCreated();

        $order = CommerceOrder::withoutGlobalScopes()->firstOrFail();
        // store/v1 checkout is anonymous by design (ADR-24): approval is proven per request but never recorded on the order.
        $this->assertNull($order->customer_identity_id, 'BLOCKER: wholesale orders carry no buyer identity');
        $this->assertNull($order->partner_id, 'BLOCKER: no linked ERP partner / per-buyer price list');
    }

    #[Test]
    public function blocker_the_cart_and_checkout_contracts_carry_no_tax_minimum_or_terms_fields(): void
    {
        [$buyer] = $this->approvedBuyer();
        $add = $this->addItem(self::WS, $buyer)->assertCreated();
        $cart = $this->cookie($add);
        $checkout = $this->api('POST', 'checkout', self::WS, $buyer, $cart)->assertCreated();

        $payload = strtolower(json_encode([$add->json('data'), $checkout->json('data')]));
        foreach (['tax', 'vat', 'minimum', 'min_order', 'moq', 'multiple', 'terms', 'credit', 'net_'] as $needle) {
            $this->assertStringNotContainsString($needle, $payload, "BLOCKER: no `{$needle}` contract on cart/checkout");
        }
    }
}
