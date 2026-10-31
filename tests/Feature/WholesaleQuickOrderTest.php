<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceCartItem;
use App\Models\CommerceListing;
use App\Models\CustomerIdentity;
use App\Models\Partner;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\WholesaleMembershipService;
use App\Services\CustomerPartnerLinkService;
use App\Services\PriceListService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Quick Order — البحث بالـSKU/الاسم (بما فيه SKU المتغيّر) والإضافة الذرّية لعدّة أسطر إلى السلة
 * ═══════════════════════════════════════════════════════════════
 */
class WholesaleQuickOrderTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'qo-secret';

    private const BASE = 'http://laravel-internal.test/store/v1/';

    private const WS = 'qo.wholesale.test';

    private const WS2 = 'qo2.wholesale.test';

    private const DTC = 'qo.retail.test';

    private Tenant $tenant;

    private SalesChannel $ws;

    private SalesChannel $ws2;

    private SalesChannel $dtc;

    private Product $simple;

    private Product $unpriced;

    private Product $vm;

    private ProductVariant $varRed;

    private ProductVariant $varBlue;

    private ProductVariant $varInactive;

    private Product $dtcOnly;

    private Partner $partner;

    private PriceList $partnerList;

    private PriceList $channelList;

    protected function setUp(): void
    {
        parent::setUp();
        config(['commerce.wholesale_buyer_enabled' => true, 'storefront.gateway_secret' => self::SECRET]);

        $this->tenant = Tenant::create(['name' => 'متجر الجملة', 'slug' => 'qo-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->ws = $this->web(self::WS, true);
        $this->ws2 = $this->web(self::WS2, true);
        $this->dtc = $this->web(self::DTC, false);

        $this->simple = Product::create(['name' => 'قهوة', 'name_en' => 'Coffee', 'sku' => 'COF-100', 'unit' => 'piece', 'sale_price' => 9999, 'is_active' => true]);
        $this->unpriced = Product::create(['name' => 'شاي', 'name_en' => 'Tea', 'sku' => 'TEA-200', 'unit' => 'piece', 'sale_price' => 8888, 'is_active' => true]);
        $this->vm = Product::create(['name' => 'قميص', 'name_en' => 'Shirt', 'sku' => 'SHIRT', 'unit' => 'piece', 'sale_price' => 7777, 'is_active' => true]);
        DB::table('products')->where('id', $this->vm->id)->update(['variant_state' => 'variant_managed']);
        $this->varRed = ProductVariant::create(['product_id' => $this->vm->id, 'sku' => 'SHIRT-RED', 'combination_key' => 'k-red', 'is_active' => true]);
        $this->varBlue = ProductVariant::create(['product_id' => $this->vm->id, 'sku' => 'SHIRT-BLUE', 'combination_key' => 'k-blue', 'is_active' => true]);
        $this->varInactive = ProductVariant::create(['product_id' => $this->vm->id, 'sku' => 'SHIRT-OLD', 'combination_key' => 'k-old', 'is_active' => false]);
        $this->dtcOnly = Product::create(['name' => 'منتج التجزئة', 'sku' => 'RETAIL-ONLY', 'unit' => 'piece', 'sale_price' => 500, 'is_active' => true]);

        foreach ([$this->ws, $this->ws2] as $channel) {
            foreach ([$this->simple, $this->unpriced, $this->vm] as $product) {
                CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
            }
        }
        foreach ([$this->simple, $this->unpriced, $this->vm, $this->dtcOnly] as $product) {
            CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $this->dtc->id, 'is_published' => true]);
        }
        CommerceListing::create(['product_id' => $this->dtcOnly->id, 'sales_channel_id' => $this->ws->id, 'is_published' => false]);

        $this->channelList = PriceList::create(['name' => 'ws-'.Str::random(4), 'is_active' => true]);
        app(PriceListService::class)->upsertItem($this->channelList, $this->simple, ['price' => 700]);
        PriceListItem::create(['price_list_id' => $this->channelList->id, 'product_id' => $this->vm->id, 'product_variant_id' => $this->varRed->id, 'unit_name' => 'piece', 'price' => 2500]);
        PriceListItem::create(['price_list_id' => $this->channelList->id, 'product_id' => $this->vm->id, 'product_variant_id' => $this->varInactive->id, 'unit_name' => 'piece', 'price' => 100]);
        // varBlue and $unpriced deliberately have NO entry ⇒ unavailable for wholesale
        $this->ws->update(['default_price_list_id' => $this->channelList->id]);
        $this->ws2->update(['default_price_list_id' => $this->channelList->id]);

        $this->partnerList = PriceList::create(['name' => 'partner-'.Str::random(4), 'is_active' => true]);
        app(PriceListService::class)->upsertItem($this->partnerList, $this->simple, ['price' => 500]);
        $this->partner = Partner::create(['name' => 'عميل', 'type' => 'customer', 'default_price_list_id' => $this->partnerList->id]);
        app(TenantContext::class)->forget();
    }

    // ───────────────────────── helpers ─────────────────────────

    private function web(string $host, bool $wholesale): SalesChannel
    {
        $channel = SalesChannel::create(['slug' => 'c-'.Str::random(5), 'name' => $host, 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        if ($wholesale) {
            $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        }
        $storefront = Storefront::create(['slug' => 's-'.Str::random(5), 'name' => $host, 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create(['storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true, 'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED]);

        return $channel;
    }

    private function api(string $method, string $path, string $host, ?string $token = null, array $body = [], ?string $cart = null)
    {
        $this->flushHeaders();
        $this->unencryptedCookies = [];
        $headers = array_filter(['X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET, 'X-Customer-Token' => $token]);
        $t = $this->withHeaders($headers)->withCredentials();
        if ($cart !== null) {
            $t = $t->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $cart);
        }

        return $t->json($method, self::BASE.$path, $body);
    }

    private function owner(): User
    {
        $ctx = app(TenantContext::class);
        $previous = $ctx->has() ? $ctx->id() : null;
        $ctx->set($this->tenant->id);
        $owner = User::query()->where('role', 'owner')->first()
            ?? User::create(['tenant_id' => $this->tenant->id, 'name' => 'o', 'email' => 'o-'.Str::random(6).'@s.test', 'password' => 'password123', 'role' => 'owner']);
        $previous === null ? $ctx->forget() : $ctx->set($previous);

        return $owner;
    }

    /**
     * An approved buyer's session token on the given channel host.
     *
     * @param  list<SalesChannel>  $channels
     */
    private function buyer(string $email, array $channels = [], bool $linked = false, string $host = self::WS, bool $approve = true): string
    {
        $channels = $channels === [] ? [$this->ws] : $channels;
        app(TenantContext::class)->set($this->tenant->id);
        $identity = CustomerIdentity::create(['tenant_id' => $this->tenant->id, 'display_name' => 'Buyer', 'email' => $email, 'password' => 'correct-horse-9', 'email_verified_at' => now(), 'is_active' => true]);
        $svc = app(WholesaleMembershipService::class);
        foreach ($channels as $channel) {
            $membership = $svc->apply($identity, $channel->id);
            if ($approve) {
                $svc->transition($membership->id, 'approve', $this->owner());
            }
        }
        if ($linked) {
            app(CustomerPartnerLinkService::class)->link($identity, $this->partner, $this->owner());
        }
        app(TenantContext::class)->forget();

        return (string) $this->api('POST', 'auth/login', $host, null, ['email' => $email, 'password' => 'correct-horse-9'])->assertOk()->json('data.token');
    }

    private function lookup(string $q, string $token, string $host = self::WS)
    {
        return $this->api('GET', 'buyer/quick-order/lookup?q='.rawurlencode($q), $host, $token);
    }

    /** @param list<array<string, mixed>> $items */
    private function add(array $items, string $token, ?string $cart = null, string $host = self::WS)
    {
        return $this->api('POST', 'buyer/quick-order/add', $host, $token, ['items' => $items], $cart);
    }

    private function cartIdOf($response): ?string
    {
        return $response->getCookie(CommerceCartService::COOKIE_NAME, false)?->getValue();
    }

    private function cartLines(): int
    {
        return CommerceCartItem::withoutGlobalScopes()->count();
    }

    // ═══════════════════════ البحث ═══════════════════════

    #[Test]
    public function an_exact_sku_resolves_to_one_line_priced_by_the_channel_list_never_the_sale_price(): void
    {
        $token = $this->buyer('a@qo.test');

        $lines = $this->lookup('cof-100', $token)->assertOk()->json('data');

        $this->assertCount(1, $lines);
        $this->assertSame($this->simple->id, $lines[0]['product_id']);
        $this->assertNull($lines[0]['product_variant_id']);
        $this->assertSame('COF-100', $lines[0]['sku']);
        $this->assertTrue($lines[0]['exact']);
        $this->assertTrue($lines[0]['available']);
        $this->assertSame(['amount_minor' => 700, 'currency' => 'SAR'], $lines[0]['price']);
        $this->assertNotSame(9999, $lines[0]['price']['amount_minor']);
    }

    #[Test]
    public function the_partner_list_outranks_the_channel_list_for_a_linked_buyer(): void
    {
        $linked = $this->buyer('linked@qo.test', [$this->ws], linked: true);

        $this->assertSame(500, $this->lookup('COF-100', $linked)->assertOk()->json('data.0.price.amount_minor'));
    }

    #[Test]
    public function a_variant_is_found_by_its_own_sku_and_priced_per_variant(): void
    {
        $token = $this->buyer('v@qo.test');

        $red = $this->lookup('SHIRT-RED', $token)->assertOk()->json('data');
        $this->assertCount(1, $red);
        $this->assertSame($this->varRed->id, $red[0]['product_variant_id']);
        $this->assertSame($this->vm->id, $red[0]['product_id']);
        $this->assertTrue($red[0]['exact']);
        $this->assertSame(2500, $red[0]['price']['amount_minor']);

        $blue = $this->lookup('SHIRT-BLUE', $token)->assertOk()->json('data');
        $this->assertCount(1, $blue);
        $this->assertFalse($blue[0]['available'], 'no list entry for this variant ⇒ unavailable');
        $this->assertNull($blue[0]['price']);
        $this->assertSame('no_wholesale_price', $blue[0]['unavailable_reason']);
    }

    #[Test]
    public function a_product_name_lists_its_active_variants_and_never_an_inactive_one(): void
    {
        $token = $this->buyer('n@qo.test');

        $lines = $this->lookup('قميص', $token)->assertOk()->json('data');
        $skus = array_column($lines, 'sku');
        sort($skus);

        $this->assertSame(['SHIRT-BLUE', 'SHIRT-RED'], $skus);
        $this->assertNotContains($this->varInactive->id, array_column($lines, 'product_variant_id'));
        $this->assertContains($this->lookup('shirt', $token)->assertOk()->json('data.0.product_id'), [$this->vm->id]);
    }

    #[Test]
    public function an_exact_variant_sku_is_not_crowded_out_by_other_products_that_merely_mention_it(): void
    {
        $token = $this->buyer('crowd@qo.test');
        app(TenantContext::class)->set($this->tenant->id);
        foreach (['A', 'B', 'C'] as $i => $letter) {
            $noise = Product::create(['name' => $letter.' mentions shirt-red in passing', 'sku' => 'NOISE-'.$i, 'unit' => 'piece', 'sale_price' => 100, 'is_active' => true]);
            CommerceListing::create(['product_id' => $noise->id, 'sales_channel_id' => $this->ws->id, 'is_published' => true]);
        }

        $lines = $this->api('GET', 'buyer/quick-order/lookup?q='.rawurlencode('SHIRT-RED').'&limit=2', self::WS, $token)
            ->assertOk()->json('data');

        $this->assertContains($this->varRed->id, array_column($lines, 'product_variant_id'), 'the exact variant SKU must survive the product limit');
    }

    #[Test]
    public function an_exact_variant_sku_survives_the_per_product_variant_cap(): void
    {
        $token = $this->buyer('cap@qo.test');
        app(TenantContext::class)->set($this->tenant->id);
        $pants = Product::create(['name' => 'Pants', 'sku' => 'PANTS', 'unit' => 'piece', 'sale_price' => 100, 'is_active' => true]);
        DB::table('products')->where('id', $pants->id)->update(['variant_state' => 'variant_managed']);
        CommerceListing::create(['product_id' => $pants->id, 'sales_channel_id' => $this->ws->id, 'is_published' => true]);
        foreach (range('A', 'N') as $i => $suffix) {
            ProductVariant::create(['product_id' => $pants->id, 'sku' => 'PNT-1'.$suffix, 'combination_key' => 'k-'.$i, 'is_active' => true]);
        }
        $exact = ProductVariant::create(['product_id' => $pants->id, 'sku' => 'PNT-1', 'combination_key' => 'k-exact', 'is_active' => true]);

        $lines = $this->lookup('PNT-1', $token)->assertOk()->json('data');

        $this->assertContains($exact->id, array_column($lines, 'product_variant_id'), 'the exact variant must not be cut off by the 12-variant cap');
        $this->assertSame('PNT-1', $lines[0]['sku'], 'and it is listed first');
    }

    #[Test]
    public function an_unpriced_product_is_unavailable_with_no_price_and_the_sale_price_is_never_exposed(): void
    {
        $token = $this->buyer('u@qo.test');

        $response = $this->lookup('TEA-200', $token)->assertOk();
        $line = $response->json('data.0');

        $this->assertFalse($line['available']);
        $this->assertNull($line['price']);
        $this->assertSame('no_wholesale_price', $line['unavailable_reason']);
        $this->assertStringNotContainsString('8888', (string) $response->getContent());
    }

    #[Test]
    public function an_unknown_sku_is_an_empty_result_and_a_dtc_only_product_is_not_found(): void
    {
        $token = $this->buyer('x@qo.test');

        $this->assertSame([], $this->lookup('NOPE-1', $token)->assertOk()->json('data'));
        $this->assertSame([], $this->lookup('RETAIL-ONLY', $token)->assertOk()->json('data'), 'a product unpublished on this channel is invisible');
    }

    #[Test]
    public function lookup_terms_are_validated_and_like_wildcards_are_literal(): void
    {
        $token = $this->buyer('w@qo.test');

        $this->api('GET', 'buyer/quick-order/lookup', self::WS, $token)->assertStatus(422);
        $this->lookup(str_repeat('a', 121), $token)->assertStatus(422);
        $this->api('GET', 'buyer/quick-order/lookup?q=cof&limit=99', self::WS, $token)->assertStatus(422);
        $this->api('GET', 'buyer/quick-order/lookup?q=cof&price=1', self::WS, $token)->assertStatus(422);
        $this->assertSame([], $this->lookup('%', $token)->assertOk()->json('data'), '% is a literal, not "everything"');
        $this->assertSame([], $this->lookup('_', $token)->assertOk()->json('data'));
    }

    // ═══════════════════════ الوصول والعزل ═══════════════════════

    #[Test]
    public function only_an_approved_buyer_on_this_channel_can_look_up_or_add(): void
    {
        $this->api('GET', 'buyer/quick-order/lookup?q=COF', self::WS)->assertStatus(401);
        $this->api('POST', 'buyer/quick-order/add', self::WS, null, ['items' => [['product_id' => $this->simple->id, 'quantity' => 1]]])->assertStatus(401);

        $pending = $this->buyer('p@qo.test', [$this->ws], approve: false);
        $this->lookup('COF', $pending)->assertForbidden()->assertJsonPath('error.details.membership_status', 'pending');
        $this->add([['product_id' => $this->simple->id, 'quantity' => 1]], $pending)->assertForbidden();
        $this->assertSame(0, $this->cartLines());
    }

    #[Test]
    public function a_session_or_approval_from_another_channel_unlocks_nothing_here(): void
    {
        $onWs2 = $this->buyer('c@qo.test', [$this->ws2], host: self::WS2);

        $this->assertContains($this->lookup('COF', $onWs2, self::WS2)->getStatusCode(), [200]);
        // the WS2 session presented on WS: not valid there
        $this->assertContains($this->lookup('COF', $onWs2, self::WS)->getStatusCode(), [401, 403]);
        $this->assertContains($this->add([['product_id' => $this->simple->id, 'quantity' => 1]], $onWs2, null, self::WS)->getStatusCode(), [401, 403]);
        $this->assertSame(0, $this->cartLines());
    }

    #[Test]
    public function a_retail_host_has_no_quick_order_at_all(): void
    {
        $token = $this->buyer('r@qo.test');

        $this->lookup('COF', $token, self::DTC)->assertNotFound();
        $this->add([['product_id' => $this->simple->id, 'quantity' => 1]], $token, null, self::DTC)->assertNotFound();
        $this->assertSame(0, $this->cartLines());
    }

    #[Test]
    public function the_deployment_flag_off_makes_both_routes_a_404(): void
    {
        $token = $this->buyer('f@qo.test');
        config(['commerce.wholesale_buyer_enabled' => false]);

        $this->lookup('COF', $token)->assertNotFound();
        $this->add([['product_id' => $this->simple->id, 'quantity' => 1]], $token)->assertNotFound();
    }

    #[Test]
    public function a_suspended_buyer_loses_lookup_and_add_on_the_same_session(): void
    {
        $token = $this->buyer('s@qo.test');
        $this->lookup('COF', $token)->assertOk();

        app(TenantContext::class)->set($this->tenant->id);
        $membership = \App\Models\WholesaleMembership::query()->firstOrFail();
        app(WholesaleMembershipService::class)->transition($membership->id, 'suspend', $this->owner());
        app(TenantContext::class)->forget();

        $this->lookup('COF', $token)->assertForbidden()->assertJsonPath('error.details.membership_status', 'suspended');
        $this->add([['product_id' => $this->simple->id, 'quantity' => 1]], $token)->assertForbidden();
        $this->assertSame(0, $this->cartLines());
    }

    // ═══════════════════════ الإضافة الذرّية ═══════════════════════

    #[Test]
    public function several_lines_are_added_at_once_and_the_cart_total_is_server_priced(): void
    {
        $token = $this->buyer('m@qo.test');

        $response = $this->add([
            ['product_id' => $this->simple->id, 'quantity' => 3],
            ['product_id' => $this->vm->id, 'product_variant_id' => $this->varRed->id, 'quantity' => 2],
        ], $token)->assertCreated();

        $this->assertNotNull($this->cartIdOf($response), 'the cart token cookie is set');
        $this->assertSame(2, $this->cartLines());
        $cart = $response->json('data');
        $this->assertSame(['amount_minor' => 3 * 700 + 2 * 2500, 'currency' => 'SAR'], $cart['subtotal'] ?? $cart['total'] ?? $cart['totals']['subtotal'] ?? null);
    }

    #[Test]
    public function one_bad_line_rejects_the_whole_batch_and_creates_no_cart_and_no_line(): void
    {
        $token = $this->buyer('b@qo.test');

        $response = $this->add([
            ['product_id' => $this->simple->id, 'quantity' => 1],
            ['product_id' => $this->unpriced->id, 'quantity' => 1],
            ['product_id' => $this->vm->id, 'product_variant_id' => $this->varBlue->id, 'quantity' => 1],
        ], $token)->assertStatus(422);

        $response->assertJsonPath('error.details.reason', 'quick_order_rejected');
        $this->assertEqualsCanonicalizing([1, 2], array_column($response->json('error.details.lines'), 'index'));
        $this->assertSame('unavailable_for_wholesale', $response->json('error.details.lines.0.reason'));
        $this->assertSame(0, $this->cartLines(), 'nothing was added');
        $this->assertSame(0, CommerceCart::withoutGlobalScopes()->count(), 'no cart was created either');
        $this->assertNull($this->cartIdOf($response));
    }

    #[Test]
    public function a_rejected_batch_leaves_an_existing_cart_exactly_as_it_was(): void
    {
        $token = $this->buyer('e@qo.test');
        $first = $this->add([['product_id' => $this->simple->id, 'quantity' => 2]], $token)->assertCreated();
        $cart = $this->cartIdOf($first);

        $this->add([
            ['product_id' => $this->simple->id, 'quantity' => 5],
            ['product_id' => $this->unpriced->id, 'quantity' => 1],
        ], $token, $cart)->assertStatus(422);

        $this->assertSame(1, $this->cartLines());
        $this->assertSame(2, (int) CommerceCartItem::withoutGlobalScopes()->first()->quantity, 'the valid line of the rejected batch did not leak in');
    }

    #[Test]
    public function repeated_and_duplicate_lines_merge_into_one_cart_line(): void
    {
        $token = $this->buyer('d@qo.test');

        $response = $this->add([
            ['product_id' => $this->simple->id, 'quantity' => 2],
            ['product_id' => $this->simple->id, 'quantity' => 3],
        ], $token)->assertCreated();
        $this->assertSame(1, $this->cartLines());
        $this->assertSame(5, (int) CommerceCartItem::withoutGlobalScopes()->first()->quantity);

        $this->add([['product_id' => $this->simple->id, 'quantity' => 1]], $token, $this->cartIdOf($response))->assertOk();
        $this->assertSame(6, (int) CommerceCartItem::withoutGlobalScopes()->first()->quantity);
    }

    #[Test]
    public function variant_and_unit_consistency_is_enforced_by_the_server(): void
    {
        $token = $this->buyer('k@qo.test');

        // a variant that belongs to another product, a variant on a simple product, a variant-managed product without a variant,
        // an inactive variant, an unknown unit
        $cases = [
            [['product_id' => $this->simple->id, 'product_variant_id' => $this->varRed->id, 'quantity' => 1]],
            [['product_id' => $this->vm->id, 'quantity' => 1]],
            [['product_id' => $this->vm->id, 'product_variant_id' => $this->varInactive->id, 'quantity' => 1]],
            [['product_id' => $this->simple->id, 'unit_key' => 'unit:'.Str::uuid(), 'quantity' => 1]],
            [['product_id' => $this->simple->id, 'unit_key' => 'carton', 'quantity' => 1]],
        ];
        foreach ($cases as $i => $items) {
            $this->add($items, $token)->assertStatus(422);
        }
        $this->assertSame(0, $this->cartLines());
    }

    #[Test]
    public function a_product_not_published_on_this_channel_cannot_be_added(): void
    {
        $token = $this->buyer('o@qo.test');

        $this->add([['product_id' => $this->dtcOnly->id, 'quantity' => 1]], $token)->assertStatus(422);
        $this->assertSame(0, $this->cartLines());
    }

    #[Test]
    public function quantities_and_the_payload_shape_are_validated_and_a_browser_price_is_refused(): void
    {
        $token = $this->buyer('q@qo.test');
        $id = $this->simple->id;

        foreach ([0, -1, 'x', 1.5, null] as $bad) {
            $this->add([['product_id' => $id, 'quantity' => $bad]], $token)->assertStatus(422);
        }
        $this->api('POST', 'buyer/quick-order/add', self::WS, $token, ['items' => []])->assertStatus(422);
        $this->api('POST', 'buyer/quick-order/add', self::WS, $token, [])->assertStatus(422);
        $this->api('POST', 'buyer/quick-order/add', self::WS, $token, ['items' => 'x'])->assertStatus(422);
        $this->add([['product_id' => 'not-a-uuid', 'quantity' => 1]], $token)->assertStatus(422);

        // fields that must never be accepted: prices, totals, buyer/partner/channel/tenant identifiers
        foreach (['price', 'unit_price', 'total', 'partner_id', 'price_list_id', 'customer_identity_id', 'sales_channel_id', 'tenant_id'] as $field) {
            $this->add([['product_id' => $id, 'quantity' => 1, $field => 1]], $token)->assertStatus(422);
        }
        $this->api('POST', 'buyer/quick-order/add', self::WS, $token, ['items' => [['product_id' => $id, 'quantity' => 1]], 'price' => 1])->assertStatus(422);

        $tooMany = array_fill(0, 51, ['product_id' => $id, 'quantity' => 1]);
        $this->add($tooMany, $token)->assertStatus(422);
        $this->assertSame(0, $this->cartLines());
    }

    #[Test]
    public function exactly_the_maximum_number_of_lines_is_accepted(): void
    {
        $token = $this->buyer('max@qo.test');

        $this->add(array_fill(0, 50, ['product_id' => $this->simple->id, 'quantity' => 1]), $token)->assertCreated();
        $this->assertSame(1, $this->cartLines());
        $this->assertSame(50, (int) CommerceCartItem::withoutGlobalScopes()->first()->quantity);
    }

    #[Test]
    public function a_cart_belongs_to_its_buyer_and_another_buyer_cannot_write_into_it(): void
    {
        $a = $this->buyer('a2@qo.test');
        $b = $this->buyer('b2@qo.test');
        $cartA = $this->cartIdOf($this->add([['product_id' => $this->simple->id, 'quantity' => 1]], $a)->assertCreated());

        // B presents A's cart cookie: B never gets to mutate or even read A's cart
        $this->add([['product_id' => $this->simple->id, 'quantity' => 9]], $b, $cartA);
        $this->assertSame(1, (int) CommerceCartItem::withoutGlobalScopes()->whereHas('cart', fn ($q) => $q->where('customer_identity_id', CustomerIdentity::query()->where('email', 'a2@qo.test')->value('id')))->sum('quantity'), "A's cart is unchanged");
    }

    #[Test]
    public function the_added_lines_are_repriced_on_every_read_so_checkout_never_trusts_the_add_time_price(): void
    {
        $token = $this->buyer('rp@qo.test');
        $cart = $this->cartIdOf($this->add([['product_id' => $this->simple->id, 'quantity' => 2]], $token)->assertCreated());

        app(TenantContext::class)->set($this->tenant->id);
        PriceListItem::query()->where('price_list_id', $this->channelList->id)->where('product_id', $this->simple->id)->update(['price' => 650]);
        app(TenantContext::class)->forget();

        $read = $this->api('GET', 'cart', self::WS, $token, [], $cart)->assertOk()->json('data');
        $this->assertStringContainsString('1300', json_encode($read), 'the cart now shows 2 × 650, not the price at add time');
    }

    #[Test]
    public function the_documented_line_ceiling_matches_the_controller(): void
    {
        $this->assertSame(50, \App\Http\Controllers\Api\StorefrontQuickOrderController::MAX_LINES);
    }

    // ═══════════════════════ الحلّ الحرفي لقائمة SKU ═══════════════════════

    private function resolve(array $skus, string $token, string $host = self::WS)
    {
        return $this->api('GET', 'buyer/quick-order/resolve?'.http_build_query(['skus' => $skus]), $host, $token);
    }

    #[Test]
    public function a_pasted_list_resolves_each_sku_exactly_in_request_order(): void
    {
        $token = $this->buyer('rs@qo.test');

        $rows = $this->resolve(['cof-100', 'SHIRT-RED', 'NOPE-9', 'TEA-200', 'Shirt'], $token)->assertOk()->json('data');

        $this->assertSame(['cof-100', 'SHIRT-RED', 'NOPE-9', 'TEA-200', 'Shirt'], array_column($rows, 'sku'), 'request spelling and order preserved');
        $this->assertCount(1, $rows[0]['lines']);
        $this->assertSame(700, $rows[0]['lines'][0]['price']['amount_minor']);
        $this->assertSame($this->varRed->id, $rows[1]['lines'][0]['product_variant_id']);
        $this->assertSame([], $rows[2]['lines'], 'unknown sku');
        $this->assertFalse($rows[3]['lines'][0]['available'], 'known but unpriced');
        $this->assertNull($rows[3]['lines'][0]['price']);
        $this->assertCount(2, $rows[4]['lines'], 'the variant-managed PARENT sku yields its active variants to choose from');
        $this->assertNotContains($this->varInactive->id, array_column($rows[4]['lines'], 'product_variant_id'));
    }

    #[Test]
    public function resolve_is_gated_validated_and_isolated_like_lookup(): void
    {
        $this->api('GET', 'buyer/quick-order/resolve?skus[]=COF-100', self::WS)->assertStatus(401);
        $token = $this->buyer('rv@qo.test');
        $this->resolve([], $token)->assertStatus(422);
        $this->api('GET', 'buyer/quick-order/resolve', self::WS, $token)->assertStatus(422);
        $this->resolve(array_fill(0, 51, 'COF-100'), $token)->assertStatus(422);
        $this->resolve([str_repeat('a', 121)], $token)->assertStatus(422);
        $this->api('GET', 'buyer/quick-order/resolve?skus[]=COF-100&price=1', self::WS, $token)->assertStatus(422);
        $this->resolve(['COF-100'], $token, self::DTC)->assertNotFound();
        $this->resolve(['RETAIL-ONLY'], $token)->assertOk()->assertJsonPath('data.0.lines', []);
        $this->resolve(['%'], $token)->assertOk()->assertJsonPath('data.0.lines', []);
    }
}
