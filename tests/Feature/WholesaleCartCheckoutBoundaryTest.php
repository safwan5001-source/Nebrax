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

    /** @return array{0: string, 1: string, 2: string} [token, membership id, identity id] */
    private function approvedBuyerWithId(string $email = 'buyer@cart.test'): array
    {
        [$token, $membershipId] = $this->approvedBuyer($email);

        return [$token, $membershipId, CustomerIdentity::withoutGlobalScopes()->where('email_normalized', $email)->firstOrFail()->id];
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
        // withHeaders() is cumulative on a TestCase: start clean so a previous call's buyer token can't leak into this one
        $this->flushHeaders();
        $this->unencryptedCookies = []; // cookies are cumulative too: a previous call's cart token must not ride along
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
        // an authenticated buyer is always served THEIR OWN wholesale cart (never the DTC one the token points to):
        // every line is a wholesale-priced line (700), none is the DTC retail line (1000)
        $this->assertNotEmpty($onWs->json('data.items'));
        foreach ($onWs->json('data.items') as $line) {
            $this->assertSame(700, $line['unit_price']['amount_minor']);
        }

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
    public function the_order_and_cart_are_attributed_to_the_approved_buyer_from_the_server_side_context(): void
    {
        [$buyer, , $identityId] = $this->approvedBuyerWithId();
        $cart = $this->cookie($this->addItem(self::WS, $buyer)->assertCreated());
        $this->readyCheckout(self::WS, $buyer, $cart);
        $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-attr-1')->assertCreated();

        $order = CommerceOrder::withoutGlobalScopes()->firstOrFail();
        $this->assertSame($identityId, $order->customer_identity_id);
        $this->assertSame($this->wsChannel->id, $order->sales_channel_id);
        $this->assertNull($order->partner_id, 'no ERP partner is linked or inferred (buyer pricing is a separate contract)');
        $this->assertSame($identityId, CommerceCart::withoutGlobalScopes()->firstOrFail()->customer_identity_id);
    }

    #[Test]
    public function a_cart_token_is_useless_to_any_other_bearer_even_another_approved_buyer(): void
    {
        [$buyerA] = $this->approvedBuyer('a@cart.test');
        [$buyerB] = $this->approvedBuyer('b@cart.test');
        $cartA = $this->cookie($this->addItem(self::WS, $buyerA)->assertCreated());

        // B presents A's cart token: it resolves to B's own (empty) cart, never A's
        $this->assertSame([], $this->api('GET', 'cart', self::WS, $buyerB, $cartA)->assertOk()->json('data.items'));
        // anonymous with A's token: gated before any cart is touched
        $this->api('GET', 'cart', self::WS, null, $cartA)->assertUnauthorized();
        $this->assertSame(1, count($this->api('GET', 'cart', self::WS, $buyerA, $cartA)->json('data.items')));
    }

    #[Test]
    public function client_supplied_buyer_or_partner_ids_never_become_the_orders_owner(): void
    {
        [$buyer, , $identityId] = $this->approvedBuyerWithId();
        $cart = $this->cookie($this->addItem(self::WS, $buyer)->assertCreated());
        $this->readyCheckout(self::WS, $buyer, $cart);

        $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [
            'customer_identity_id' => (string) Str::uuid(), 'partner_id' => (string) Str::uuid(), 'tenant_id' => (string) Str::uuid(),
        ], 'idem-forge')->assertStatus(422);

        $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-forge-2')->assertCreated();
        $this->assertSame($identityId, CommerceOrder::withoutGlobalScopes()->firstOrFail()->customer_identity_id);
    }

    #[Test]
    public function the_order_transaction_itself_refuses_a_buyer_who_is_no_longer_approved(): void
    {
        [, $membershipId, $identityId] = $this->approvedBuyerWithId();
        $this->suspend($membershipId);

        app(TenantContext::class)->set($this->tenant->id);
        app(\App\Tenancy\CustomerContext::class)->set($this->tenant->id, $identityId, null);
        $header = ['sales_channel_id' => $this->wsChannel->id, 'storefront_id' => null, 'commerce_checkout_id' => null, 'delivery_method' => 'pickup', 'delivery_amount_minor' => 0];
        $lines = [['product_id' => $this->product->id, 'product_name_snapshot' => 'x', 'quantity' => 1, 'unit_name' => null, 'unit_factor' => 1, 'unit_price' => 700, 'line_total' => 700]];

        try {
            app(\App\Services\Commerce\CommerceOrderService::class)->createFromCheckout($header, $lines);
            $this->fail('a suspended buyer must not get an order even if the request-level gate was bypassed');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('مشترياً معتمداً', $e->getMessage());
        } finally {
            app(\App\Tenancy\CustomerContext::class)->forget();
        }
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());

        // and a guest (no owner) can never create an order on a wholesale channel
        $this->expectException(\RuntimeException::class);
        app(\App\Services\Commerce\CommerceOrderService::class)->createFromCheckout($header, $lines);
    }

    #[Test]
    public function an_orders_owner_is_immutable_and_guest_orders_are_never_claimed_later(): void
    {
        [$buyer, , $identityId] = $this->approvedBuyerWithId();
        $cart = $this->cookie($this->addItem(self::WS, $buyer)->assertCreated());
        $this->readyCheckout(self::WS, $buyer, $cart);
        $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-imm')->assertCreated();

        // a guest order on the DTC host
        $dtcCart = $this->cookie($this->addItem(self::DTC, null)->assertCreated());
        $this->readyCheckout(self::DTC, null, $dtcCart);
        $this->api('POST', 'checkout/complete', self::DTC, null, $dtcCart, [], 'idem-guest')->assertCreated();

        app(TenantContext::class)->set($this->tenant->id);
        $attributed = CommerceOrder::query()->where('sales_channel_id', $this->wsChannel->id)->firstOrFail();
        $guest = CommerceOrder::query()->where('sales_channel_id', $this->dtcChannel->id)->firstOrFail();
        $this->assertNull($guest->customer_identity_id, 'DTC guest orders stay guest orders');

        foreach ([[$attributed, null], [$attributed, (string) Str::uuid()], [$guest, $identityId]] as [$order, $to]) {
            try {
                $order->update(['customer_identity_id' => $to]);
                $this->fail('the owner of an order must not be rewritten or back-filled');
            } catch (\LogicException) {
                $this->addToAssertionCount(1);
            }
        }
        app(TenantContext::class)->forget();
    }

    #[Test]
    public function a_buyer_token_on_a_dtc_host_does_not_attribute_a_dtc_order(): void
    {
        [$buyer] = $this->approvedBuyer();
        $dtcCart = $this->cookie($this->addItem(self::DTC, $buyer)->assertCreated());
        $this->readyCheckout(self::DTC, $buyer, $dtcCart);
        $this->api('POST', 'checkout/complete', self::DTC, $buyer, $dtcCart, [], 'idem-dtc-buyer')->assertCreated();

        $order = CommerceOrder::withoutGlobalScopes()->where('sales_channel_id', $this->dtcChannel->id)->firstOrFail();
        $this->assertNull($order->customer_identity_id, 'DTC behaviour is unchanged: store/v1 DTC checkout stays anonymous');
    }

    #[Test]
    public function a_suspension_blocks_every_cart_boundary_and_a_reinstatement_restores_the_same_cart(): void
    {
        [$buyer, $membershipId] = $this->approvedBuyer();
        $cart = $this->cookie($this->addItem(self::WS, $buyer)->assertCreated());

        $this->suspend($membershipId);
        $this->api('GET', 'cart', self::WS, $buyer, $cart)->assertForbidden();
        $this->addItem(self::WS, $buyer, $cart)->assertForbidden();
        $this->api('GET', 'products', self::WS, $buyer, null)->assertForbidden();

        // the stored cart is untouched (held, not destroyed) and returns on reinstatement
        $this->assertSame(1, CommerceCart::withoutGlobalScopes()->where('status', 'active')->count());
        app(TenantContext::class)->set($this->tenant->id);
        $owner = User::query()->where('role', 'owner')->firstOrFail();
        app(WholesaleMembershipService::class)->transition($membershipId, 'reinstate', $owner);
        app(TenantContext::class)->forget();

        $items = $this->api('GET', 'cart', self::WS, $buyer, $cart)->assertOk()->json('data.items');
        $this->assertCount(1, $items);
        $this->assertSame(2, $items[0]['quantity']);
        $this->assertSame(700, $items[0]['unit_price']['amount_minor']);
    }

    #[Test]
    public function characterization_a_linked_partner_price_list_does_not_change_wholesale_prices_today(): void
    {
        // CONTRACT PIN (Batch H §P1): identity ⇢ active CustomerPartnerLink ⇢ Partner.default_price_list exists in the
        // data model, but NO storefront path passes a partner to the price resolver. Buyer-specific pricing is not
        // active; this test fails the day it silently becomes so (it must be a reviewed decision with its own tests).
        [$buyer, , $identityId] = $this->approvedBuyerWithId();

        app(TenantContext::class)->set($this->tenant->id);
        $partnerList = PriceList::create(['name' => 'Partner '.Str::random(4), 'is_active' => true]);
        app(PriceListService::class)->upsertItem($partnerList, $this->product, ['price' => 500]);
        $partner = \App\Models\Partner::create(['name' => 'عميل جملة', 'type' => 'customer', 'default_price_list_id' => $partnerList->id]);
        $owner = User::query()->where('role', 'owner')->firstOrFail();
        app(\App\Services\CustomerPartnerLinkService::class)->link(CustomerIdentity::query()->findOrFail($identityId), $partner, $owner);
        app(TenantContext::class)->forget();

        $this->assertSame(700, $this->api('GET', 'products', self::WS, $buyer, null)->assertOk()->json('data.0.price.amount_minor'));
        $this->assertSame(700, $this->api('GET', 'products/'.$this->product->id, self::WS, $buyer, null)->assertOk()->json('data.price.amount_minor'));
        $this->assertSame(700, $this->addItem(self::WS, $buyer)->assertCreated()->json('data.items.0.unit_price.amount_minor'));
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
