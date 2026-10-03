<?php

namespace Tests\Feature;

use App\Models\PriceList;
use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\StorefrontOffer;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\StorefrontOfferResolver;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CUST-H4-6 — `GET /store/v1/offers`: سلطة Host وحده، نافذة زمنية مغلقة الطرفين،
 * ولا ظهور بلا **خصمٍ حقيقي** من `CommercePriceResolver` (سعر قائمة القناة
 * الافتراضية < السعر الأساسي). صفّ التهيئة وحده لا يكفي أبداً.
 *
 * تشغيل: php artisan test --filter=StorefrontOfferPublicApiTest
 */
class StorefrontOfferPublicApiTest extends TestCase
{
    use RefreshDatabase;
    use SeedsStorefrontOffers;

    private const NOW = '2026-10-15 12:00:00';

    protected function setUp(): void
    {
        parent::setUp();
        CarbonImmutable::setTestNow(CarbonImmutable::parse(self::NOW, 'UTC'));
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    private function offersUrl(string $host): string
    {
        return "http://{$host}/store/v1/offers";
    }

    /**
     * متجرٌ كاملٌ بعرضٍ واحد على منتجٍ مخفَّض فعلاً (25000 ← 19000).
     *
     * @return array{tenant: \App\Models\Tenant, channel: \App\Models\SalesChannel, storefront: \App\Models\Storefront, host: string, product: Product, offer: StorefrontOffer}
     */
    private function discountedStore(string $host, array $offerAttrs = []): array
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id, $host);
        $product = $this->offerProduct($tenant->id, $channel, ['name' => 'منتج مخفَّض', 'sale_price' => 25000]);
        $this->channelPriceList($tenant->id, $channel, [$product->id => 19000]);
        $offer = $this->makeOffer($tenant->id, $storefront, $product, $offerAttrs);

        return compact('tenant', 'channel', 'storefront', 'host', 'product', 'offer');
    }

    // ───────────────────────── Real discount / pricing authority ─────────────────────────

    /** @test */
    public function a_candidate_with_a_genuine_authoritative_discount_is_returned_with_both_real_prices(): void
    {
        $s = $this->discountedStore('real.example.test');

        $res = $this->getJson($this->offersUrl($s['host']))->assertOk();

        $res->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $s['offer']->id)
            ->assertJsonPath('data.0.product_id', $s['product']->id)
            ->assertJsonPath('data.0.name', 'منتج مخفَّض')
            ->assertJsonPath('data.0.reference_price.amount_minor', 25000)
            ->assertJsonPath('data.0.offer_price.amount_minor', 19000)
            ->assertJsonPath('data.0.offer_price.currency', 'SAR')
            ->assertJsonPath('data.0.reference_price.currency', 'SAR')
            ->assertJsonPath('data.0.starts_at', null)
            ->assertJsonPath('data.0.ends_at', null);
        $this->assertNotEmpty($res->json('meta.request_id'));
    }

    /** @test */
    public function the_payload_never_fabricates_a_percentage_a_saving_or_exposes_internal_facts(): void
    {
        $s = $this->discountedStore('shape.example.test');
        app(TenantContext::class)->set($s['tenant']->id);
        Product::query()->whereKey($s['product']->id)->update(['avg_cost' => 9999, 'min_sale_price' => 100]);
        app(TenantContext::class)->forget();

        $row = $this->getJson($this->offersUrl($s['host']))->assertOk()->json('data.0');

        $this->assertEqualsCanonicalizing(
            ['id', 'product_id', 'name', 'name_en', 'thumbnail_url', 'reference_price', 'offer_price', 'starts_at', 'ends_at'],
            array_keys($row),
        );
        $body = json_encode($row);
        foreach (['percent', 'saving', 'discount', 'avg_cost', 'purchase_price', 'internal_notes', 'quantity', 'tax_rate', 'tenant_id', 'storefront_id', 'is_active', 'position', 'reason'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $body, "payload leaked/fabricated «{$forbidden}»");
        }
    }

    /** @test */
    public function the_offer_price_is_exactly_what_the_resolver_and_the_real_cart_charge(): void
    {
        config(['storefront.gateway_secret' => 'offers-gateway-secret']);
        $s = $this->discountedStore('cart-parity.example.test');

        $shown = $this->getJson($this->offersUrl($s['host']))->assertOk()->json('data.0.offer_price.amount_minor');

        app(TenantContext::class)->set($s['tenant']->id);
        $resolved = app(CommercePriceResolver::class)->resolve($s['product']->id, $s['channel']->id);
        app(TenantContext::class)->forget();
        $this->assertSame($resolved->amount, $shown);

        $cart = $this->withHeaders([
            'X-Storefront-Forwarded-Host' => $s['host'],
            'X-Storefront-Gateway-Secret' => 'offers-gateway-secret',
        ])->postJson('http://laravel-internal.test/store/v1/cart/items', ['product_id' => $s['product']->id, 'quantity' => 1])
            ->assertCreated();
        $this->assertSame($shown, $cart->json('data.items.0.unit_price.amount_minor'));
    }

    /** @test */
    public function a_discounted_product_without_an_offer_row_is_never_shown(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel] = $this->offerStore($tenant->id, 'norow.example.test');
        $product = $this->offerProduct($tenant->id, $channel);
        $this->channelPriceList($tenant->id, $channel, [$product->id => 10000]); // discounted, but never curated

        $this->getJson($this->offersUrl('norow.example.test'))->assertOk()->assertJsonPath('data', []);
    }

    /** @test */
    public function an_offer_row_alone_does_not_surface_a_product_when_the_channel_has_no_price_list(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id, 'nolist.example.test');
        $product = $this->offerProduct($tenant->id, $channel);
        $this->makeOffer($tenant->id, $storefront, $product);

        $this->getJson($this->offersUrl('nolist.example.test'))->assertOk()->assertJsonPath('data', []);
    }

    /**
     * @test
     *
     * @dataProvider notGenuinelyDiscountedPrices
     */
    public function a_price_list_item_that_is_not_below_the_base_price_is_omitted(int $listPrice): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id, 'nodisc.example.test');
        $product = $this->offerProduct($tenant->id, $channel, ['sale_price' => 25000]);
        $this->channelPriceList($tenant->id, $channel, [$product->id => $listPrice]);
        $this->makeOffer($tenant->id, $storefront, $product);

        $this->getJson($this->offersUrl('nodisc.example.test'))->assertOk()->assertJsonPath('data', []);
    }

    public static function notGenuinelyDiscountedPrices(): array
    {
        return ['equal to base' => [25000], 'above base' => [26000]];
    }

    /** @test */
    public function a_price_list_that_lacks_an_item_for_the_product_is_omitted(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id, 'noitem.example.test');
        $curated = $this->offerProduct($tenant->id, $channel, ['name' => 'مُنسَّق']);
        $other = $this->offerProduct($tenant->id, $channel, ['name' => 'آخر']);
        $this->channelPriceList($tenant->id, $channel, [$other->id => 100]);
        $this->makeOffer($tenant->id, $storefront, $curated);

        $this->getJson($this->offersUrl('noitem.example.test'))->assertOk()->assertJsonPath('data', []);
    }

    /** @test */
    public function an_inactive_channel_price_list_means_no_discount(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id, 'inactivelist.example.test');
        $product = $this->offerProduct($tenant->id, $channel);
        $this->channelPriceList($tenant->id, $channel, [$product->id => 100], active: false);
        $this->makeOffer($tenant->id, $storefront, $product);

        $this->getJson($this->offersUrl('inactivelist.example.test'))->assertOk()->assertJsonPath('data', []);
    }

    /** @test */
    public function a_corrupt_channel_price_list_reference_fails_closed_without_a_500(): void
    {
        $s = $this->discountedStore('corrupt.example.test');

        app(TenantContext::class)->set($s['tenant']->id);
        PriceList::query()->whereKey($s['channel']->fresh()->default_price_list_id)->first()->delete(); // soft-deleted
        app(TenantContext::class)->forget();

        $this->getJson($this->offersUrl($s['host']))->assertOk()->assertJsonPath('data', []);
    }

    /** @test */
    public function the_result_tracks_the_price_list_live_and_is_never_cached_in_the_offer_row(): void
    {
        $s = $this->discountedStore('live.example.test');
        $this->getJson($this->offersUrl($s['host']))->assertJsonPath('data.0.offer_price.amount_minor', 19000);

        app(TenantContext::class)->set($s['tenant']->id);
        \App\Models\PriceListItem::query()->where('product_id', $s['product']->id)->update(['price' => 15000]);
        app(TenantContext::class)->forget();
        $this->getJson($this->offersUrl($s['host']))->assertJsonPath('data.0.offer_price.amount_minor', 15000);

        // يرتفع عن الأساس ⇒ يختفي العرض حالاً — لا قيمة مخزَّنة تُبقيه.
        app(TenantContext::class)->set($s['tenant']->id);
        \App\Models\PriceListItem::query()->where('product_id', $s['product']->id)->update(['price' => 30000]);
        app(TenantContext::class)->forget();
        $this->getJson($this->offersUrl($s['host']))->assertJsonPath('data', []);
    }

    // ───────────────────────── Variant-managed products ─────────────────────────

    /** @test */
    public function a_variant_managed_product_is_omitted_even_if_its_variants_are_on_the_price_list(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id, 'variants.example.test');
        [$product, $v1] = $this->variantOfferProduct($tenant->id, $channel);

        app(TenantContext::class)->set($tenant->id);
        $list = PriceList::create(['name' => 'أسعار', 'is_active' => true]);
        \App\Models\PriceListItem::create([
            'price_list_id' => $list->id, 'product_id' => $product->id,
            'product_variant_id' => $v1->id, 'unit_name' => 'piece', 'price' => 100,
        ]);
        $channel->update(['default_price_list_id' => $list->id]);
        app(TenantContext::class)->forget();

        // الصف أُدخل مباشرةً متجاوزاً بوابة الخدمة — القراءة وحدها تحجب (fail-closed).
        $this->makeOffer($tenant->id, $storefront, $product);

        $this->getJson($this->offersUrl('variants.example.test'))->assertOk()->assertJsonPath('data', []);
    }

    /** @test */
    public function a_simple_product_beside_a_variant_managed_one_is_unaffected(): void
    {
        $s = $this->discountedStore('mixed.example.test');
        [$variantProduct] = $this->variantOfferProduct($s['tenant']->id, $s['channel']);
        $this->makeOffer($s['tenant']->id, $s['storefront'], $variantProduct);

        $this->getJson($this->offersUrl($s['host']))->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.product_id', $s['product']->id);
    }

    // ───────────────────────── Product eligibility ─────────────────────────

    /** @test */
    public function an_unpublished_product_is_omitted(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id, 'unpub.example.test');
        $product = $this->offerProduct($tenant->id, $channel, [], published: false);
        $this->channelPriceList($tenant->id, $channel, [$product->id => 100]);
        $this->makeOffer($tenant->id, $storefront, $product);

        $this->getJson($this->offersUrl('unpub.example.test'))->assertOk()->assertJsonPath('data', []);
    }

    /** @test */
    public function an_unpublished_listing_row_is_omitted_too(): void
    {
        $s = $this->discountedStore('unpub2.example.test');
        app(TenantContext::class)->set($s['tenant']->id);
        \App\Models\CommerceListing::query()->where('product_id', $s['product']->id)->update(['is_published' => false]);
        app(TenantContext::class)->forget();

        $this->getJson($this->offersUrl($s['host']))->assertOk()->assertJsonPath('data', []);
    }

    /** @test */
    public function an_inactive_product_is_omitted(): void
    {
        $s = $this->discountedStore('inactiveprod.example.test');
        app(TenantContext::class)->set($s['tenant']->id);
        Product::query()->whereKey($s['product']->id)->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $this->getJson($this->offersUrl($s['host']))->assertOk()->assertJsonPath('data', []);
    }

    /** @test */
    public function a_product_published_only_on_another_channel_of_the_same_tenant_is_omitted(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $webA, 'storefront' => $storefrontA] = $this->offerStore($tenant->id, 'wa.example.test', 'web');
        ['channel' => $webB] = $this->offerStore($tenant->id, 'wb.example.test', 'web-b');
        $product = $this->offerProduct($tenant->id, $webB); // published on B only
        $this->channelPriceList($tenant->id, $webA, [$product->id => 100]);
        $this->makeOffer($tenant->id, $storefrontA, $product);

        $this->getJson($this->offersUrl('wa.example.test'))->assertOk()->assertJsonPath('data', []);
    }

    // ───────────────────────── Time window ─────────────────────────

    /**
     * @test
     *
     * @dataProvider windows
     */
    public function the_validity_window_is_closed_at_both_ends_in_utc(?string $startsAt, ?string $endsAt, bool $visible): void
    {
        $s = $this->discountedStore('win-'.md5((string) $startsAt.$endsAt).'.example.test', [
            'starts_at' => $startsAt === null ? null : CarbonImmutable::parse(self::NOW, 'UTC')->modify($startsAt),
            'ends_at' => $endsAt === null ? null : CarbonImmutable::parse(self::NOW, 'UTC')->modify($endsAt),
        ]);

        $this->getJson($this->offersUrl($s['host']))->assertOk()->assertJsonCount($visible ? 1 : 0, 'data');
    }

    public static function windows(): array
    {
        return [
            'no start, no end' => [null, null, true],
            'future start' => ['+1 second', null, false],
            'starts exactly now' => ['+0 seconds', null, true],
            'already started' => ['-1 second', null, true],
            'expired' => [null, '-1 second', false],
            'ends exactly now' => [null, '+0 seconds', true],
            'ends in the future' => [null, '+1 second', true],
            'inside a window' => ['-1 hour', '+1 hour', true],
            'window passed' => ['-2 hours', '-1 hour', false],
            'window not yet open' => ['+1 hour', '+2 hours', false],
        ];
    }

    /** @test */
    public function an_inactive_offer_is_omitted_even_inside_its_window(): void
    {
        $s = $this->discountedStore('off.example.test', ['is_active' => false]);

        $this->getJson($this->offersUrl($s['host']))->assertOk()->assertJsonPath('data', []);
    }

    /** @test */
    public function window_metadata_is_exposed_as_utc_iso8601(): void
    {
        $now = CarbonImmutable::parse(self::NOW, 'UTC');
        $s = $this->discountedStore('meta.example.test', ['starts_at' => $now->subDay(), 'ends_at' => $now->addDay()]);

        $this->getJson($this->offersUrl($s['host']))->assertOk()
            ->assertJsonPath('data.0.starts_at', '2026-10-14T12:00:00+00:00')
            ->assertJsonPath('data.0.ends_at', '2026-10-16T12:00:00+00:00');
    }

    // ───────────────────────── Ordering ─────────────────────────

    /** @test */
    public function ordering_is_deterministic_by_position_then_age(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id, 'order.example.test');

        $make = function (string $name, int $position, string $createdAt) use ($tenant, $channel, $storefront): StorefrontOffer {
            $product = $this->offerProduct($tenant->id, $channel, ['name' => $name]);
            $offer = $this->makeOffer($tenant->id, $storefront, $product, ['position' => $position]);
            StorefrontOffer::withoutGlobalScopes()->whereKey($offer->id)->update(['created_at' => $createdAt]);

            return $offer;
        };

        $a = $make('ب-متأخر', 1, '2026-10-02 00:00:00');
        $b = $make('ج-مبكر', 1, '2026-10-01 00:00:00');
        $c = $make('أ-أول', 0, '2026-10-03 00:00:00');
        $this->channelPriceList($tenant->id, $channel, collect([$a, $b, $c])->mapWithKeys(fn ($o) => [$o->product_id => 100])->all());

        $this->assertSame(
            [$c->id, $b->id, $a->id],
            collect($this->getJson($this->offersUrl('order.example.test'))->assertOk()->json('data'))->pluck('id')->all(),
        );
    }

    /** @test */
    public function the_public_read_is_bounded_even_if_rows_exceed_the_cap(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id, 'cap.example.test');
        $prices = [];
        for ($i = 0; $i < StorefrontOfferResolver::MAX_OFFERS_PER_STOREFRONT + 3; $i++) {
            $product = $this->offerProduct($tenant->id, $channel);
            $prices[$product->id] = 100;
            $this->makeOffer($tenant->id, $storefront, $product, ['position' => $i]); // direct insert bypasses the service cap
        }
        $this->channelPriceList($tenant->id, $channel, $prices);

        $this->getJson($this->offersUrl('cap.example.test'))->assertOk()
            ->assertJsonCount(StorefrontOfferResolver::MAX_OFFERS_PER_STOREFRONT, 'data');
    }

    // ───────────────────────── Host authority & isolation ─────────────────────────

    /** @test */
    public function host_a_never_sees_storefront_bs_offers(): void
    {
        $a = $this->discountedStore('host-a.example.test');
        $b = $this->discountedStore('host-b.example.test');

        $this->assertSame([$a['offer']->id], collect($this->getJson($this->offersUrl('host-a.example.test'))->json('data'))->pluck('id')->all());
        $this->assertSame([$b['offer']->id], collect($this->getJson($this->offersUrl('host-b.example.test'))->json('data'))->pluck('id')->all());
    }

    /** @test */
    public function a_second_storefront_of_the_same_tenant_does_not_leak_into_the_first(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $webA, 'storefront' => $sfA] = $this->offerStore($tenant->id, 'one.example.test', 'web');
        ['channel' => $webB, 'storefront' => $sfB] = $this->offerStore($tenant->id, 'two.example.test', 'web-b');
        $productA = $this->offerProduct($tenant->id, $webA, ['name' => 'A']);
        $productB = $this->offerProduct($tenant->id, $webB, ['name' => 'B']);
        $this->channelPriceList($tenant->id, $webA, [$productA->id => 100]);
        $this->channelPriceList($tenant->id, $webB, [$productB->id => 100]);
        $this->makeOffer($tenant->id, $sfA, $productA);
        $this->makeOffer($tenant->id, $sfB, $productB);

        $this->assertSame(['A'], collect($this->getJson($this->offersUrl('one.example.test'))->json('data'))->pluck('name')->all());
        $this->assertSame(['B'], collect($this->getJson($this->offersUrl('two.example.test'))->json('data'))->pluck('name')->all());
    }

    /** @test */
    public function no_request_input_can_select_another_storefront_or_tenant(): void
    {
        $a = $this->discountedStore('input-a.example.test');
        $b = $this->discountedStore('input-b.example.test');

        $res = $this->withHeaders([
            'X-Storefront-Id' => $b['storefront']->id,
            'X-Tenant-Id' => $b['tenant']->id,
        ])->getJson($this->offersUrl('input-a.example.test').'?storefront_id='.$b['storefront']->id.'&tenant_id='.$b['tenant']->id.'&sales_channel_id='.$b['channel']->id)
            ->assertOk();

        $this->assertSame([$a['offer']->id], collect($res->json('data'))->pluck('id')->all());
    }

    /** @test */
    public function the_route_has_no_identifier_segment(): void
    {
        $route = app('router')->getRoutes()->getByName('storefront.v1.offers.index');
        $this->assertSame('store/v1/offers', $route->uri());
        $this->assertSame([], $route->parameterNames());
    }

    /** @test */
    public function a_wrong_gateway_secret_cannot_redirect_the_host(): void
    {
        config(['storefront.gateway_secret' => 'right-secret']);
        $this->discountedStore('gw-a.example.test');
        $b = $this->discountedStore('gw-b.example.test');

        // سرّ خاطئ ⇒ تُتجاهل الترويسة ويقع الحسم على مضيف الاتصال نفسه (غير مسجَّل ⇒ 404).
        $this->withHeaders(['X-Storefront-Forwarded-Host' => 'gw-b.example.test', 'X-Storefront-Gateway-Secret' => 'wrong'])
            ->getJson('http://laravel-internal.test/store/v1/offers')->assertNotFound();

        // وعلى مضيفٍ صحيح، سرّ خاطئ لا يحوّله إلى مضيف آخر.
        $res = $this->withHeaders(['X-Storefront-Forwarded-Host' => 'gw-b.example.test', 'X-Storefront-Gateway-Secret' => 'wrong'])
            ->getJson($this->offersUrl('gw-a.example.test'))->assertOk();
        $this->assertNotContains($b['offer']->id, collect($res->json('data'))->pluck('id')->all());

        // والسرّ الصحيح فقط يحلّ المضيف المُمرَّر.
        $ok = $this->withHeaders(['X-Storefront-Forwarded-Host' => 'gw-b.example.test', 'X-Storefront-Gateway-Secret' => 'right-secret'])
            ->getJson('http://laravel-internal.test/store/v1/offers')->assertOk();
        $this->assertSame([$b['offer']->id], collect($ok->json('data'))->pluck('id')->all());
    }

    /** @test */
    public function an_unknown_host_fails_closed_with_a_uniform_404(): void
    {
        $this->getJson($this->offersUrl('nobody.example.test'))->assertNotFound();
    }

    /** @test */
    public function an_unverified_or_inactive_domain_or_inactive_storefront_fails_closed(): void
    {
        $s = $this->discountedStore('gone.example.test');
        $this->getJson($this->offersUrl('gone.example.test'))->assertOk();

        app(TenantContext::class)->set($s['tenant']->id);
        \App\Models\StorefrontDomain::query()->where('hostname', 'gone.example.test')->update(['verification_status' => \App\Models\StorefrontDomain::VERIFICATION_PENDING]);
        app(TenantContext::class)->forget();
        $this->getJson($this->offersUrl('gone.example.test'))->assertNotFound();

        app(TenantContext::class)->set($s['tenant']->id);
        \App\Models\StorefrontDomain::query()->where('hostname', 'gone.example.test')->update(['verification_status' => \App\Models\StorefrontDomain::VERIFICATION_VERIFIED, 'is_active' => false]);
        app(TenantContext::class)->forget();
        $this->getJson($this->offersUrl('gone.example.test'))->assertNotFound();

        app(TenantContext::class)->set($s['tenant']->id);
        \App\Models\StorefrontDomain::query()->where('hostname', 'gone.example.test')->update(['is_active' => true]);
        \App\Models\Storefront::query()->whereKey($s['storefront']->id)->update(['is_active' => false]);
        app(TenantContext::class)->forget();
        $this->getJson($this->offersUrl('gone.example.test'))->assertNotFound();
    }

    /** @test */
    public function a_foreign_tenants_product_row_cannot_surface_even_if_planted_by_raw_sql(): void
    {
        $a = $this->discountedStore('plant-a.example.test');
        $b = $this->discountedStore('plant-b.example.test');

        // يتجاوز حارس النموذج عمداً (تلف بيانات/إدخال مباشر): القراءة بنطاق المستأجر تُسقطه.
        DB::table('storefront_offers')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $a['tenant']->id,
            'storefront_id' => $a['storefront']->id, 'product_id' => $b['product']->id,
            'is_active' => true, 'position' => 0, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $ids = collect($this->getJson($this->offersUrl('plant-a.example.test'))->json('data'))->pluck('product_id')->all();
        $this->assertSame([$a['product']->id], $ids);
    }

    // ───────────────────────── Thumbnail / regression ─────────────────────────

    /** @test */
    public function the_first_shared_media_becomes_the_thumbnail(): void
    {
        $s = $this->discountedStore('thumb.example.test');
        app(TenantContext::class)->set($s['tenant']->id);
        $media = ProductMedia::query()->forceCreate([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $s['tenant']->id,
            'product_id' => $s['product']->id, 'disk' => 'local', 'path' => 'x/y.png',
            'original_name' => 'y.png', 'mime_type' => 'image/png', 'size' => 10, 'sort_order' => 0,
        ]);
        app(TenantContext::class)->forget();

        $url = $this->getJson($this->offersUrl($s['host']))->assertOk()->json('data.0.thumbnail_url');
        $this->assertStringContainsString($media->id, (string) $url);
    }

    /** @test */
    public function existing_product_endpoints_are_unchanged_by_offers(): void
    {
        $s = $this->discountedStore('regress.example.test');

        $before = $this->getJson("http://regress.example.test/store/v1/products")->assertOk()->json('data');
        $this->assertSame(25000, $before[0]['price']['amount_minor']); // list still shows the base price — untouched here

        $this->getJson($this->offersUrl($s['host']))->assertOk();

        $this->assertSame($before, $this->getJson("http://regress.example.test/store/v1/products")->json('data'));
    }

    // ───────────────────────── Performance ─────────────────────────

    /** @test */
    public function candidates_that_cannot_be_discounted_cost_no_per_product_pricing_queries(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id, 'perf0.example.test');
        for ($i = 0; $i < StorefrontOfferResolver::MAX_OFFERS_PER_STOREFRONT; $i++) {
            $this->makeOffer($tenant->id, $storefront, $this->offerProduct($tenant->id, $channel), ['position' => $i]);
        }

        $queries = $this->countQueries(fn () => $this->getJson($this->offersUrl('perf0.example.test'))->assertOk()->assertJsonPath('data', []));

        $this->assertLessThanOrEqual(14, $queries, "12 non-discountable candidates should be a constant number of queries, got {$queries}");
    }

    /** @test */
    public function resolving_live_offers_stays_within_a_bounded_per_offer_query_budget(): void
    {
        $counts = [];
        foreach ([1, 8, 12] as $n) {
            $tenant = $this->publicTenant();
            $host = "perf{$n}.example.test";
            ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id, $host);
            $prices = [];
            $products = [];
            for ($i = 0; $i < $n; $i++) {
                $products[] = $product = $this->offerProduct($tenant->id, $channel);
                $prices[$product->id] = 100;
            }
            $this->channelPriceList($tenant->id, $channel, $prices);
            foreach ($products as $i => $product) {
                $this->makeOffer($tenant->id, $storefront, $product, ['position' => $i]);
            }

            $counts[$n] = $this->countQueries(fn () => $this->getJson($this->offersUrl($host))->assertOk()->assertJsonCount($n, 'data'));
        }

        // لا انفجار: الكلفة خطية بعدد العروض الحيّة بثابتٍ صغير (المُحلِّل القائم ≈ 5-6 استعلامات/منتج).
        $perOffer = ($counts[12] - $counts[1]) / 11;
        fwrite(STDERR, "\n[offers perf] queries: 1→{$counts[1]}, 8→{$counts[8]}, 12→{$counts[12]}, per-offer≈".round($perOffer, 2)."\n");
        $this->assertLessThanOrEqual(8, $perOffer);
        $this->assertLessThanOrEqual(120, $counts[12]);
    }

    private function countQueries(callable $fn): int
    {
        $n = 0;
        DB::listen(function () use (&$n) { $n++; });
        $fn();

        return $n;
    }
}
