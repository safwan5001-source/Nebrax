<?php

namespace Tests\Feature;

use App\Models\CommerceCartItem;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderLine;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\Commerce\ProductAddonService;
use App\Services\Commerce\ProductPersonalizationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * FLOWERS-H6 / ADR-18 — الإضافات في السلة والدفع والطلب: سطور تابعة بسعر الخادم، كمية
 * مشتقة من الأب، هوية تفصل اختلاف الإضافات، إعادة التحقق عند الإتمام، لقطة الطلب الثابتة،
 * ومنتج عادي بلا أي تغيير في الشكل.
 *
 * تشغيل: php artisan test --filter=CommerceAddonCartTest
 */
class CommerceAddonCartTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const TOKEN = 'X-Cart-Token';

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string} */
    private function mobileStore(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'جوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $service = app(ApiClientKeyService::class);

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $service->issueKey($service->createClient($tenant, 'mobile-app', true), 'default', [])->plainTextToken];
    }

    private function product(array $store, string $name, int $price, array $attributes = []): Product
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $product = Product::create(array_merge(['name' => $name, 'sku' => 'P-'.Str::random(6), 'unit' => 'piece', 'sale_price' => $price, 'is_active' => true], $attributes));
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return $product;
    }

    /** @param list<array<string, mixed>> $addons */
    private function relate(array $store, Product $parent, array $addons): void
    {
        app(TenantContext::class)->set($store['tenant']->id);
        app(ProductAddonService::class)->replace($parent, $addons);
        app(TenantContext::class)->forget();
    }

    /** @return array{store: array, bouquet: Product, chocolate: Product, balloon: Product} */
    private function fixture(string $slug): array
    {
        $store = $this->mobileStore($slug);
        $bouquet = $this->product($store, 'باقة', 20000);
        $chocolate = $this->product($store, 'شوكولاتة', 3000);
        $balloon = $this->product($store, 'بالون', 1500);
        $this->relate($store, $bouquet, [
            ['addon_product_id' => $chocolate->id, 'max_quantity' => 3],
            ['addon_product_id' => $balloon->id, 'max_quantity' => 1],
        ]);

        return compact('store', 'bouquet', 'chocolate', 'balloon');
    }

    private function headers(array $store, ?string $cart = null): array
    {
        $headers = ['Authorization' => 'Bearer '.$store['token']];
        if ($cart !== null) {
            $headers[self::TOKEN] = $cart;
        }

        return $headers;
    }

    private function add(array $store, Product $product, array $body = [], ?string $cart = null): TestResponse
    {
        return $this->postJson('/commerce/v1/cart/items', array_merge(['product_id' => $product->id, 'quantity' => 1], $body), $this->headers($store, $cart));
    }

    private function cartToken(TestResponse $response): string
    {
        return $response->headers->get(self::TOKEN);
    }

    /** @return array<string, array<string, mixed>> الأسطر مفهرسة باسم المنتج */
    private function byName(TestResponse $res): array
    {
        return collect($res->json('data.items'))->keyBy('product_name')->all();
    }

    // ── add ─────────────────────────────────────────────────────────────

    /** @test */
    public function adding_with_addons_creates_priced_child_lines_without_any_client_price(): void
    {
        $f = $this->fixture('ac-add');

        $res = $this->add($f['store'], $f['bouquet'], ['addons' => [
            ['product_id' => $f['chocolate']->id, 'quantity' => 2],
            ['product_id' => $f['balloon']->id],
        ]])->assertCreated();

        $lines = $this->byName($res);
        $this->assertCount(3, $lines);
        $this->assertArrayNotHasKey('addon_of', $lines['باقة']);
        $this->assertSame($lines['باقة']['id'], $lines['شوكولاتة']['addon_of']);
        $this->assertSame(2, $lines['شوكولاتة']['quantity']);
        $this->assertSame(2, $lines['شوكولاتة']['per_parent_quantity']);
        $this->assertSame(6000, $lines['شوكولاتة']['line_total']['amount_minor']);
        $this->assertSame(1500, $lines['بالون']['line_total']['amount_minor']);
        $this->assertSame(27500, $res->json('data.subtotal.amount_minor'));
    }

    /** @test */
    public function a_client_supplied_price_is_refused(): void
    {
        $f = $this->fixture('ac-price');

        $this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id, 'unit_price' => 1]]])->assertStatus(422);
        $this->assertSame(0, CommerceCartItem::withoutGlobalScopes()->count());
    }

    /** @test */
    public function invalid_selections_are_refused_and_nothing_is_added(): void
    {
        $f = $this->fixture('ac-bad');
        $stranger = $this->product($f['store'], 'غريب', 100);
        $plain = $this->product($f['store'], 'عادي', 100);

        $cases = [
            'not a relation' => [$f['bouquet'], [['product_id' => $stranger->id]]],
            'above max' => [$f['bouquet'], [['product_id' => $f['balloon']->id, 'quantity' => 2]]],
            'duplicate' => [$f['bouquet'], [['product_id' => $f['balloon']->id], ['product_id' => $f['balloon']->id]]],
            'zero quantity' => [$f['bouquet'], [['product_id' => $f['balloon']->id, 'quantity' => 0]]],
            'product without relations' => [$plain, [['product_id' => $f['balloon']->id]]],
        ];
        foreach ($cases as $name => [$parent, $addons]) {
            $this->add($f['store'], $parent, ['addons' => $addons])->assertStatus(422);
            $this->assertSame(0, CommerceCartItem::withoutGlobalScopes()->count(), $name);
        }
    }

    /** @test */
    public function a_disabled_relation_cannot_be_selected(): void
    {
        $f = $this->fixture('ac-off');
        $this->relate($f['store'], $f['bouquet'], [['addon_product_id' => $f['chocolate']->id, 'is_active' => false]]);

        $this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id]]])->assertStatus(422);
    }

    /** @test */
    public function an_ordinary_product_is_byte_identical_to_before(): void
    {
        $f = $this->fixture('ac-plain');
        $plain = $this->product($f['store'], 'عادي', 5000);

        $line = $this->add($f['store'], $plain)->assertCreated()->json('data.items.0');

        $this->assertArrayNotHasKey('addon_of', $line);
        $this->assertArrayNotHasKey('per_parent_quantity', $line);

        // وأب بلا اختيار إضافات يبقى سطراً واحداً
        $res = $this->add($f['store'], $f['bouquet'])->assertCreated();
        $this->assertCount(1, $res->json('data.items'));
    }

    // ── quantity / identity ─────────────────────────────────────────────

    /** @test */
    public function updating_the_parent_quantity_recomputes_children_and_children_cannot_be_edited_directly(): void
    {
        $f = $this->fixture('ac-qty');
        $res = $this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id, 'quantity' => 2]]])->assertCreated();
        $cart = $this->cartToken($res);
        $lines = $this->byName($res);

        $upd = $this->patchJson("/commerce/v1/cart/items/{$lines['باقة']['id']}", ['quantity' => 3], $this->headers($f['store'], $cart))->assertOk();
        $after = $this->byName($upd);
        $this->assertSame(3, $after['باقة']['quantity']);
        $this->assertSame(6, $after['شوكولاتة']['quantity']);

        $this->patchJson("/commerce/v1/cart/items/{$lines['شوكولاتة']['id']}", ['quantity' => 1], $this->headers($f['store'], $cart))->assertStatus(422);
        $this->deleteJson("/commerce/v1/cart/items/{$lines['شوكولاتة']['id']}", [], $this->headers($f['store'], $cart))->assertStatus(422);
        $this->assertSame(2, CommerceCartItem::withoutGlobalScopes()->count());
    }

    /** @test */
    public function derived_addon_quantities_beyond_the_column_limit_are_a_422_not_a_server_error(): void
    {
        $f = $this->fixture('ac-overflow');
        $max = 2147483647;

        // إضافة جديدة: الأب بالحد الأقصى × إضافة بكمية 2 ⇒ مرفوض كاملاً (معاملة واحدة)
        $this->add($f['store'], $f['bouquet'], ['quantity' => $max, 'addons' => [['product_id' => $f['chocolate']->id, 'quantity' => 2]]])->assertStatus(422);
        $this->assertSame(0, CommerceCartItem::withoutGlobalScopes()->count());

        // تحديث لاحق لكمية الأب يتجاوز الاشتقاق ⇒ 422 وتبقى الكميات كما هي
        $res = $this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id, 'quantity' => 2]]])->assertCreated();
        $lines = $this->byName($res);
        $this->patchJson("/commerce/v1/cart/items/{$lines['باقة']['id']}", ['quantity' => $max], $this->headers($f['store'], $this->cartToken($res)))->assertStatus(422);
        $this->assertSame([1, 2], CommerceCartItem::withoutGlobalScopes()->orderBy('quantity')->pluck('quantity')->all());
    }

    /** @test */
    public function the_cart_locks_parent_and_addon_products_in_one_global_id_order_before_any_eligibility_check(): void
    {
        if (\Illuminate\Support\Facades\DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('FOR UPDATE يظهر في SQL على PostgreSQL فقط.');
        }

        $f = $this->fixture('ac-lock-order');
        $locks = [];
        \Illuminate\Support\Facades\DB::listen(function ($q) use (&$locks) {
            if (str_contains($q->sql, 'from "products"') && str_contains($q->sql, 'for update')) {
                $locks[] = ['sql' => $q->sql, 'bindings' => $q->bindings];
            }
        });

        $this->add($f['store'], $f['bouquet'], ['addons' => [
            ['product_id' => $f['chocolate']->id],
            ['product_id' => $f['balloon']->id],
        ]])->assertCreated();

        // أول قفل منتجات هو قفل الاتحاد (الأب + الإضافتان) مرتَّباً بالمعرّف، قبل قفل `purchasable()` المفرد
        $ids = [$f['bouquet']->id, $f['chocolate']->id, $f['balloon']->id];
        $this->assertStringContainsString('order by "id"', $locks[0]['sql']);
        $this->assertEqualsCanonicalizing($ids, array_values(array_intersect($locks[0]['bindings'], $ids)));
    }

    /** @test */
    public function checkout_locks_every_cart_product_in_one_global_id_order_before_the_per_line_locks(): void
    {
        if (\Illuminate\Support\Facades\DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('FOR UPDATE يظهر في SQL على PostgreSQL فقط.');
        }

        $f = $this->fixture('ac-co-lock');
        $cart = $this->cartToken($this->add($f['store'], $f['bouquet'], ['addons' => [
            ['product_id' => $f['chocolate']->id],
            ['product_id' => $f['balloon']->id],
        ]])->assertCreated());
        $this->readyCheckout($f['store'], $cart);

        $locks = [];
        \Illuminate\Support\Facades\DB::listen(function ($q) use (&$locks) {
            if (str_contains($q->sql, 'from "products"') && str_contains($q->sql, 'for update')) {
                $locks[] = ['sql' => $q->sql, 'bindings' => $q->bindings];
            }
        });
        $this->complete($f['store'], $cart)->assertCreated();

        // أول قفل منتجات في الإتمام هو قفل الاتحاد (الأب + الإضافتان) مرتَّباً بالمعرّف
        $ids = [$f['bouquet']->id, $f['chocolate']->id, $f['balloon']->id];
        $this->assertStringContainsString('order by "id"', $locks[0]['sql']);
        $this->assertEqualsCanonicalizing($ids, array_values(array_intersect($locks[0]['bindings'], $ids)));
    }

    /** @test */
    public function removing_the_parent_removes_its_addons(): void
    {
        $f = $this->fixture('ac-rm');
        $res = $this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id]]])->assertCreated();

        $this->deleteJson('/commerce/v1/cart/items/'.$this->byName($res)['باقة']['id'], [], $this->headers($f['store'], $this->cartToken($res)))->assertOk();

        $this->assertSame(0, CommerceCartItem::withoutGlobalScopes()->count());
    }

    /** @test */
    public function the_same_selection_merges_and_a_different_selection_is_a_separate_line(): void
    {
        $f = $this->fixture('ac-ident');
        $first = $this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id]]])->assertCreated();
        $cart = $this->cartToken($first);

        $same = $this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id]]], $cart)->assertOk();
        $this->assertSame(2, $this->byName($same)['باقة']['quantity']);
        $this->assertSame(2, $this->byName($same)['شوكولاتة']['quantity']);
        $this->assertCount(2, $same->json('data.items'));

        // اختيار مختلف (كمية إضافة مختلفة) ⇒ أبٌ منفصل بإضافاته
        $other = $this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id, 'quantity' => 3]]], $cart)->assertOk();
        $this->assertCount(4, $other->json('data.items'));
        // وبلا إضافات ⇒ أبٌ ثالث منفصل
        $none = $this->add($f['store'], $f['bouquet'], [], $cart)->assertOk();
        $this->assertCount(5, $none->json('data.items'));
    }

    /** @test */
    public function the_same_addon_product_also_added_alone_stays_an_independent_line(): void
    {
        $f = $this->fixture('ac-solo');
        $res = $this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id]]])->assertCreated();
        $cart = $this->cartToken($res);

        $solo = $this->add($f['store'], $f['chocolate'], ['quantity' => 2], $cart)->assertOk();

        $chocolates = collect($solo->json('data.items'))->where('product_name', 'شوكولاتة');
        $this->assertCount(2, $chocolates);
        $this->assertSame([1, 2], $chocolates->pluck('quantity')->sort()->values()->all());
        $this->assertCount(1, $chocolates->whereNotNull('addon_of'));
    }

    // ── checkout / order ────────────────────────────────────────────────

    private function readyCheckout(array $store, string $cart): void
    {
        $h = $this->headers($store, $cart);
        $this->postJson('/commerce/v1/checkout', [], $h)->assertCreated();
        $this->patchJson('/commerce/v1/checkout/contact', ['name' => 'المشتري', 'phone' => '0501111111'], $h)->assertOk();
        $this->patchJson('/commerce/v1/checkout/address', ['country' => 'SA', 'city' => 'الدمام', 'street' => 'شارع'], $h)->assertOk();
        $this->patchJson('/commerce/v1/checkout/delivery', ['method' => 'pickup'], $h)->assertOk();
    }

    private function complete(array $store, string $cart, string $key = 'ad-key-0001'): TestResponse
    {
        return $this->postJson('/commerce/v1/checkout/complete', [], $this->headers($store, $cart) + ['Idempotency-Key' => $key]);
    }

    /** @test */
    public function completion_creates_linked_order_lines_priced_by_the_server_and_replay_is_stable(): void
    {
        $f = $this->fixture('ac-order');
        $cart = $this->cartToken($this->add($f['store'], $f['bouquet'], ['quantity' => 2, 'addons' => [['product_id' => $f['chocolate']->id, 'quantity' => 2]]])->assertCreated());
        $this->readyCheckout($f['store'], $cart);

        $done = $this->complete($f['store'], $cart)->assertCreated();
        $items = $done->json('data.order.items');
        $this->assertCount(2, $items);
        $this->assertSame('باقة', $items[0]['product_name']);
        $this->assertSame('شوكولاتة', $items[1]['product_name']);
        $this->assertSame($items[0]['line_id'], $items[1]['addon_of']);
        $this->assertSame(4, $items[1]['quantity']);
        $this->assertSame(12000, $items[1]['line_total']['amount_minor']);
        $this->assertSame(52000, $done->json('data.order.total.amount_minor') ?? CommerceOrder::withoutGlobalScopes()->firstOrFail()->total);

        $lines = CommerceOrderLine::withoutGlobalScopes()->get()->keyBy('product_name_snapshot');
        $this->assertSame($lines['باقة']->id, $lines['شوكولاتة']->parent_line_id);
        $this->assertNull($lines['باقة']->parent_line_id);

        $replay = $this->complete($f['store'], $cart)->assertOk();
        $this->assertSame($done->json('data.order.id'), $replay->json('data.order.id'));
        $this->assertSame(2, CommerceOrderLine::withoutGlobalScopes()->count());
        $this->assertSame(1, CommerceOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function an_ordinary_order_has_no_addon_keys(): void
    {
        $f = $this->fixture('ac-plain-order');
        $cart = $this->cartToken($this->add($f['store'], $f['bouquet'])->assertCreated());
        $this->readyCheckout($f['store'], $cart);

        $item = $this->complete($f['store'], $cart)->assertCreated()->json('data.order.items.0');

        $this->assertArrayNotHasKey('line_id', $item);
        $this->assertArrayNotHasKey('addon_of', $item);
    }

    /** @test */
    public function a_disabled_relation_after_adding_blocks_completion_with_a_review_and_no_order(): void
    {
        $f = $this->fixture('ac-reval-rel');
        $cart = $this->cartToken($this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id]]])->assertCreated());
        $this->readyCheckout($f['store'], $cart);

        $this->relate($f['store'], $f['bouquet'], [['addon_product_id' => $f['chocolate']->id, 'is_active' => false]]);

        $res = $this->complete($f['store'], $cart)->assertStatus(409);
        $this->assertSame('review_required', $res->json('error.code'));
        $this->assertSame('addon_unavailable', $res->json('error.details.items.0.reason'));
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_stale_addon_relation_is_shown_unavailable_in_the_cart_and_excluded_from_the_subtotal(): void
    {
        $f = $this->fixture('ac-stale-cart');
        $res = $this->add($f['store'], $f['bouquet'], ['addons' => [
            ['product_id' => $f['chocolate']->id, 'quantity' => 2],
            ['product_id' => $f['balloon']->id],
        ]])->assertCreated();
        $cart = $this->cartToken($res);
        $this->assertSame(27500, $res->json('data.subtotal.amount_minor'));
        $this->assertFalse($res->json('data.has_unavailable_items'));

        // يخفّض التاجر حدّ الشوكولاتة تحت المختار ويعطّل علاقة البالون
        $this->relate($f['store'], $f['bouquet'], [
            ['addon_product_id' => $f['chocolate']->id, 'max_quantity' => 1],
            ['addon_product_id' => $f['balloon']->id, 'is_active' => false],
        ]);

        $after = $this->getJson('/commerce/v1/cart', $this->headers($f['store'], $cart))->assertOk();
        $lines = $this->byName($after);
        $this->assertTrue($lines['باقة']['available']);
        $this->assertFalse($lines['شوكولاتة']['available']);
        $this->assertFalse($lines['بالون']['available']);
        $this->assertSame(0, $lines['شوكولاتة']['line_total']['amount_minor']);
        $this->assertTrue($after->json('data.has_unavailable_items'));
        $this->assertSame(20000, $after->json('data.subtotal.amount_minor')); // الأب وحده
    }

    /** @test */
    public function lowering_the_max_quantity_after_adding_blocks_completion(): void
    {
        $f = $this->fixture('ac-reval-max');
        $cart = $this->cartToken($this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id, 'quantity' => 3]]])->assertCreated());
        $this->readyCheckout($f['store'], $cart);

        $this->relate($f['store'], $f['bouquet'], [['addon_product_id' => $f['chocolate']->id, 'max_quantity' => 1]]);

        $res = $this->complete($f['store'], $cart)->assertStatus(409);
        $this->assertSame('addon_unavailable', $res->json('error.details.items.0.reason'));
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function an_unpublished_addon_blocks_completion(): void
    {
        $f = $this->fixture('ac-reval-pub');
        $cart = $this->cartToken($this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id]]])->assertCreated());
        $this->readyCheckout($f['store'], $cart);

        app(TenantContext::class)->set($f['store']['tenant']->id);
        CommerceListing::query()->where('product_id', $f['chocolate']->id)->update(['is_published' => false]);
        app(TenantContext::class)->forget();

        $this->complete($f['store'], $cart)->assertStatus(409)->assertJsonPath('error.code', 'review_required');
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_price_change_on_the_addon_is_picked_up_at_completion(): void
    {
        $f = $this->fixture('ac-price-chg');
        $cart = $this->cartToken($this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id]]])->assertCreated());
        $this->readyCheckout($f['store'], $cart);

        app(TenantContext::class)->set($f['store']['tenant']->id);
        Product::query()->findOrFail($f['chocolate']->id)->update(['sale_price' => 4000]);
        app(TenantContext::class)->forget();

        // الخادم يعيد تسعير سطر الإضافة بالسعر الحالي لحظة الإتمام — لا السعر القديم صامتاً.
        $done = $this->complete($f['store'], $cart)->assertCreated();
        $this->assertSame(4000, $done->json('data.order.items.1.unit_price.amount_minor'));
        $this->assertSame(24000, $done->json('data.order.items.0.line_total.amount_minor') + $done->json('data.order.items.1.line_total.amount_minor'));
    }

    /** @test */
    public function addon_stock_is_checked_per_line_at_completion(): void
    {
        $f = $this->fixture('ac-stock');
        app(TenantContext::class)->set($f['store']['tenant']->id);
        Product::query()->whereKey($f['chocolate']->id)->update(['track_inventory' => true]);
        $warehouse = Warehouse::create(['name' => 'مخزن', 'code' => 'AD-W1', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($f['store']['channel']->id, $warehouse->id);
        ProductWarehouseStock::create(['product_id' => $f['chocolate']->id, 'warehouse_id' => $warehouse->id, 'quantity' => 3]);
        app(TenantContext::class)->forget();

        // 2 باقات × 2 شوكولاتة = 4 > 3 المتاح
        $cart = $this->cartToken($this->add($f['store'], $f['bouquet'], ['quantity' => 2, 'addons' => [['product_id' => $f['chocolate']->id, 'quantity' => 2]]])->assertCreated());
        $this->readyCheckout($f['store'], $cart);

        $res = $this->complete($f['store'], $cart)->assertStatus(409);
        $this->assertSame('insufficient_stock', $res->json('error.details.items.0.reason'));
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function stock_demand_is_aggregated_across_every_line_of_the_same_addon(): void
    {
        $f = $this->fixture('ac-stock-agg');
        app(TenantContext::class)->set($f['store']['tenant']->id);
        Product::query()->findOrFail($f['chocolate']->id)->update(['track_inventory' => true]);
        $warehouse = Warehouse::create(['name' => 'مخزن', 'code' => 'AD-W2', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($f['store']['channel']->id, $warehouse->id);
        ProductWarehouseStock::create(['product_id' => $f['chocolate']->id, 'warehouse_id' => $warehouse->id, 'quantity' => 2]);
        app(TenantContext::class)->forget();

        // أبٌ بإضافة 1 + أبٌ ثانٍ (اختيار مختلف) بإضافة 2: كل سطر وحده ≤ 2 لكن مجموعهما 3 > 2 ⇒ يُرفض الإتمام.
        $a = $this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id, 'quantity' => 1]]])->assertCreated();
        $cart = $this->cartToken($a);
        $this->add($f['store'], $f['bouquet'], ['addons' => [['product_id' => $f['chocolate']->id, 'quantity' => 2]]], $cart)->assertOk();
        $this->readyCheckout($f['store'], $cart);

        $res = $this->complete($f['store'], $cart)->assertStatus(409);
        $this->assertSame('insufficient_stock', $res->json('error.details.items.0.reason'));
        $this->assertSame(0, CommerceOrder::withoutGlobalScopes()->count());

        // الرصيد يغطي المجموع (1 + 2 = 3 ≤ 3) ⇒ يمرّ
        app(TenantContext::class)->set($f['store']['tenant']->id);
        ProductWarehouseStock::query()->where('product_id', $f['chocolate']->id)->update(['quantity' => 3]);
        app(TenantContext::class)->forget();
        $this->complete($f['store'], $cart, 'ad-key-0002')->assertCreated();
    }

    /** @test */
    public function addons_coexist_with_personalization_and_the_selection_is_part_of_the_line_identity(): void
    {
        $f = $this->fixture('ac-pers');
        app(TenantContext::class)->set($f['store']['tenant']->id);
        app(ProductPersonalizationService::class)->replaceDefinitions($f['bouquet'], [
            ['key' => 'card', 'type' => 'text', 'label' => 'البطاقة', 'max_length' => 20],
        ]);
        app(TenantContext::class)->forget();

        $first = $this->add($f['store'], $f['bouquet'], ['personalization' => ['card' => 'مبروك'], 'addons' => [['product_id' => $f['chocolate']->id]]])->assertCreated();
        $cart = $this->cartToken($first);
        $same = $this->add($f['store'], $f['bouquet'], ['personalization' => ['card' => 'مبروك'], 'addons' => [['product_id' => $f['chocolate']->id]]], $cart)->assertOk();
        $this->assertSame(2, $this->byName($same)['باقة']['quantity']);
        $this->assertSame('مبروك', $this->byName($same)['باقة']['personalization'][0]['value']);

        // نفس التخصيص بإضافات مختلفة ⇒ سطر أب منفصل
        $diff = $this->add($f['store'], $f['bouquet'], ['personalization' => ['card' => 'مبروك']], $cart)->assertOk();
        $this->assertCount(3, $diff->json('data.items'));
    }

    // ── tenant isolation ────────────────────────────────────────────────

    /** @test */
    public function another_tenants_addon_relations_never_apply(): void
    {
        $a = $this->fixture('ac-iso-a');
        $b = $this->fixture('ac-iso-b');

        // معرّف إضافة من مستأجر ب على أب من مستأجر أ ⇒ ليست علاقة عند أ
        $this->add($a['store'], $a['bouquet'], ['addons' => [['product_id' => $b['chocolate']->id]]])->assertStatus(422);
        $this->assertSame(0, CommerceCartItem::withoutGlobalScopes()->count());
    }
}
