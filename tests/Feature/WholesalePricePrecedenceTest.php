<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderLine;
use App\Models\CommercePaymentIntent;
use App\Models\CustomerIdentity;
use App\Models\Partner;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\ResolvedCommercePrice;
use App\Services\Commerce\WholesaleMembershipService;
use App\Services\CustomerPartnerLinkService;
use App\Services\PriceListService;
use App\Tenancy\CustomerContext;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch J — أسبقية تسعير الجملة المعتمدة، فشلاً مغلقاً
 * ═══════════════════════════════════════════════════════════════
 *  القرار المعتمد (بالترتيب، لكل سطر):
 *    1. عنصر قائمة سعر الشريك المرتبط بالمشتري المعتمد (قائمة نشطة صالحة)
 *    2. عنصر قائمة سعر قناة الجملة (نشطة)
 *    3. وإلا ⇒ «غير متاح للجملة» — **لا** سعر المنتج الأساسي/التجزئة أبداً.
 *  يُغطّى هنا: الأسبقية والرجوع الجزئي، الاتساق بين القائمة/التفصيل/البحث/الفرز/السلة/الإتمام، الحالات السلبية المطلوبة
 *  (سعر مفقود، قائمة منتهية/معطّلة، مشترٍ موقوف، عضوية/قائمة عابرة للمستأجر والقناة، جلسة ملغاة، تجاوز سعر من المتصفح،
 *  تغيير القائمة بين السلة والإتمام)، بصمة المصدر على سطر الطلب، وتوافق DTC.
 *
 *  أسعار الحالة الأساسية (هللات): بيع التجزئة 1000 لكل منتج. P1: شريك 500 / قناة 700. P2: قناة 900 فقط. P3: لا قائمة.
 */
class WholesalePricePrecedenceTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'wholesale-precedence-secret';

    private const INTERNAL = 'http://laravel-internal.test/store/v1/';

    private const WS = 'prec.wholesale.test';

    private const WS2 = 'prec2.wholesale.test';

    private const DTC = 'prec.retail.test';

    private Tenant $tenant;

    private SalesChannel $ws;

    private SalesChannel $ws2;

    private SalesChannel $dtc;

    private Product $p1;

    private Product $p2;

    private Product $p3;

    private PriceList $channelList;

    private PriceList $partnerList;

    private Partner $partner;

    protected function setUp(): void
    {
        parent::setUp();
        config(['commerce.wholesale_buyer_enabled' => true, 'storefront.gateway_secret' => self::SECRET]);

        $this->tenant = Tenant::create([
            'name' => 'prec', 'slug' => 'prec-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($this->tenant->id);

        $this->ws = $this->web(self::WS, wholesale: true);
        $this->ws2 = $this->web(self::WS2, wholesale: true);
        $this->dtc = $this->web(self::DTC, wholesale: false);

        $this->p1 = $this->product('P1');
        $this->p2 = $this->product('P2');
        $this->p3 = $this->product('P3');
        foreach ([$this->ws, $this->ws2, $this->dtc] as $channel) {
            foreach ([$this->p1, $this->p2, $this->p3] as $product) {
                CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
            }
        }

        $this->channelList = $this->priceList('wholesale-channel', [[$this->p1, 700], [$this->p2, 900]]);
        $this->ws->update(['default_price_list_id' => $this->channelList->id]);

        $this->partnerList = $this->priceList('partner', [[$this->p1, 500]]);
        $this->partner = Partner::create(['name' => 'عميل', 'type' => 'customer', 'default_price_list_id' => $this->partnerList->id]);
        app(TenantContext::class)->forget();
    }

    // ───────────────────────────── helpers ─────────────────────────────

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

    private function product(string $name): Product
    {
        return Product::create(['name' => $name, 'sku' => $name.'-'.Str::random(5), 'unit' => 'piece', 'sale_price' => 1000, 'is_active' => true]);
    }

    /** @param list<array{0: Product, 1: int}> $items */
    private function priceList(string $name, array $items): PriceList
    {
        $list = PriceList::create(['name' => $name.'-'.Str::random(4), 'is_active' => true]);
        foreach ($items as [$product, $price]) {
            app(PriceListService::class)->upsertItem($list, $product, ['price' => $price]);
        }

        return $list;
    }

    /** @return array{0: string, 1: string, 2: string} [token, membership id, identity id] — an APPROVED buyer, optionally linked to the partner. */
    private function buyer(string $email = 'buyer@prec.test', bool $linked = true, ?SalesChannel $channel = null, string $host = self::WS): array
    {
        $channel ??= $this->ws;
        app(TenantContext::class)->set($this->tenant->id);
        $identity = CustomerIdentity::create([
            'tenant_id' => $this->tenant->id, 'display_name' => 'Buyer', 'email' => $email, 'password' => 'correct-horse-9',
            'email_verified_at' => now(), 'is_active' => true,
        ]);
        $owner = User::query()->where('role', 'owner')->first()
            ?? User::create(['tenant_id' => $this->tenant->id, 'name' => 'owner', 'email' => 'o-'.Str::random(6).'@s.test', 'password' => 'password123', 'role' => 'owner']);
        $membership = app(WholesaleMembershipService::class)->apply($identity, $channel->id);
        app(WholesaleMembershipService::class)->transition($membership->id, 'approve', $owner);
        if ($linked) {
            app(CustomerPartnerLinkService::class)->link($identity, $this->partner, $owner);
        }
        app(TenantContext::class)->forget();

        $token = (string) $this->withHeaders(['X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET])
            ->postJson(self::INTERNAL.'auth/login', ['email' => $email, 'password' => 'correct-horse-9'])
            ->assertOk()->json('data.token');

        return [$token, $membership->id, $identity->id];
    }

    private function api(string $method, string $path, string $host, ?string $buyer, ?string $cart = null, array $body = [], ?string $idem = null): TestResponse
    {
        // withHeaders()/cookies accumulate on a TestCase: start clean so nothing from a previous call rides along
        $this->flushHeaders();
        $this->unencryptedCookies = [];
        $headers = ['X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET];
        if ($buyer !== null) {
            $headers['X-Customer-Token'] = $buyer;
        }
        if ($idem !== null) {
            $headers['Idempotency-Key'] = $idem;
        }
        $t = $this->withHeaders($headers)->withCredentials();
        if ($cart !== null) {
            $t = $t->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $cart);
        }

        return $t->json($method, self::INTERNAL.$path, $body);
    }

    /** @return array<string, array<string, mixed>> name => product row */
    private function listing(string $host, ?string $buyer, string $query = ''): array
    {
        $rows = $this->api('GET', 'products'.$query, $host, $buyer)->assertOk()->json('data');

        return collect($rows)->keyBy('name')->all();
    }

    /** @return list<string> product names in listing order */
    private function order(string $host, ?string $buyer, string $query): array
    {
        return array_column($this->api('GET', 'products'.$query, $host, $buyer)->assertOk()->json('data'), 'name');
    }

    private function cookie(TestResponse $r): string
    {
        return $r->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
    }

    private function add(string $host, ?string $buyer, Product $product, ?string $cart = null, int $quantity = 1): TestResponse
    {
        return $this->api('POST', 'cart/items', $host, $buyer, $cart, ['product_id' => $product->id, 'quantity' => $quantity, 'unit_key' => 'base']);
    }

    private function readyCheckout(string $host, string $buyer, string $cart): void
    {
        $this->api('POST', 'checkout', $host, $buyer, $cart)->assertCreated();
        $this->api('PATCH', 'checkout/contact', $host, $buyer, $cart, ['name' => 'سالم', 'phone' => '0501234567', 'email' => 's@example.com'])->assertOk();
        $this->api('PATCH', 'checkout/address', $host, $buyer, $cart, ['country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ', 'street' => 'الملك فهد', 'postal_code' => '31411'])->assertOk();
        $this->api('PATCH', 'checkout/delivery', $host, $buyer, $cart, ['method' => 'pickup'])->assertOk();
    }

    private function inCtx(callable $fn): mixed
    {
        app(TenantContext::class)->set($this->tenant->id);
        try {
            return $fn();
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    private function deactivate(PriceList $list): void
    {
        DB::table('price_lists')->where('id', $list->id)->update(['is_active' => false]);
    }

    private function amount(array $row): ?int
    {
        return $row['price']['amount_minor'] ?? null;
    }

    // ═══════════════════ 1 · الأسبقية: شريك ← قناة ← غير متاح ═══════════════════

    #[Test]
    public function the_partner_list_wins_then_the_channel_list_then_the_item_is_unavailable_never_retail(): void
    {
        [$buyer] = $this->buyer();

        $rows = $this->listing(self::WS, $buyer);

        $this->assertSame(500, $this->amount($rows['P1']), 'P1: the partner list item');
        $this->assertSame(900, $this->amount($rows['P2']), 'P2: the partner list lacks it ⇒ falls to the channel list');
        $this->assertNull($rows['P3']['price'], 'P3: no eligible entry ⇒ NO price, not the 1000 retail price');
        $this->assertSame('available', $rows['P1']['wholesale_availability']['state']);
        $this->assertSame('available', $rows['P2']['wholesale_availability']['state']);
        $this->assertSame('unavailable_for_wholesale', $rows['P3']['wholesale_availability']['state']);
        $this->assertStringNotContainsString('1000', json_encode($rows), 'the retail amount appears nowhere in a wholesale listing');
    }

    #[Test]
    public function a_buyer_without_a_partner_link_is_priced_by_the_channel_list_only(): void
    {
        [$buyer] = $this->buyer(linked: false);

        $rows = $this->listing(self::WS, $buyer);

        $this->assertSame(700, $this->amount($rows['P1']));
        $this->assertSame(900, $this->amount($rows['P2']));
        $this->assertNull($rows['P3']['price']);
    }

    #[Test]
    public function no_valid_list_at_all_makes_every_item_unavailable(): void
    {
        [$buyer] = $this->buyer(linked: false);
        $this->deactivate($this->channelList);

        $rows = $this->listing(self::WS, $buyer);

        foreach (['P1', 'P2', 'P3'] as $name) {
            $this->assertNull($rows[$name]['price'], "{$name} must not fall back to retail");
            $this->assertSame('unavailable_for_wholesale', $rows[$name]['wholesale_availability']['state']);
        }
        $this->add(self::WS, $buyer, $this->p1)->assertStatus(422);
        $this->assertSame(0, \App\Models\CommerceCartItem::withoutGlobalScopes()->count(), 'no cart line was created');
    }

    #[Test]
    public function an_inactive_or_expired_partner_list_falls_through_to_the_channel_list(): void
    {
        [$buyer] = $this->buyer();
        $this->deactivate($this->partnerList);

        $rows = $this->listing(self::WS, $buyer);

        $this->assertSame(700, $this->amount($rows['P1']), 'an inactive (the only form of "expired") partner list is ignored');
        $this->assertSame(900, $this->amount($rows['P2']));
        $this->assertNull($rows['P3']['price']);
    }

    #[Test]
    public function an_inactive_channel_list_never_degrades_to_retail_but_the_partner_list_still_prices(): void
    {
        [$buyer] = $this->buyer();
        $this->deactivate($this->channelList);

        $rows = $this->listing(self::WS, $buyer);

        $this->assertSame(500, $this->amount($rows['P1']), 'valid partner list item still applies');
        $this->assertNull($rows['P2']['price'], 'P2 only existed in the (now inactive) channel list ⇒ unavailable, NOT 1000');
        $this->assertNull($rows['P3']['price']);
    }

    #[Test]
    public function a_revoked_link_or_a_non_customer_or_inactive_partner_stops_the_partner_tier(): void
    {
        [$buyer, , $identityId] = $this->buyer();
        $this->assertSame(500, $this->amount($this->listing(self::WS, $buyer)['P1']));

        // inactive partner
        DB::table('partners')->where('id', $this->partner->id)->update(['is_active' => false]);
        $this->assertSame(700, $this->amount($this->listing(self::WS, $buyer)['P1']), 'inactive partner ⇒ channel list');
        DB::table('partners')->where('id', $this->partner->id)->update(['is_active' => true, 'type' => 'supplier']);
        $this->assertSame(700, $this->amount($this->listing(self::WS, $buyer)['P1']), 'a supplier-only partner is not a customer ⇒ channel list');
        DB::table('partners')->where('id', $this->partner->id)->update(['type' => 'customer']);
        $this->assertSame(500, $this->amount($this->listing(self::WS, $buyer)['P1']), 'restored');

        // revoked link
        DB::table('customer_partner_links')->where('customer_identity_id', $identityId)->update(['status' => 'revoked']);
        $this->assertSame(700, $this->amount($this->listing(self::WS, $buyer)['P1']), 'revoked link ⇒ channel list');
    }

    #[Test]
    public function the_partner_tier_does_not_depend_on_the_pos_customer_price_list_setting(): void
    {
        // Owner decision D-B2: the wholesale partner tier is NOT gated by the POS toggle, and POS keeps its own behaviour.
        [$buyer] = $this->buyer();
        $this->inCtx(function (): void {
            $settings = $this->tenant->fresh()->settings ?? [];
            $settings['sales_config']['pos']['apply_customer_price_list'] = false;
            $this->tenant->forceFill(['settings' => $settings])->save();
        });

        $this->assertSame(500, $this->amount($this->listing(self::WS, $buyer)['P1']));
        $this->inCtx(fn () => $this->assertNull(app(\App\Services\Accounting\PosCustomerPriceListResolver::class)->forPartner($this->partner->id), 'POS is untouched: with its toggle off it still ignores the partner list'));
    }

    // ═══════════════════ 2 · الاتساق: قائمة / تفاصيل / بحث / فرز / سلة ═══════════════════

    #[Test]
    public function listing_detail_search_and_cart_agree_per_product(): void
    {
        [$buyer] = $this->buyer();
        $expected = ['P1' => 500, 'P2' => 900, 'P3' => null];
        $products = ['P1' => $this->p1, 'P2' => $this->p2, 'P3' => $this->p3];

        foreach ($expected as $name => $amount) {
            $detail = $this->api('GET', 'products/'.$products[$name]->id, self::WS, $buyer)->assertOk()->json('data');
            $this->assertSame($amount, $this->amount($detail), "{$name} detail");
            $this->assertSame($amount === null ? 'unavailable_for_wholesale' : 'available', $detail['wholesale_availability']['state']);

            $searched = $this->listing(self::WS, $buyer, '?search='.$name);
            $this->assertSame($amount, $this->amount($searched[$name]), "{$name} search result");

            $cart = $this->add(self::WS, $buyer, $products[$name]);
            if ($amount === null) {
                $cart->assertStatus(422);
            } else {
                $cart->assertSuccessful();
                $line = collect($cart->json('data.items'))->firstWhere('product_id', $products[$name]->id);
                $this->assertSame($amount, $line['unit_price']['amount_minor'], "{$name} cart");
                $this->api('DELETE', 'cart/items/'.$line['id'], self::WS, $buyer, $this->cookie($cart))->assertOk();
            }
        }
    }

    #[Test]
    public function price_sort_follows_the_displayed_precedence_and_puts_unavailable_items_last_in_both_directions(): void
    {
        [$buyer] = $this->buyer();

        $this->assertSame(['P1', 'P2', 'P3'], $this->order(self::WS, $buyer, '?sort=sale_price'), '500, 900, then unavailable');
        $this->assertSame(['P2', 'P1', 'P3'], $this->order(self::WS, $buyer, '?sort=-sale_price'), '900, 500, then unavailable — still last');
    }

    #[Test]
    public function sort_for_a_buyer_without_a_partner_link_uses_the_channel_tier_alone(): void
    {
        [$buyer] = $this->buyer(linked: false);

        $this->assertSame(['P1', 'P2', 'P3'], $this->order(self::WS, $buyer, '?sort=sale_price'));
        $this->assertSame(['P2', 'P1', 'P3'], $this->order(self::WS, $buyer, '?sort=-sale_price'));
    }

    #[Test]
    public function sort_and_pagination_stay_exact_with_unavailable_items(): void
    {
        [$buyer] = $this->buyer();

        $page1 = $this->api('GET', 'products?sort=sale_price&per_page=2', self::WS, $buyer)->assertOk();
        $page2 = $this->api('GET', 'products?sort=sale_price&per_page=2&page=2', self::WS, $buyer)->assertOk();

        $this->assertSame(['P1', 'P2'], array_column($page1->json('data'), 'name'));
        $this->assertSame(['P3'], array_column($page2->json('data'), 'name'));
        $this->assertSame(3, $page1->json('meta.pagination.total'));
    }

    #[Test]
    public function a_variant_managed_product_is_available_only_when_a_variant_has_an_eligible_entry(): void
    {
        [$buyer] = $this->buyer();
        $vm = $this->inCtx(function (): Product {
            $product = $this->product('VM');
            DB::table('products')->where('id', $product->id)->update(['variant_state' => 'variant_managed']);
            foreach ([$this->ws] as $channel) {
                CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
            }

            return $product;
        });

        $this->assertNull($this->listing(self::WS, $buyer)['VM']['price'], 'no variant entry in any eligible list ⇒ unavailable');
        $this->assertSame('unavailable_for_wholesale', $this->listing(self::WS, $buyer)['VM']['wholesale_availability']['state']);

        $variantId = $this->inCtx(function () use ($vm): string {
            $variant = \App\Models\ProductVariant::create(['product_id' => $vm->id, 'sku' => 'VM-1-'.Str::random(4), 'combination_key' => 'k-'.Str::random(6), 'is_active' => true]);
            \App\Models\PriceListItem::create(['price_list_id' => $this->channelList->id, 'product_id' => $vm->id, 'product_variant_id' => $variant->id, 'unit_name' => $vm->unit, 'price' => 640]);

            return $variant->id;
        });

        $row = $this->listing(self::WS, $buyer)['VM'];
        $this->assertSame('available', $row['wholesale_availability']['state']);
        $this->assertSame(0, $this->amount($row), 'the listing keeps its historical 0 for variant-managed products');
        $this->assertSame(['VM', 'P1', 'P2', 'P3'], $this->order(self::WS, $buyer, '?sort=sale_price'), 'variant-managed sorts as the 0 its row displays; unavailable P3 last');

        $detail = $this->api('GET', 'products/'.$vm->id, self::WS, $buyer)->assertOk()->json('data');
        $this->assertSame(640, $detail['variants'][0]['price']['amount_minor']);
        $this->assertSame($variantId, $detail['variants'][0]['id']);
    }

    #[Test]
    public function variant_availability_ignores_inactive_variants_and_alternative_units_in_list_sort_and_detail_alike(): void
    {
        // Codex, PR #1823, P2: the listing/sort used to count ANY variant entry, while the detail page prices only ACTIVE
        // variants in the product's BASE unit — so a card could advertise a product the buyer could not buy.
        [$buyer] = $this->buyer();
        $vm = $this->inCtx(function (): Product {
            $product = $this->product('VM2');
            DB::table('products')->where('id', $product->id)->update(['variant_state' => 'variant_managed']);
            CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $this->ws->id, 'is_published' => true]);
            $inactive = \App\Models\ProductVariant::create(['product_id' => $product->id, 'sku' => 'VM2-i-'.Str::random(4), 'combination_key' => 'i-'.Str::random(6), 'is_active' => false]);
            $active = \App\Models\ProductVariant::create(['product_id' => $product->id, 'sku' => 'VM2-a-'.Str::random(4), 'combination_key' => 'a-'.Str::random(6), 'is_active' => true]);
            // (1) an entry for the INACTIVE variant in the base unit, (2) an entry for the ACTIVE variant but in an alternative unit
            \App\Models\PriceListItem::create(['price_list_id' => $this->channelList->id, 'product_id' => $product->id, 'product_variant_id' => $inactive->id, 'unit_name' => $product->unit, 'price' => 610]);
            \App\Models\PriceListItem::create(['price_list_id' => $this->channelList->id, 'product_id' => $product->id, 'product_variant_id' => $active->id, 'unit_name' => 'box', 'price' => 6100]);

            return $product;
        });

        $row = $this->listing(self::WS, $buyer)['VM2'];
        $this->assertNull($row['price']);
        $this->assertSame('unavailable_for_wholesale', $row['wholesale_availability']['state'], 'listing agrees with the detail page: nothing purchasable');

        $detail = $this->api('GET', 'products/'.$vm->id, self::WS, $buyer)->assertOk()->json('data');
        $this->assertSame('unavailable_for_wholesale', $detail['wholesale_availability']['state']);
        $this->assertNull($detail['price']);

        $asc = $this->order(self::WS, $buyer, '?sort=sale_price');
        $desc = $this->order(self::WS, $buyer, '?sort=-sale_price');
        $this->assertSame(['P1', 'P2'], array_slice($asc, 0, 2), 'priced items first');
        $this->assertEqualsCanonicalizing(['P3', 'VM2'], array_slice($asc, 2), 'both unavailable items sort last');
        $this->assertSame(['P2', 'P1'], array_slice($desc, 0, 2));
        $this->assertEqualsCanonicalizing(['P3', 'VM2'], array_slice($desc, 2), 'unavailable items stay last descending too');

        // giving the ACTIVE variant a base-unit entry makes it available everywhere at once
        $this->inCtx(function () use ($vm): void {
            $active = \App\Models\ProductVariant::query()->where('product_id', $vm->id)->where('is_active', true)->firstOrFail();
            \App\Models\PriceListItem::create(['price_list_id' => $this->channelList->id, 'product_id' => $vm->id, 'product_variant_id' => $active->id, 'unit_name' => $vm->unit, 'price' => 620]);
        });
        $this->assertSame('available', $this->listing(self::WS, $buyer)['VM2']['wholesale_availability']['state']);
        $this->assertSame(620, $this->api('GET', 'products/'.$vm->id, self::WS, $buyer)->json('data.variants.0.price.amount_minor') ?? $this->api('GET', 'products/'.$vm->id, self::WS, $buyer)->json('data.variants.1.price.amount_minor'));
        $this->assertSame('VM2', $this->order(self::WS, $buyer, '?sort=sale_price')[0], 'now sorts as the 0 its row displays');
    }

    // ═══════════════════ 3 · العزل: مستأجر / قناة / عضوية ═══════════════════

    #[Test]
    public function a_partner_default_list_from_another_tenant_is_never_applied(): void
    {
        [$buyer] = $this->buyer();
        $foreign = Tenant::create(['name' => 'f', 'slug' => 'f-'.Str::random(6), 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($foreign->id);
        $foreignProduct = $this->product('FX');
        $foreignList = $this->priceList('foreign', [[$foreignProduct, 1]]);
        app(TenantContext::class)->forget();
        DB::table('partners')->where('id', $this->partner->id)->update(['default_price_list_id' => $foreignList->id]);

        $rows = $this->listing(self::WS, $buyer);

        $this->assertSame(700, $this->amount($rows['P1']), 'the foreign list is invisible ⇒ channel tier');
        $this->assertNotContains(1, array_map(fn ($r) => $this->amount($r), $rows));
    }

    #[Test]
    public function a_channel_list_reference_from_another_tenant_makes_the_channel_tier_unavailable_not_retail(): void
    {
        [$buyer] = $this->buyer(linked: false);
        $foreign = Tenant::create(['name' => 'f2', 'slug' => 'f2-'.Str::random(6), 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($foreign->id);
        $foreignList = PriceList::create(['name' => 'foreign-ch', 'is_active' => true]);
        app(TenantContext::class)->forget();
        DB::table('sales_channels')->where('id', $this->ws->id)->update(['default_price_list_id' => $foreignList->id]);

        $rows = $this->listing(self::WS, $buyer);

        foreach (['P1', 'P2', 'P3'] as $name) {
            $this->assertNull($rows[$name]['price'], "{$name}: corrupt/cross-tenant channel list ⇒ unavailable (fail closed), never 1000");
        }
    }

    #[Test]
    public function an_approval_on_one_channel_prices_nothing_on_another_channel_or_tenant(): void
    {
        [, , $identityId] = $this->buyer();   // approved on WS only

        $this->inCtx(function () use ($identityId): void {
            $resolver = app(CommercePriceResolver::class);
            app(CustomerContext::class)->set($this->tenant->id, $identityId, null);

            // same identity, other wholesale channel: no approved membership there ⇒ unavailable
            $other = $resolver->resolve($this->p1->id, $this->ws2->id);
            $this->assertFalse($other->resolved);
            $this->assertSame(ResolvedCommercePrice::UNAVAILABLE_FOR_WHOLESALE, $other->unavailableReason);
            $this->assertNull($other->amount);

            // and on its own channel it prices (partner tier)
            $own = $resolver->resolve($this->p1->id, $this->ws->id);
            $this->assertSame(500, $own->amount);
            $this->assertSame($this->partnerList->id, $own->priceListId);

            // a foreign-tenant context presenting this identity is not an eligible buyer
            $foreign = Tenant::create(['name' => 'f3', 'slug' => 'f3-'.Str::random(6), 'vat_number' => '300000000000003', 'currency' => 'SAR']);
            app(TenantContext::class)->set($foreign->id);
            app(CustomerContext::class)->set($this->tenant->id, $identityId, null);
            $foreignCtx = app(\App\Services\Commerce\WholesalePriceAuthority::class)->context($this->ws->withoutRelations());
            $this->assertFalse($foreignCtx->eligible, 'CustomerContext tenant ≠ active tenant ⇒ ineligible');
            app(CustomerContext::class)->forget();
        });
    }

    #[Test]
    public function the_resolver_gives_an_unauthenticated_or_unapproved_caller_no_price_on_a_wholesale_channel(): void
    {
        [, $membershipId, $identityId] = $this->buyer();

        $this->inCtx(function () use ($membershipId, $identityId): void {
            $resolver = app(CommercePriceResolver::class);

            // no buyer context at all (e.g. staff preview / any ungated caller)
            $this->assertFalse($resolver->resolve($this->p1->id, $this->ws->id)->resolved);

            // a client-supplied partner id changes nothing in wholesale mode
            $this->assertFalse($resolver->resolve($this->p1->id, $this->ws->id, $this->partner->id)->resolved, 'a caller-supplied partner id is ignored');

            // suspended membership
            app(CustomerContext::class)->set($this->tenant->id, $identityId, null);
            $owner = User::query()->where('role', 'owner')->firstOrFail();
            app(WholesaleMembershipService::class)->transition($membershipId, 'suspend', $owner);
            $this->assertFalse($resolver->resolve($this->p1->id, $this->ws->id)->resolved, 'suspended ⇒ unavailable');
            app(WholesaleMembershipService::class)->transition($membershipId, 'reinstate', $owner);
            $this->assertSame(500, $resolver->resolve($this->p1->id, $this->ws->id)->amount, 'reinstated ⇒ prices again');
            app(CustomerContext::class)->forget();
        });
    }

    #[Test]
    public function a_suspended_buyer_gets_no_price_and_no_cart_over_http(): void
    {
        [$buyer, $membershipId] = $this->buyer();
        $this->add(self::WS, $buyer, $this->p1)->assertCreated();
        $this->inCtx(fn () => app(WholesaleMembershipService::class)->transition($membershipId, 'suspend', User::query()->where('role', 'owner')->firstOrFail()));

        $this->api('GET', 'products', self::WS, $buyer)->assertStatus(403);
        $this->api('GET', 'products/'.$this->p1->id, self::WS, $buyer)->assertStatus(403);
        $this->add(self::WS, $buyer, $this->p1)->assertStatus(403);
    }

    #[Test]
    public function a_revoked_buyer_session_loses_prices_cart_and_checkout(): void
    {
        [$buyer] = $this->buyer();
        $cart = $this->cookie($this->add(self::WS, $buyer, $this->p1)->assertCreated());
        $this->readyCheckout(self::WS, $buyer, $cart);
        $this->api('POST', 'auth/logout', self::WS, $buyer)->assertSuccessful();

        $this->api('GET', 'products', self::WS, $buyer)->assertStatus(401);
        $this->api('GET', 'cart', self::WS, $buyer, $cart)->assertStatus(401);
        $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-revoked')->assertStatus(401);
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
        $this->assertSame(0, CommercePaymentIntent::withoutGlobalScopes()->count());
    }

    // ═══════════════════ 4 · السلة والإتمام: فشل مغلق بلا طلب جزئي ═══════════════════

    #[Test]
    public function a_browser_supplied_price_is_rejected_on_cart_add(): void
    {
        [$buyer] = $this->buyer();

        foreach (['unit_price', 'price', 'amount_minor', 'partner_id', 'price_list_id'] as $field) {
            $this->api('POST', 'cart/items', self::WS, $buyer, null, ['product_id' => $this->p1->id, 'quantity' => 1, 'unit_key' => 'base', $field => 1])->assertStatus(422);
        }
        $this->assertSame(0, \App\Models\CommerceCartItem::withoutGlobalScopes()->count());
    }

    #[Test]
    public function cart_totals_reprice_on_every_read_and_a_price_that_disappears_makes_the_line_unavailable_with_zero_total(): void
    {
        [$buyer] = $this->buyer();
        $cart = $this->cookie($this->add(self::WS, $buyer, $this->p1, quantity: 2)->assertCreated());
        $this->assertSame(1000, $this->api('GET', 'cart', self::WS, $buyer, $cart)->assertOk()->json('data.subtotal.amount_minor'), '2 × 500');

        $this->deactivate($this->partnerList);   // falls to the channel tier
        $this->assertSame(1400, $this->api('GET', 'cart', self::WS, $buyer, $cart)->json('data.subtotal.amount_minor'), '2 × 700');

        $this->deactivate($this->channelList);   // nothing left
        $after = $this->api('GET', 'cart', self::WS, $buyer, $cart)->assertOk();
        $this->assertSame(0, $after->json('data.subtotal.amount_minor'), 'never 2 × 1000');
        $this->assertTrue($after->json('data.has_unavailable_items'));
        $this->assertFalse($after->json('data.items.0.available'));
        $this->api('PATCH', 'cart/items/'.$after->json('data.items.0.id'), self::WS, $buyer, $cart, ['quantity' => 3])->assertStatus(422);
    }

    #[Test]
    public function checkout_fails_closed_when_the_price_disappears_between_cart_and_completion(): void
    {
        [$buyer] = $this->buyer(linked: false);
        $cart = $this->cookie($this->add(self::WS, $buyer, $this->p1)->assertCreated());
        $this->readyCheckout(self::WS, $buyer, $cart);

        $this->deactivate($this->channelList);

        $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-gone')->assertStatus(409);
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count(), 'no partial order');
        $this->assertSame(0, CommerceOrderLine::withoutGlobalScopes()->count());
        $this->assertSame(0, CommercePaymentIntent::withoutGlobalScopes()->count(), 'no payment attempt');
    }

    #[Test]
    public function a_price_list_change_between_cart_and_checkout_is_revalidated_server_side(): void
    {
        [$buyer] = $this->buyer();
        $cart = $this->cookie($this->add(self::WS, $buyer, $this->p1, quantity: 2)->assertCreated());
        $this->readyCheckout(self::WS, $buyer, $cart);

        // the partner list is repriced after the buyer saw 500
        $this->inCtx(fn () => app(PriceListService::class)->upsertItem(PriceList::query()->findOrFail($this->partnerList->id), $this->p1, ['price' => 450]));

        $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-reprice')->assertCreated();

        $order = CommerceOrder::withoutGlobalScopes()->firstOrFail();
        $line = CommerceOrderLine::withoutGlobalScopes()->where('commerce_order_id', $order->id)->firstOrFail();
        $this->assertSame(450, (int) $line->unit_price, 'the order is priced by the CURRENT list, never a stale browser/cart amount');
        $this->assertSame(900, (int) $order->total);
    }

    #[Test]
    public function order_lines_record_which_tier_supplied_the_price(): void
    {
        [$buyer] = $this->buyer();
        $cart = $this->cookie($this->add(self::WS, $buyer, $this->p1)->assertCreated());   // partner tier
        $this->add(self::WS, $buyer, $this->p2, $cart)->assertSuccessful();               // channel tier (fallback)
        $this->readyCheckout(self::WS, $buyer, $cart);
        $this->api('POST', 'checkout/complete', self::WS, $buyer, $cart, [], 'idem-prov')->assertCreated();

        $lines = CommerceOrderLine::withoutGlobalScopes()->get()->keyBy('product_id');

        $this->assertSame([500, 'price_list', $this->partnerList->id], [(int) $lines[$this->p1->id]->unit_price, $lines[$this->p1->id]->price_source, $lines[$this->p1->id]->price_list_id]);
        $this->assertSame([900, 'price_list', $this->channelList->id], [(int) $lines[$this->p2->id]->unit_price, $lines[$this->p2->id]->price_source, $lines[$this->p2->id]->price_list_id]);
        $this->assertSame(0, CommerceOrderLine::withoutGlobalScopes()->where('price_source', 'product_default')->count(), 'no wholesale line is ever priced from the product default');
    }

    // ═══════════════════ 5 · توافق DTC ═══════════════════

    #[Test]
    public function dtc_pricing_is_unchanged_by_wholesale_and_never_shows_a_wholesale_state(): void
    {
        $rows = $this->listing(self::DTC, null);

        foreach (['P1', 'P2', 'P3'] as $name) {
            $this->assertSame(1000, $this->amount($rows[$name]), "{$name}: DTC keeps the retail price");
            $this->assertArrayNotHasKey('wholesale_availability', $rows[$name], 'the response shape is literally unchanged on a non-wholesale channel');
        }
        $this->assertSame(1000, $this->api('GET', 'products/'.$this->p3->id, self::DTC, null)->assertOk()->json('data.price.amount_minor'));
        $this->assertSame(1000, $this->add(self::DTC, null, $this->p3)->assertCreated()->json('data.items.0.unit_price.amount_minor'));
        $this->assertEqualsCanonicalizing(['P1', 'P2', 'P3'], $this->order(self::DTC, null, '?sort=sale_price'), 'DTC sort path untouched (all three tie at 1000)');
    }

    #[Test]
    public function a_dtc_channel_list_still_prices_dtc_and_a_partner_list_never_leaks_into_dtc(): void
    {
        $this->inCtx(function (): void {
            $dtcList = $this->priceList('dtc-list', [[$this->p1, 800]]);
            $this->dtc->update(['default_price_list_id' => $dtcList->id]);
        });

        $rows = $this->listing(self::DTC, null);

        $this->assertSame(800, $this->amount($rows['P1']), 'DTC channel list as before (Batch F)');
        $this->assertSame(1000, $this->amount($rows['P2']), 'DTC falls back to retail exactly as before');
    }
}
