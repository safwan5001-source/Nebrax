<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\PriceListService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch G — `sort=sale_price` من سلطة السعر الفعلي
 * ═══════════════════════════════════════════════════════════════
 *  السبب الجذري: الفرز كان على عمود `products.sale_price` المجمَّد منذ VAR-PRICE-1 (السلطة: `product_unit_prices` ثم قائمة
 *  القناة). المنتجات الجديدة تحمل الصفر في ذلك العمود فينهار الترتيب إلى كاسر التعادل `id`. الآن يوافق الفرز المبالغ المعروضة:
 *  تصاعدي/تنازلي، ترقيم، تصفية، كاسر تعادل، قائمة القناة والتراجع للسعر الأساسي، التوافق مع DTC، بلا N+1 وبلا ترتيب في الذاكرة.
 */
class PriceSortAuthorityTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'price-sort-secret';

    /** @return array{tenant: Tenant, channel: SalesChannel} */
    private function webStore(string $host, string $type = SalesChannel::TYPE_WEB): array
    {
        $tenant = Tenant::create([
            'name' => $host, 'slug' => 'ps-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'ch-'.Str::random(4), 'name' => 'C', 'type' => $type, 'is_active' => true]);
        if ($type === SalesChannel::TYPE_WEB) {
            $storefront = Storefront::create(['slug' => 's-'.Str::random(4), 'name' => 'S', 'sales_channel_id' => $channel->id, 'is_active' => true]);
            StorefrontDomain::create([
                'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM,
                'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            ]);
        }
        app(TenantContext::class)->forget();

        return compact('tenant', 'channel');
    }

    private function product(Tenant $tenant, SalesChannel $channel, int $price, string $name, bool $publish = true): Product
    {
        app(TenantContext::class)->set($tenant->id);
        $p = Product::create(['name' => $name, 'sku' => 'PS-'.Str::random(8), 'unit' => 'piece', 'sale_price' => $price, 'is_active' => true]);
        if ($publish) {
            CommerceListing::create(['product_id' => $p->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        }
        app(TenantContext::class)->forget();

        return $p;
    }

    /** @param array<string,int> $items */
    private function channelList(Tenant $tenant, SalesChannel $channel, array $items, bool $active = true): PriceList
    {
        app(TenantContext::class)->set($tenant->id);
        $list = PriceList::create(['name' => 'L '.Str::random(5), 'is_active' => true]);
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

    /** @return list<array{id:string,name:string,amount:int}> */
    private function storeList(string $host, string $query = ''): array
    {
        $r = $this->getJson("http://{$host}/store/v1/products{$query}")->assertOk();

        return collect($r->json('data'))->map(fn ($p) => ['id' => $p['id'], 'name' => $p['name'], 'amount' => $p['price']['amount_minor']])->all();
    }

    /** @return list<int> */
    private function amounts(array $rows): array
    {
        return array_column($rows, 'amount');
    }

    // ═══════════════════════ DTC (بلا قائمة) ═══════════════════════

    #[Test]
    public function dtc_ascending_and_descending_follow_the_displayed_base_price(): void
    {
        ['tenant' => $t, 'channel' => $c] = $this->webStore('dtc.sort.test');
        foreach ([[300, 'c'], [100, 'a'], [200, 'b'], [250, 'd']] as [$price, $name]) {
            $this->product($t, $c, $price, $name);
        }

        $this->assertSame([100, 200, 250, 300], $this->amounts($this->storeList('dtc.sort.test', '?sort=sale_price')));
        $this->assertSame([300, 250, 200, 100], $this->amounts($this->storeList('dtc.sort.test', '?sort=-sale_price')));
    }

    #[Test]
    public function equal_prices_have_a_deterministic_tie_break_and_never_duplicate_across_pages(): void
    {
        ['tenant' => $t, 'channel' => $c] = $this->webStore('tie.sort.test');
        foreach (range(1, 7) as $i) {
            $this->product($t, $c, $i % 2 === 0 ? 500 : 900, "p{$i}");   // 3×500, 4×900
        }

        $full = $this->storeList('tie.sort.test', '?sort=sale_price&per_page=100');
        $this->assertSame([500, 500, 500, 900, 900, 900, 900], $this->amounts($full));
        $this->assertSame($full, $this->storeList('tie.sort.test', '?sort=sale_price&per_page=100'), 'stable across calls');

        // walking pages of 3 yields exactly the same sequence: no row repeated or skipped at a price boundary
        $walked = [];
        foreach ([1, 2, 3] as $page) {
            $walked = array_merge($walked, $this->storeList('tie.sort.test', "?sort=sale_price&per_page=3&page={$page}"));
        }
        $this->assertSame($full, $walked);
        $this->assertCount(7, array_unique(array_column($walked, 'id')));
    }

    #[Test]
    public function pagination_meta_and_filters_compose_with_the_price_sort(): void
    {
        ['tenant' => $t, 'channel' => $c] = $this->webStore('page.sort.test');
        foreach ([[40, 'تفاح أحمر'], [10, 'تفاح أخضر'], [30, 'موز'], [20, 'تفاح أصفر'], [50, 'برتقال']] as [$price, $name]) {
            $this->product($t, $c, $price, $name);
        }
        $this->product($t, $c, 5, 'غير منشور', publish: false);

        $r = $this->getJson('http://page.sort.test/store/v1/products?sort=-sale_price&per_page=2&page=2')->assertOk();
        $this->assertSame([30, 20], array_column(array_map(fn ($p) => ['a' => $p['price']['amount_minor']], $r->json('data')), 'a'));
        $this->assertSame(5, $r->json('meta.pagination.total'), 'unpublished product is neither listed nor counted');
        $this->assertSame(3, $r->json('meta.pagination.last_page'));

        // a search filter narrows the set first; the sort then orders only that set
        $filtered = $this->storeList('page.sort.test', '?search='.urlencode('تفاح').'&sort=sale_price');
        $this->assertSame([10, 20, 40], $this->amounts($filtered));
    }

    #[Test]
    public function the_default_and_name_sorts_are_unchanged(): void
    {
        ['tenant' => $t, 'channel' => $c] = $this->webStore('name.sort.test');
        $this->product($t, $c, 3, 'b');
        $this->product($t, $c, 1, 'c');
        $this->product($t, $c, 2, 'a');

        $this->assertSame(['a', 'b', 'c'], array_column($this->storeList('name.sort.test'), 'name'));
        $this->assertSame(['a', 'b', 'c'], array_column($this->storeList('name.sort.test', '?sort=name'), 'name'));
        $this->assertSame(['c', 'b', 'a'], array_column($this->storeList('name.sort.test', '?sort=-name'), 'name'));
        $this->getJson('http://name.sort.test/store/v1/products?sort=avg_cost')->assertStatus(422);
    }

    #[Test]
    public function a_variant_managed_product_sorts_as_the_zero_its_list_row_displays(): void
    {
        ['tenant' => $t, 'channel' => $c] = $this->webStore('var.sort.test');
        $this->product($t, $c, 500, 'simple-500');
        $variantParent = $this->product($t, $c, 100, 'variant-parent');
        DB::table('products')->where('id', $variantParent->id)->update(['variant_state' => 'variant_managed']);
        $this->product($t, $c, 300, 'simple-300');

        $rows = $this->storeList('var.sort.test', '?sort=sale_price');
        $this->assertSame([0, 300, 500], $this->amounts($rows), 'order agrees with the displayed amounts');
    }

    // ═══════════════════════ قائمة القناة ═══════════════════════

    #[Test]
    public function a_channel_list_reorders_by_the_list_price_and_falls_back_to_base_when_an_item_is_missing(): void
    {
        ['tenant' => $t, 'channel' => $c] = $this->webStore('list.sort.test');
        $a = $this->product($t, $c, 100, 'a-base100');    // list → 300
        $b = $this->product($t, $c, 200, 'b-base200');    // list → 50
        $this->product($t, $c, 120, 'c-nolist');          // no item → 120
        $this->channelList($t, $c, [$a->id => 300, $b->id => 50]);

        $this->assertSame([50, 120, 300], $this->amounts($this->storeList('list.sort.test', '?sort=sale_price')));
        $this->assertSame([300, 120, 50], $this->amounts($this->storeList('list.sort.test', '?sort=-sale_price')));
        // page 1 of an ascending sort holds the genuinely cheapest DISPLAYED product
        $this->assertSame([$b->id], array_column($this->storeList('list.sort.test', '?sort=sale_price&per_page=1&page=1'), 'id'));
    }

    #[Test]
    public function an_inactive_list_is_ignored_by_the_sort_exactly_as_by_the_displayed_price(): void
    {
        ['tenant' => $t, 'channel' => $c] = $this->webStore('inactive.sort.test');
        $a = $this->product($t, $c, 100, 'a');
        $b = $this->product($t, $c, 200, 'b');
        $this->channelList($t, $c, [$a->id => 900, $b->id => 1], active: false);

        $this->assertSame([100, 200], $this->amounts($this->storeList('inactive.sort.test', '?sort=sale_price')));
    }

    #[Test]
    public function another_channels_or_tenants_list_never_influences_the_order(): void
    {
        ['tenant' => $t, 'channel' => $c] = $this->webStore('iso.sort.test');
        ['tenant' => $t2, 'channel' => $c2] = $this->webStore('iso2.sort.test');
        $a = $this->product($t, $c, 100, 'a');
        $b = $this->product($t, $c, 200, 'b');
        $this->channelList($t2, $c2, []);                                  // a list on someone else's channel
        app(TenantContext::class)->set($t->id);
        $sibling = SalesChannel::create(['slug' => 'sib', 'name' => 'Sib', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        app(TenantContext::class)->forget();
        $this->channelList($t, $sibling, [$a->id => 999, $b->id => 1]);   // a sibling channel's list, same tenant

        $this->assertSame([100, 200], $this->amounts($this->storeList('iso.sort.test', '?sort=sale_price')));
    }

    // ═══════════════════════ بلا N+1 ═══════════════════════

    #[Test]
    public function the_pricing_and_ordering_cost_does_not_grow_with_the_page(): void
    {
        ['tenant' => $t, 'channel' => $c] = $this->webStore('nplus.sort.test');
        $first = $this->product($t, $c, 10, 'seed');
        $this->channelList($t, $c, [$first->id => 5]);

        $count = function (): int {
            $n = 0;
            // Pricing-related statements only. (The listing's separate per-row `product_media` gallery lookup is a
            // pre-existing, unrelated cost outside this change.)
            DB::listen(function ($q) use (&$n) {
                if (preg_match('/price_list|product_unit_prices|sales_channels/', $q->sql)) {
                    $n++;
                }
            });
            $this->storeList('nplus.sort.test', '?sort=sale_price&per_page=50');

            return $n;
        };
        $small = $count();
        foreach (range(1, 15) as $i) {
            $this->product($t, $c, 100 + $i, "extra{$i}");
        }
        $large = $count();

        $this->assertSame($small, $large, 'pricing/channel/ordering queries for 1 vs 16 rows must be identical (no per-row pricing, no in-memory sort)');
    }

    #[Test]
    public function the_ordering_is_done_by_the_database_not_in_memory(): void
    {
        ['tenant' => $t, 'channel' => $c] = $this->webStore('sql.sort.test');
        $this->product($t, $c, 10, 'x');

        $sql = [];
        DB::listen(function ($q) use (&$sql) {
            if (str_starts_with($q->sql, 'select * from "products"') && str_contains($q->sql, 'limit')) {
                $sql[] = $q->sql;
            }
        });
        $this->storeList('sql.sort.test', '?sort=sale_price');

        $this->assertCount(1, $sql);
        $this->assertStringContainsString('product_unit_prices', $sql[0]);
        $this->assertStringContainsString('limit', $sql[0]);
        $this->assertStringNotContainsString('order by "sale_price"', $sql[0], 'the frozen column is no longer the order authority');
    }

    // ═══════════════════════ سطح الجوال /commerce/v1 ═══════════════════════

    #[Test]
    public function the_mobile_surface_sorts_by_its_channel_resolved_price_and_paginates(): void
    {
        ['tenant' => $t, 'channel' => $c] = $this->webStore('unused.mobile.test', SalesChannel::TYPE_MOBILE);
        $a = $this->product($t, $c, 100, 'a');
        $b = $this->product($t, $c, 200, 'b');
        $this->product($t, $c, 150, 'c');
        $this->channelList($t, $c, [$a->id => 400, $b->id => 60]);
        $client = app(ApiClientKeyService::class)->createClient($t, 'mobile-app', true);
        $token = app(ApiClientKeyService::class)->issueKey($client, 'default', [])->plainTextToken;

        $get = fn (string $q) => collect($this->withToken($token)->getJson('/commerce/v1/products'.$q)->assertOk()->json('data'))
            ->map(fn ($p) => $p['price']['amount_minor'])->all();

        $this->assertSame([60, 150, 400], $get('?sort=sale_price'));
        $this->assertSame([400, 150, 60], $get('?sort=-sale_price'));
        $this->assertSame([60], $get('?sort=sale_price&per_page=1&page=1'));
        $this->assertSame([150], $get('?sort=sale_price&per_page=1&page=2'));
    }

    // ═══════════════════════ سطح ERP /api/v1 ═══════════════════════

    #[Test]
    public function the_erp_api_sorts_by_the_base_price_it_reports_as_sale_price_minor(): void
    {
        $tenant = Tenant::create(['name' => 'erp', 'slug' => 'erp-'.Str::random(6)]);
        app(TenantContext::class)->set($tenant->id);
        foreach ([[300, 'x'], [100, 'y'], [200, 'z']] as [$price, $sku]) {
            Product::create(['sku' => $sku, 'name' => $sku, 'type' => 'good', 'sale_price' => $price, 'tax_rate' => 15, 'is_active' => true]);
        }
        app(TenantContext::class)->forget();
        $client = app(ApiClientKeyService::class)->createClient($tenant, 'integration');
        $token = app(ApiClientKeyService::class)->issueKey($client, 'k', ['products:read'])->plainTextToken;

        $get = fn (string $q) => collect($this->withToken($token)->getJson('/api/v1/products'.$q)->assertOk()->json('data'))
            ->pluck('sale_price_minor')->all();

        $this->assertSame([100, 200, 300], $get('?sort=sale_price'));
        $this->assertSame([300, 200, 100], $get('?sort=-sale_price'));
        $this->assertSame(['x', 'y', 'z'], collect($this->withToken($token)->getJson('/api/v1/products?sort=sku')->json('data'))->pluck('sku')->all());
    }
}
