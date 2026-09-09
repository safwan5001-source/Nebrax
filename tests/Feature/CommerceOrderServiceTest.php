<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderLine;
use App\Models\Invoice;
use App\Models\InventoryReservation;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\SalesChannel;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Models\Warehouse;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CommerceOrderPriceUnresolvedException;
use App\Services\Commerce\CommerceOrderService;
use App\Services\PriceListService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-5A — CommerceOrder Foundation (ADR-01)
 * ═══════════════════════════════════════════════════════════════
 *  `CommerceOrder != Invoice`: التزامٌ تجاريٌّ غير محاسبي. الإنشاء والتأكيد
 *  كلاهما بلا أثر محاسبي أو مخزني — لا حجز، لا فاتورة، لا قيد، لا دفعة.
 *  التسعير عبر `CommercePriceResolver` (COM-4A) حصراً؛ سعرٌ غير محسوم يرفض
 *  السطر بدل افتراض صفر.
 *
 *  تشغيل: php artisan test --filter=CommerceOrderServiceTest
 */
class CommerceOrderServiceTest extends TestCase
{
    use RefreshDatabase;

    private CommerceOrderService $orders;
    private Product $product;
    private SalesChannel $channel;

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenant->id);

        $this->product = Product::create(['name' => 'منتج طلب', 'sale_price' => 15000]);
        $this->channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'متجرنا', 'type' => SalesChannel::TYPE_MOBILE]);
        $this->orders = app(CommerceOrderService::class);
    }

    private function items(int $quantity = 2, ?string $unitName = null): array
    {
        return [['product_id' => $this->product->id, 'quantity' => $quantity, 'unit_name' => $unitName]];
    }

    // ═══════════════════════════════════════════════════════════
    //  Creation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_order_can_be_created_for_the_current_tenant(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());

        $this->assertTrue($order->isDraft());
        $this->assertSame($this->channel->id, $order->sales_channel_id);
        $this->assertNotEmpty($order->number);
        $this->assertSame(1, CommerceOrder::query()->count());
    }

    /** @test */
    public function lines_are_created_atomically_with_the_order(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items(3));

        $this->assertCount(1, $order->lines);
        $this->assertSame(3, $order->lines->first()->quantity);
        $this->assertSame(45000, $order->total);
        $this->assertSame(45000, $order->lines->first()->line_total);
    }

    /** @test */
    public function a_missing_sales_channel_is_rejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->orders->create(['sales_channel_id' => (string) \Illuminate\Support\Str::uuid()], $this->items());
    }

    /** @test */
    public function a_missing_product_reference_is_rejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => (string) \Illuminate\Support\Str::uuid(), 'quantity' => 1],
        ]);
    }

    /** @test */
    public function an_empty_item_list_is_rejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->orders->create(['sales_channel_id' => $this->channel->id], []);
    }

    /** @test */
    public function a_non_positive_quantity_is_rejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items(0));
    }

    /** @test */
    public function an_order_can_be_created_without_a_partner_as_a_guest_commitment(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());

        $this->assertNull($order->partner_id);
    }

    /** @test */
    public function an_order_can_reference_an_optional_partner(): void
    {
        $partner = Partner::create(['name' => 'عميل طلب', 'type' => 'customer']);

        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id, 'partner_id' => $partner->id,
        ], $this->items(), trustedPartnerSelection: true);

        $this->assertSame($partner->id, $order->partner_id);
    }

    // ═══════════════════════════════════════════════════════════
    //  Price snapshot — COM-4A integration
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function the_resolved_commercial_price_is_used_from_the_com4a_resolver(): void
    {
        $priceList = PriceList::create(['name' => 'قائمة كبار العملاء', 'is_active' => true]);
        app(PriceListService::class)->upsertItem($priceList, $this->product, ['price' => 9900]);
        $partner = Partner::create(['name' => 'عميل مسعّر', 'type' => 'customer', 'default_price_list_id' => $priceList->id]);

        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id, 'partner_id' => $partner->id,
        ], $this->items(1), trustedPartnerSelection: true);

        $this->assertSame(9900, $order->lines->first()->unit_price);
    }

    /** @test */
    public function the_resolved_price_is_stored_as_an_immutable_historical_snapshot(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items(1));
        $line = $order->lines->first();

        $this->assertSame(15000, $line->unit_price);
        $this->assertSame('منتج طلب', $line->product_name_snapshot);
    }

    /** @test */
    public function a_genuine_zero_price_is_accepted_as_a_real_resolved_price(): void
    {
        $free = Product::create(['name' => 'منتج مجاني', 'sale_price' => 0]);

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => $free->id, 'quantity' => 5],
        ]);

        $line = $order->lines->first();
        $this->assertSame(0, $line->unit_price);
        $this->assertSame(0, $line->line_total);
        $this->assertSame(0, $order->total);
    }

    /** @test */
    public function an_unresolved_price_never_silently_becomes_zero(): void
    {
        $template = UnitTemplate::create(['name' => 'قالب كراتين طلب', 'base_unit' => 'piece']);
        $template->units()->create(['name' => 'carton', 'factor' => 24]);
        $boxed = Product::create([
            'name' => 'منتج كراتين طلب', 'unit' => 'piece', 'unit_template_id' => $template->id, 'sale_price' => 15000,
        ]);

        $this->expectException(CommerceOrderPriceUnresolvedException::class);
        $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => $boxed->id, 'quantity' => 1, 'unit_name' => 'carton'],
        ]);
    }

    /** @test */
    public function a_later_product_sale_price_change_does_not_mutate_the_committed_line(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items(1));

        $this->product->update(['sale_price' => 99999]);

        $line = $order->lines->first()->fresh();
        $this->assertSame(15000, $line->unit_price);
    }

    /** @test */
    public function a_later_price_list_change_does_not_mutate_the_committed_line(): void
    {
        $priceList = PriceList::create(['name' => 'قائمة متغيّرة', 'is_active' => true]);
        app(PriceListService::class)->upsertItem($priceList, $this->product, ['price' => 8000]);
        $partner = Partner::create(['name' => 'عميل متغيّر', 'type' => 'customer', 'default_price_list_id' => $priceList->id]);

        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id, 'partner_id' => $partner->id,
        ], $this->items(1), trustedPartnerSelection: true);

        app(PriceListService::class)->upsertItem($priceList, $this->product, ['price' => 500]);

        $line = $order->lines->first()->fresh();
        $this->assertSame(8000, $line->unit_price, 'تغيير بند القائمة لاحقاً لا يعيد كتابة اللقطة الملتزمة.');
    }

    /** @test */
    public function a_later_product_name_change_does_not_mutate_the_committed_snapshot(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items(1));

        $this->product->update(['name' => 'اسمٌ جديد بعد الاتفاق']);

        $line = $order->lines->first()->fresh();
        $this->assertSame('منتج طلب', $line->product_name_snapshot);
    }

    // ═══════════════════════════════════════════════════════════
    //  UOM
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_valid_alternative_unit_is_preserved_on_the_line(): void
    {
        $template = UnitTemplate::create(['name' => 'قالب كراتين محسوم', 'base_unit' => 'piece']);
        $template->units()->create(['name' => 'carton', 'factor' => 24]);
        $boxed = Product::create([
            'name' => 'منتج كراتين محسوم', 'unit' => 'piece', 'unit_template_id' => $template->id, 'sale_price' => 500,
        ]);
        $priceList = PriceList::create(['name' => 'قائمة كراتين', 'is_active' => true]);
        app(PriceListService::class)->upsertItem($priceList, $boxed, ['unit_name' => 'carton', 'price' => 10800]);
        $partner = Partner::create(['name' => 'عميل كراتين', 'type' => 'customer', 'default_price_list_id' => $priceList->id]);

        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id, 'partner_id' => $partner->id,
        ], [['product_id' => $boxed->id, 'quantity' => 2, 'unit_name' => 'carton']], trustedPartnerSelection: true);

        $line = $order->lines->first();
        $this->assertSame('carton', $line->unit_name);
        $this->assertSame(24, $line->unit_factor);
        $this->assertSame(10800, $line->unit_price);
    }

    /** @test */
    public function an_undefined_unit_is_rejected(): void
    {
        $template = UnitTemplate::create(['name' => 'قالب غير معرَّف طلب', 'base_unit' => 'piece']);
        $template->units()->create(['name' => 'carton', 'factor' => 24]);
        $boxed = Product::create([
            'name' => 'منتج غير معرَّف طلب', 'unit' => 'piece', 'unit_template_id' => $template->id, 'sale_price' => 500,
        ]);

        $this->expectException(RuntimeException::class);
        $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => $boxed->id, 'quantity' => 1, 'unit_name' => 'pallet-not-defined'],
        ]);
    }

    /** @test */
    public function quantity_and_base_quantity_semantics_are_correct(): void
    {
        $template = UnitTemplate::create(['name' => 'قالب كمية أساس', 'base_unit' => 'piece']);
        $template->units()->create(['name' => 'carton', 'factor' => 24]);
        $boxed = Product::create([
            'name' => 'منتج كمية أساس', 'unit' => 'piece', 'unit_template_id' => $template->id, 'sale_price' => 500,
        ]);
        $priceList = PriceList::create(['name' => 'قائمة كمية أساس', 'is_active' => true]);
        app(PriceListService::class)->upsertItem($priceList, $boxed, ['unit_name' => 'carton', 'price' => 10800]);
        $partner = Partner::create(['name' => 'عميل كمية أساس', 'type' => 'customer', 'default_price_list_id' => $priceList->id]);

        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id, 'partner_id' => $partner->id,
        ], [['product_id' => $boxed->id, 'quantity' => 3, 'unit_name' => 'carton']], trustedPartnerSelection: true);

        $line = $order->lines->first();
        $this->assertSame(3, $line->quantity);
        $this->assertSame(72, $line->baseQuantity(), '٣ كراتين × معامل ٢٤ = ٧٢ وحدة أساس.');
    }

    // ═══════════════════════════════════════════════════════════
    //  Tenant isolation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_cross_tenant_sales_channel_is_rejected(): void
    {
        $foreignChannelId = $this->channel->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى', 'slug' => 'other-co-tenant-1']);
        app(TenantContext::class)->set($tenantB->id);
        Product::create(['name' => 'منتج ب', 'sale_price' => 5000]);

        $this->expectException(RuntimeException::class);
        $this->orders->create(['sales_channel_id' => $foreignChannelId], $this->items());
    }

    /** @test */
    public function a_cross_tenant_product_is_rejected(): void
    {
        $foreignProductId = $this->product->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٢', 'slug' => 'other-co-tenant-2']);
        app(TenantContext::class)->set($tenantB->id);
        $channelUnderB = SalesChannel::create(['slug' => 'mobile', 'name' => 'قناة ب', 'type' => SalesChannel::TYPE_MOBILE]);

        $this->expectException(RuntimeException::class);
        $this->orders->create(['sales_channel_id' => $channelUnderB->id], [
            ['product_id' => $foreignProductId, 'quantity' => 1],
        ]);
    }

    /** @test */
    public function a_cross_tenant_partner_is_rejected(): void
    {
        $foreignPartnerId = Partner::create(['name' => 'عميل ب', 'type' => 'customer'])->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٣', 'slug' => 'other-co-tenant-3']);
        app(TenantContext::class)->set($tenantB->id);
        $channelUnderB = SalesChannel::create(['slug' => 'mobile', 'name' => 'قناة ب ٢', 'type' => SalesChannel::TYPE_MOBILE]);
        Product::create(['name' => 'منتج ب ٢', 'sale_price' => 5000]);

        $this->expectException(RuntimeException::class);
        $this->orders->create(
            ['sales_channel_id' => $channelUnderB->id, 'partner_id' => $foreignPartnerId],
            $this->items(),
            trustedPartnerSelection: true,
        );
    }

    /** @test */
    public function orders_are_scoped_to_the_active_tenant(): void
    {
        $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٤', 'slug' => 'other-co-tenant-4']);
        app(TenantContext::class)->set($tenantB->id);

        $this->assertSame(0, CommerceOrder::query()->count(), 'طلب مستأجرٍ آخر لا يظهر تحت هذا السياق.');
    }

    // ═══════════════════════════════════════════════════════════
    //  Atomicity
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_invalid_line_rolls_back_the_whole_order_creation(): void
    {
        $items = [
            ['product_id' => $this->product->id, 'quantity' => 2],
            ['product_id' => (string) \Illuminate\Support\Str::uuid(), 'quantity' => 1],
        ];

        try {
            $this->orders->create(['sales_channel_id' => $this->channel->id], $items);
            $this->fail('كان يجب أن يفشل السطر الثاني.');
        } catch (RuntimeException) {
            // متوقَّع.
        }

        $this->assertSame(0, CommerceOrder::query()->count(), 'لا يبقى رأسٌ يتيم بعد فشل سطر.');
        $this->assertSame(0, CommerceOrderLine::query()->count(), 'لا يبقى سطرٌ جزئي بعد فشل المعاملة.');
    }

    // ═══════════════════════════════════════════════════════════
    //  Confirmation semantics
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function confirming_a_draft_order_transitions_it_to_confirmed(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());

        $confirmed = $this->orders->confirm($order);

        $this->assertTrue($confirmed->isConfirmed());
        $this->assertNotNull($confirmed->confirmed_at);
    }

    /** @test */
    public function confirming_an_already_confirmed_order_is_rejected(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());
        $this->orders->confirm($order);

        $this->expectException(RuntimeException::class);
        $this->orders->confirm($order);
    }

    /** @test */
    public function confirmation_does_not_mutate_line_snapshots(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items(2));
        $before = $order->lines->first()->unit_price;

        $confirmed = $this->orders->confirm($order);

        $this->assertSame($before, $confirmed->lines->first()->unit_price);
    }

    // ═══════════════════════════════════════════════════════════
    //  Deletion semantics
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_draft_order_can_be_deleted(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());

        $order->delete();

        $this->assertSame(0, CommerceOrder::query()->count());
    }

    /** @test */
    public function a_confirmed_order_cannot_be_deleted(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());
        $confirmed = $this->orders->confirm($order);

        $this->expectException(LogicException::class);
        $confirmed->delete();
    }

    // ═══════════════════════════════════════════════════════════
    //  Absolute boundaries — creation AND confirmation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function creating_and_confirming_an_order_has_zero_inventory_or_accounting_effect(): void
    {
        $warehouse = Warehouse::create(['name' => 'مخزن الطلب', 'code' => 'CORD-W1', 'is_default' => true]);
        ProductWarehouseStock::create(['product_id' => $this->product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 100]);

        $before = app(AvailableToSellService::class)->forWarehouse($this->product->id, $warehouse->id);

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items(5));
        $this->orders->confirm($order);

        $after = app(AvailableToSellService::class)->forWarehouse($this->product->id, $warehouse->id);

        // On Hand وATS بلا تغيير — لا حجز أُنشئ (PR-COM-5B مسؤولية لاحقة).
        $this->assertSame($before->onHand, $after->onHand);
        $this->assertSame($before->availableToSell, $after->availableToSell);

        $this->assertSame(0, InventoryReservation::query()->count(), 'لا حجز مخزوني.');
        $this->assertSame(0, StockMovement::query()->count(), 'لا حركة مخزون.');
        $this->assertSame(0, Invoice::query()->count(), 'لا فاتورة.');
        $this->assertSame(0, Payment::query()->count(), 'لا دفعة.');
        $this->assertSame(0, JournalEntry::query()->count(), 'لا قيد محاسبي — لا أثر ZATCA بلا فاتورة أصلاً.');

        $this->assertSame(0, $this->product->fresh()->quantity_on_hand, 'لا تغيير على كمية المنتج الإجمالية — لم تصدر أي حركة مخزون.');
    }

    /** @test */
    public function creating_an_order_creates_no_commerce_listing_or_fulfillment_policy(): void
    {
        $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());

        $this->assertSame(0, \App\Models\CommerceListing::query()->count());
        $this->assertSame(0, \App\Models\FulfillmentPolicy::query()->count());
    }
}
