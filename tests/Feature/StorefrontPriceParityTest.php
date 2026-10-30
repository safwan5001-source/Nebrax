<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\CommerceCartService;
use App\Services\PriceListService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch F — تكافؤ السعر بين القائمة والتفاصيل والسلة (store/v1)
 * ═══════════════════════════════════════════════════════════════
 *  السبب الجذري: `StorefrontProductController::index` كان يقرأ `Product.sale_price` مباشرةً (تعليقٌ قديم يزعم تطابقه
 *  مع المُحلِّل ما دام لا قائمة سعر تُحلّ بلا partner)، بينما `show` والسلة والإتمام يمرّون عبر `CommercePriceResolver`
 *  الذي يطبّق قائمة أسعار القناة منذ COM-PRICE-1. فقناةٌ بقائمة أسعار كانت تعرض سعر التجزئة في القائمة وسعر القائمة في
 *  التفاصيل/السلة.
 *
 *  الثوابت: (1) قناة بلا قائمة أسعار ⇒ خرج القائمة **حرفياً** كما كان (sale_price) · (2) قناة بقائمة نشطة ⇒ قائمة=تفاصيل=سلة
 *  لكل منتج بسيط · (3) منتجٌ بلا عنصر في القائمة ⇒ سعره الأساسي في الثلاثة · (4) قائمة غير نشطة ⇒ تُتجاهل في الثلاثة ·
 *  (5) أثر قناة لا يتسرّب لقناة/مستأجر آخر · (6) مرجعٌ تالف/أجنبي ⇒ فشلٌ مغلق لا سعر تجزئة صامت · (7) استعلام أسعار
 *  واحد لا N+1 · (8) ترقيم الصفحات وbody القائمة بلا تغيير.
 */
class StorefrontPriceParityTest extends TestCase
{
    use RefreshDatabase;
    use AssertsNoAmountLeak;

    private const SECRET = 'price-parity-secret';

    /** @return array{tenant: Tenant, channel: SalesChannel} */
    private function store(string $host): array
    {
        $tenant = Tenant::create([
            'name' => $host, 'slug' => 'parity-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return compact('tenant', 'channel');
    }

    private function product(Tenant $tenant, SalesChannel $channel, int $salePrice, string $name = 'منتج'): Product
    {
        app(TenantContext::class)->set($tenant->id);
        $product = Product::create(['name' => $name, 'sku' => 'PAR-'.Str::random(8), 'unit' => 'piece', 'sale_price' => $salePrice, 'is_active' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return $product;
    }

    /** @param  array<string,int>  $items  productId => price */
    private function channelList(Tenant $tenant, SalesChannel $channel, array $items, bool $active = true): PriceList
    {
        app(TenantContext::class)->set($tenant->id);
        $list = PriceList::create(['name' => 'Channel list', 'is_active' => true]);
        foreach ($items as $productId => $price) {
            app(PriceListService::class)->upsertItem($list, Product::query()->findOrFail($productId), ['price' => $price]);
        }
        $channel->update(['default_price_list_id' => $list->id]);
        if (! $active) {
            $list->update(['is_active' => false]);
        }
        app(TenantContext::class)->forget();

        return $list;
    }

    /** @return array<string,int> productId => list price (minor) */
    private function listPrices(string $host, string $query = ''): array
    {
        $response = $this->getJson("http://{$host}/store/v1/products{$query}")->assertOk();

        return collect($response->json('data'))->mapWithKeys(fn ($p) => [$p['id'] => $p['price']['amount_minor']])->all();
    }

    private function detailPrice(string $host, Product $product): int
    {
        return $this->getJson("http://{$host}/store/v1/products/{$product->id}")->assertOk()->json('data.price.amount_minor');
    }

    private function cartPrice(string $host, Product $product): int
    {
        config(['storefront.gateway_secret' => self::SECRET]);
        $response = $this->withHeaders(['X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET])
            ->postJson('http://laravel-internal.test/store/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated();

        return $response->json('data.items.0.unit_price.amount_minor');
    }

    // ───────────────────────── 1 · DTC بلا قائمة: لا تغيير ─────────────────────────

    #[Test]
    public function a_channel_without_a_price_list_lists_exactly_the_product_sale_price(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('dtc.parity.test');
        $a = $this->product($tenant, $channel, 1250, 'A');
        $b = $this->product($tenant, $channel, 0, 'B'); // a genuine zero price stays zero

        $prices = $this->listPrices('dtc.parity.test');

        $this->assertSame([$a->id => 1250, $b->id => 0], $prices + []);
        $this->assertSame(1250, $this->detailPrice('dtc.parity.test', $a));
        $this->assertSame(1250, $this->cartPrice('dtc.parity.test', $a));
    }

    // ───────────────────────── 2/3 · قناة بقائمة نشطة ─────────────────────────

    #[Test]
    public function with_an_active_channel_price_list_list_detail_and_cart_agree_per_product(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('listed.parity.test');
        $inList = $this->product($tenant, $channel, 1000, 'in-list');
        $notInList = $this->product($tenant, $channel, 2000, 'not-in-list');
        $this->channelList($tenant, $channel, [$inList->id => 700]);

        $prices = $this->listPrices('listed.parity.test');

        $this->assertSame(700, $prices[$inList->id], 'listing must show the channel list price');
        $this->assertSame(2000, $prices[$notInList->id], 'a product with no list item keeps its base price');
        foreach ([$inList, $notInList] as $product) {
            $this->assertSame($prices[$product->id], $this->detailPrice('listed.parity.test', $product), "detail parity {$product->name}");
        }
        $this->assertSame(700, $this->cartPrice('listed.parity.test', $inList), 'cart parity');
        $this->assertSame(2000, $this->cartPrice('listed.parity.test', $notInList));
    }

    #[Test]
    public function an_inactive_channel_price_list_is_ignored_everywhere(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('inactive.parity.test');
        $product = $this->product($tenant, $channel, 1000);
        $this->channelList($tenant, $channel, [$product->id => 700], active: false);

        $this->assertSame([$product->id => 1000], $this->listPrices('inactive.parity.test'));
        $this->assertSame(1000, $this->detailPrice('inactive.parity.test', $product));
        $this->assertSame(1000, $this->cartPrice('inactive.parity.test', $product));
    }

    // ───────────────────────── 5 · عزل القنوات والمستأجرين ─────────────────────────

    #[Test]
    public function one_channels_price_list_never_affects_another_channel_or_tenant(): void
    {
        ['tenant' => $tenantA, 'channel' => $channelA] = $this->store('a.parity.test');
        ['tenant' => $tenantB, 'channel' => $channelB] = $this->store('b.parity.test');
        $pa = $this->product($tenantA, $channelA, 1000, 'pa');
        $pb = $this->product($tenantB, $channelB, 1000, 'pb');
        $this->channelList($tenantA, $channelA, [$pa->id => 600]);

        $this->assertSame([$pa->id => 600], $this->listPrices('a.parity.test'));
        $this->assertSame([$pb->id => 1000], $this->listPrices('b.parity.test'));

        // same tenant, second web channel with no list: unaffected
        app(TenantContext::class)->set($tenantA->id);
        $channelA2 = SalesChannel::create(['slug' => 'web2', 'name' => 'Web2', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $sf = Storefront::create(['slug' => 'two', 'name' => 'Two', 'sales_channel_id' => $channelA2->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $sf->id, 'hostname' => 'a2.parity.test', 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        CommerceListing::create(['product_id' => $pa->id, 'sales_channel_id' => $channelA2->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        $this->assertSame([$pa->id => 1000], $this->listPrices('a2.parity.test'));
    }

    // ───────────────────────── 6 · فشل مغلق ─────────────────────────

    #[Test]
    public function a_corrupt_or_foreign_channel_list_reference_fails_closed_in_list_and_detail_alike(): void
    {
        ['tenant' => $tenantA, 'channel' => $channelA] = $this->store('corrupt.parity.test');
        ['tenant' => $tenantB, 'channel' => $channelB] = $this->store('other.parity.test');
        $product = $this->product($tenantA, $channelA, 1000);
        $foreign = $this->channelList($tenantB, $channelB, []);

        // bypass the model guard, as a corrupt/legacy row would
        DB::table('sales_channels')->where('id', $channelA->id)->update(['default_price_list_id' => $foreign->id]);

        $detail = $this->getJson("http://corrupt.parity.test/store/v1/products/{$product->id}");
        $list = $this->getJson('http://corrupt.parity.test/store/v1/products');

        $this->assertGreaterThanOrEqual(400, $detail->getStatusCode());
        $this->assertSame($detail->getStatusCode(), $list->getStatusCode(), 'list must fail the same way as detail');
        $this->assertNoAmountLeak((string) json_encode($list->json()), [1000], 'never a silent retail fallback');
    }

    // ───────────────────────── 6b · الفرز بالسعر المعروض ─────────────────────────

    #[Test]
    public function a_price_sort_orders_and_paginates_by_the_displayed_channel_price(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('sort.parity.test');
        $cheapBase = $this->product($tenant, $channel, 100, 'base-cheap');   // list makes it the MOST expensive
        $dearBase = $this->product($tenant, $channel, 200, 'base-dear');     // list makes it the CHEAPEST
        $noItem = $this->product($tenant, $channel, 120, 'no-item');         // falls back to its base price
        $this->channelList($tenant, $channel, [$cheapBase->id => 300, $dearBase->id => 50]);

        $asc = array_values($this->listPrices('sort.parity.test', '?sort=sale_price'));
        $this->assertSame([50, 120, 300], $asc);
        $desc = array_values($this->listPrices('sort.parity.test', '?sort=-sale_price'));
        $this->assertSame([300, 120, 50], $desc);

        // page 1 of an ascending sort holds the genuinely cheapest displayed product
        $page1 = $this->listPrices('sort.parity.test', '?sort=sale_price&per_page=1&page=1');
        $this->assertSame([$dearBase->id => 50], $page1);
    }

    #[Test]
    public function a_price_sort_on_a_channel_without_a_list_orders_by_the_base_unit_price_not_the_frozen_column(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('sortdtc.parity.test');
        $this->product($tenant, $channel, 300, 'a');
        $this->product($tenant, $channel, 100, 'b');

        $orders = [];
        DB::listen(function ($q) use (&$orders) {
            if (str_starts_with($q->sql, 'select * from "products"') && str_contains($q->sql, 'limit')) {
                $orders[] = $q->sql;
            }
        });
        $prices = $this->listPrices('sortdtc.parity.test', '?sort=sale_price');

        // Batch G (supersedes the Batch F pin of the legacy `order by "sale_price"` statement, which ordered by a
        // column frozen since VAR-PRICE-1): ordering now follows the displayed base unit price. Full behaviour:
        // PriceSortAuthorityTest.
        $this->assertSame([100, 300], array_values($prices));
        $this->assertCount(1, $orders);
        $this->assertStringContainsString('product_unit_prices', $orders[0]);
        $this->assertStringNotContainsString('order by "sale_price"', $orders[0]);
        $this->assertStringNotContainsString('price_list_items', $orders[0], 'no list ⇒ no list tier in the ordering');
    }

    // ───────────────────────── 7 · لا N+1 ─────────────────────────

    #[Test]
    public function price_resolution_in_the_list_is_one_batched_query_regardless_of_page_size(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('nplus.parity.test');
        $items = [];
        for ($i = 0; $i < 12; $i++) {
            $items[$this->product($tenant, $channel, 1000 + $i, "p{$i}")->id] = 500 + $i;
        }
        $this->channelList($tenant, $channel, $items);

        $count = 0;
        DB::listen(function ($q) use (&$count) {
            if (str_contains($q->sql, 'price_list_items')) {
                $count++;
            }
        });
        $prices = $this->listPrices('nplus.parity.test');

        $this->assertCount(12, $prices);
        $this->assertSame(1, $count, 'exactly one price_list_items query for the whole page');
    }

    #[Test]
    public function base_price_resolution_does_not_grow_with_page_size(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('nplus2.parity.test');
        $this->product($tenant, $channel, 1000, 'one');

        $count = function (): int {
            $n = 0;
            DB::listen(function ($q) use (&$n) {
                if (str_contains($q->sql, 'product_unit_prices')) {
                    $n++;
                }
            });
            $this->listPrices('nplus2.parity.test');

            return $n;
        };
        $small = $count();
        foreach (range(1, 11) as $i) {
            $this->product($tenant, $channel, 1000 + $i, "extra{$i}");
        }
        $large = $count();

        $this->assertGreaterThanOrEqual(1, $small);
        $this->assertSame($small, $large, 'the number of product_unit_prices queries must not grow with the page size (1 row vs 12 rows)');
    }

    // ───────────────────────── 8 · الترقيم والشكل ─────────────────────────

    #[Test]
    public function pagination_and_response_shape_are_unchanged_by_channel_pricing(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('shape.parity.test');
        $items = [];
        for ($i = 0; $i < 5; $i++) {
            $items[$this->product($tenant, $channel, 100 * ($i + 1), "s{$i}")->id] = 10 * ($i + 1);
        }
        $this->channelList($tenant, $channel, $items);

        $page = $this->getJson('http://shape.parity.test/store/v1/products?per_page=2&sort=name')->assertOk();

        $this->assertCount(2, $page->json('data'));
        $this->assertSame(5, $page->json('meta.pagination.total'));
        $this->assertSame(3, $page->json('meta.pagination.last_page'));
        $this->assertSame(['amount_minor', 'currency'], array_keys($page->json('data.0.price')));
        $this->assertSame('SAR', $page->json('data.0.price.currency'));
    }
}
