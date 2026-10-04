<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceProductPreparation;
use App\Models\CommerceShippingZone;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CommerceDeliveryPromiseService;
use App\Services\Commerce\CommerceDeliveryScheduleService;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\Commerce\InventoryReservationService;
use App\Services\Commerce\ProductPreparationService;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * FLOWERS-H8 / ADR-20 — وعد التسليم المشتق: يركّب ATS وسياسة الجدولة ومهلة تجهيز المنتج ولا يخزّن شيئاً.
 * الساعة المثبّتة: الأربعاء 2026-10-07 10:00 بتوقيت الرياض.
 *
 * تشغيل: php artisan test --filter=CommerceDeliveryPromiseTest
 */
class CommerceDeliveryPromiseTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 07:00:00', 'UTC'));
    }

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string, product: Product, warehouse: Warehouse} */
    private function store(string $slug, array $settings = ['is_enabled' => true], bool $withWarehouse = true, int $stock = 5): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'جوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        $warehouse = Warehouse::create(['name' => 'مخزن', 'code' => 'PR-'.Str::random(4), 'is_default' => true]);
        if ($withWarehouse) {
            app(FulfillmentPolicyService::class)->setFixedWarehouse($channel->id, $warehouse->id);
        }
        $product = $this->product($channel, $warehouse, 'باقة', $stock);
        $schedule = app(CommerceDeliveryScheduleService::class);
        if ($settings !== []) {
            $schedule->saveSettings($channel->id, $settings);
        }
        $schedule->replaceSlots($channel->id, [
            ['method' => 'delivery', 'label' => 'صباحاً', 'start_time' => '09:00', 'end_time' => '12:00'],
            ['method' => 'delivery', 'label' => 'مساءً', 'start_time' => '19:00', 'end_time' => '22:00'],
        ]);
        app(TenantContext::class)->forget();

        $keys = app(ApiClientKeyService::class);

        return [
            'tenant' => $tenant, 'channel' => $channel, 'product' => $product, 'warehouse' => $warehouse,
            'token' => $keys->issueKey($keys->createClient($tenant, 'mobile-app', true), 'default', [])->plainTextToken,
        ];
    }

    /** يُستدعى داخل سياق مستأجر. */
    private function product(SalesChannel $channel, Warehouse $warehouse, string $name, int $stock): Product
    {
        $product = Product::create(['name' => $name, 'sku' => 'P-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 12000, 'is_active' => true, 'track_inventory' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        ProductWarehouseStock::create(['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => $stock]);

        return $product;
    }

    private function headers(array $store): array
    {
        return ['Authorization' => 'Bearer '.$store['token']];
    }

    private function promise(array $store, ?Product $product = null, string $query = ''): ?array
    {
        $product ??= $store['product'];

        return $this->getJson('/commerce/v1/products/'.$product->id.$query, $this->headers($store))->assertOk()->json('data.delivery_promise');
    }

    private function inTenant(array $store, callable $fn): mixed
    {
        app(TenantContext::class)->set($store['tenant']->id);
        try {
            return $fn();
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function the_promise_key_is_absent_while_scheduling_is_off(): void
    {
        $store = $this->store('pr-off', []);

        $detail = $this->getJson('/commerce/v1/products/'.$store['product']->id, $this->headers($store))->assertOk();
        $this->assertArrayNotHasKey('delivery_promise', $detail->json('data'));
        $list = $this->getJson('/commerce/v1/products', $this->headers($store))->assertOk();
        $this->assertArrayNotHasKey('delivery_promise', $list->json('data.0'));

        // سياسة موجودة لكن معطَّلة: كذلك
        $this->inTenant($store, fn () => app(CommerceDeliveryScheduleService::class)->saveSettings($store['channel']->id, ['is_enabled' => false]));
        $this->assertNull($this->promise($store));
    }

    /** @test */
    public function an_in_stock_product_promises_the_earliest_slot_and_same_day_follows_the_clock_and_rules(): void
    {
        $store = $this->store('pr-same');

        // الآن 10:00: نافذة الصباح فاتت، مساء اليوم هي الأبكر ⇒ تسليم اليوم
        $p = $this->promise($store);
        $this->assertTrue($p['deliverable']);
        $this->assertTrue($p['same_day']);
        $this->assertSame('2026-10-07', $p['earliest']['date']);
        $this->assertSame('مساءً', $p['earliest']['slot']['label']);
        $this->assertNull($p['reason']);

        // الإغلاق اليومي 09:00 مضى ⇒ يتحوّل تلقائياً إلى الغد دون أي تعديل على المنتج
        $this->inTenant($store, fn () => app(CommerceDeliveryScheduleService::class)->saveSettings($store['channel']->id, ['is_enabled' => true, 'cutoff_time' => '09:00']));
        $p = $this->promise($store);
        $this->assertFalse($p['same_day']);
        $this->assertSame('2026-10-08', $p['earliest']['date']);
        $this->assertSame('صباحاً', $p['earliest']['slot']['label']);

        // رجوع الإغلاق إلى ما بعد الآن ثم حجب اليوم ⇒ الغد أيضاً
        $this->inTenant($store, function () use ($store) {
            $service = app(CommerceDeliveryScheduleService::class);
            $service->saveSettings($store['channel']->id, ['is_enabled' => true, 'cutoff_time' => null]);
            $service->replaceBlockedDates($store['channel']->id, [['date' => '2026-10-07', 'method' => 'all']]);
        });
        $this->assertFalse($this->promise($store)['same_day']);
    }

    /** @test */
    public function product_preparation_time_pushes_the_promise_and_the_larger_of_channel_and_product_lead_applies(): void
    {
        $store = $this->store('pr-prep');

        // 12 ساعة تجهيز: الآن+12س = 22:00 فلا مساء اليوم (يبدأ 19:00) ⇒ صباح الغد
        $this->inTenant($store, fn () => app(ProductPreparationService::class)->set($store['product'], 720));
        $p = $this->promise($store);
        $this->assertFalse($p['same_day']);
        $this->assertSame(['2026-10-08', 'صباحاً'], [$p['earliest']['date'], $p['earliest']['slot']['label']]);

        // مهلة القناة 15 ساعة أكبر من مهلة المنتج 12 ⇒ تسري الأكبر (لا جمع 27 ساعة): الآن+15س = 01:00 غداً ⇒ صباح الغد أيضاً
        $this->inTenant($store, fn () => app(CommerceDeliveryScheduleService::class)->saveSettings($store['channel']->id, ['is_enabled' => true, 'lead_time_minutes' => 900]));
        $p = $this->promise($store);
        $this->assertSame(['2026-10-08', 'صباحاً'], [$p['earliest']['date'], $p['earliest']['slot']['label']]);

        // مهلة صغيرة جداً للمنتج لا تُنقص مهلة القناة: 60 دقيقة < 900
        $this->inTenant($store, fn () => app(ProductPreparationService::class)->set($store['product'], 60));
        $this->assertSame('2026-10-08', $this->promise($store)['earliest']['date']);

        // إزالة المهلة (0) تحذف الصف
        $this->inTenant($store, function () use ($store) {
            app(ProductPreparationService::class)->set($store['product'], 0);
            $this->assertSame(0, CommerceProductPreparation::query()->count());
        });
    }

    /** @test */
    public function stock_and_reservations_drive_deliverability_with_the_same_numbers_as_ats(): void
    {
        $store = $this->store('pr-stock', stock: 2);
        $this->assertTrue($this->promise($store)['deliverable']);

        // حجز نشط يستنفد المتاح ⇒ لا وعد (مثل ATS تماماً)، والمفتاح يتغيّر تلقائياً
        $this->inTenant($store, fn () => app(InventoryReservationService::class)->acquire($store['product']->id, $store['warehouse']->id, 2, 'pr-res-1'));
        $p = $this->promise($store);
        $this->assertFalse($p['deliverable']);
        $this->assertFalse($p['same_day']);
        $this->assertNull($p['earliest']);
        $this->assertSame('out_of_stock', $p['reason']);

        // نفس الرقم من القراءة الدفعية والمفردة
        $this->inTenant($store, function () use ($store) {
            $ats = app(AvailableToSellService::class);
            $single = $ats->forWarehouse($store['product']->id, $store['warehouse']->id)->availableToSell;
            $many = $ats->forWarehouseMany([$store['product']->id], $store['warehouse']->id);
            $this->assertSame($single, $many[$store['product']->id]['']);
            $this->assertSame(0, $single);
        });

        // عودة المخزون ⇒ يعود الوعد
        $this->inTenant($store, fn () => ProductWarehouseStock::query()->where('product_id', $store['product']->id)->update(['quantity' => 9]));
        $this->assertTrue($this->promise($store)['deliverable']);
    }

    /** @test */
    public function a_channel_without_a_fulfilment_source_cannot_promise(): void
    {
        $store = $this->store('pr-nowh', withWarehouse: false);

        $p = $this->promise($store);
        $this->assertFalse($p['deliverable']);
        $this->assertSame('not_configured', $p['reason']);
    }

    /** @test */
    public function no_applicable_window_is_reported_and_destination_filters_zone_restricted_windows(): void
    {
        $store = $this->store('pr-zone');
        $this->inTenant($store, function () use ($store) {
            $zone = CommerceShippingZone::create(['name' => 'الدمام', 'match_type' => 'city', 'match_value' => 'الدمام', 'rate_amount_minor' => 1500]);
            app(CommerceDeliveryScheduleService::class)->replaceSlots($store['channel']->id, [
                ['method' => 'delivery', 'label' => 'الدمام فقط', 'start_time' => '19:00', 'end_time' => '22:00', 'shipping_zone_id' => $zone->id],
            ]);
        });

        $none = $this->promise($store);
        $this->assertSame('no_slot', $none['reason']);
        $this->assertFalse($none['deliverable']);

        $this->assertTrue($this->promise($store, null, '?city='.rawurlencode('الدمام'))['deliverable']);
        $this->assertSame('no_slot', $this->promise($store, null, '?city='.rawurlencode('الرياض'))['reason']);
    }

    /** @test */
    public function the_list_carries_a_promise_per_row_and_unpublished_products_are_never_exposed(): void
    {
        $store = $this->store('pr-list');
        $other = $this->inTenant($store, function () use ($store) {
            $second = $this->product($store['channel'], $store['warehouse'], 'ثانية', 0);
            $hidden = $this->product($store['channel'], $store['warehouse'], 'مخفية', 5);
            CommerceListing::query()->where('product_id', $hidden->id)->update(['is_published' => false]);

            return [$second, $hidden];
        });

        $list = $this->getJson('/commerce/v1/products', $this->headers($store))->assertOk();
        $rows = collect($list->json('data'))->keyBy('id');
        $this->assertCount(2, $rows);
        $this->assertTrue($rows[$store['product']->id]['delivery_promise']['deliverable']);
        $this->assertSame('out_of_stock', $rows[$other[0]->id]['delivery_promise']['reason']);
        $this->assertArrayNotHasKey($other[1]->id, $rows->all());
    }

    /** @test */
    public function the_number_of_queries_does_not_grow_with_the_number_of_products(): void
    {
        $store = $this->store('pr-n1');
        $count = function (array $products) use ($store): int {
            return $this->inTenant($store, function () use ($store, $products) {
                $queries = 0;
                DB::listen(function () use (&$queries) {
                    $queries++;
                });
                app(CommerceDeliveryPromiseService::class)->forProducts($store['channel']->id, $products);

                return $queries;
            });
        };

        $small = $this->inTenant($store, fn () => [$store['product']]);
        $big = $this->inTenant($store, function () use ($store) {
            $products = [$store['product']];
            foreach (range(1, 8) as $i) {
                $p = $this->product($store['channel'], $store['warehouse'], "منتج {$i}", 3);
                app(ProductPreparationService::class)->set($p, 30 * $i); // مُهَل متمايزة
                $products[] = $p;
            }

            return $products;
        });

        $this->assertSame($count($small), $count($big));
    }

    /** @test */
    public function the_destination_query_is_validated_and_tenants_do_not_see_each_others_preparation(): void
    {
        $store = $this->store('pr-val');
        $this->getJson('/commerce/v1/products/'.$store['product']->id.'?city='.str_repeat('م', 121), $this->headers($store))->assertStatus(422);

        $a = $this->store('pr-iso-a');
        $b = $this->store('pr-iso-b');
        $this->inTenant($a, fn () => app(ProductPreparationService::class)->set($a['product'], 3000));
        $this->assertTrue($this->promise($b)['same_day']);
        $this->inTenant($b, function () use ($a) {
            $this->assertSame([], app(ProductPreparationService::class)->minutesMany([$a['product']->id]));
        });
    }
}
