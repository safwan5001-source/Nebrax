<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderLine;
use App\Models\Invoice;
use App\Models\InventoryReservation;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\SalesChannel;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Models\Warehouse;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CommerceOrderReservationService;
use App\Services\Commerce\CommerceOrderService;
use App\Services\Commerce\FulfillmentPolicyNotConfiguredException;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\Commerce\InsufficientAvailabilityException;
use App\Services\Commerce\InventoryReservationIdempotencyConflictException;
use App\Services\Commerce\InventoryReservationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-5B — Order Reservation Orchestration (ADR-01/ADR-02)
 * ═══════════════════════════════════════════════════════════════
 *  يربط CommerceOrder مؤكَّداً بحجزٍ مخزوني حقيقي عبر InventoryReservationService
 *  (COM-1B) وFulfillmentPolicyService (COM-2B) حصراً — بلا إعادة تنفيذ ATS
 *  أو تزامن أو idempotency. طلب مسودة لا يُحجز؛ الحجز لا يغيّر On Hand ولا
 *  يولّد StockMovement أو أثراً محاسبياً.
 *
 *  تشغيل: php artisan test --filter=CommerceOrderReservationServiceTest
 */
class CommerceOrderReservationServiceTest extends TestCase
{
    use RefreshDatabase;

    private CommerceOrderReservationService $orchestrator;
    private CommerceOrderService $orders;
    private FulfillmentPolicyService $policies;
    private InventoryReservationService $reservations;
    private Product $product;
    private SalesChannel $channel;
    private Warehouse $warehouse;

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenant->id);

        $this->product = Product::create(['name' => 'منتج حجز طلب', 'sale_price' => 15000, 'track_inventory' => true]);
        $this->channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'متجرنا', 'type' => SalesChannel::TYPE_MOBILE]);
        $this->warehouse = Warehouse::create(['name' => 'مخزن حجز طلب', 'code' => 'CORD-W1', 'is_default' => true]);

        $this->orchestrator = app(CommerceOrderReservationService::class);
        $this->orders = app(CommerceOrderService::class);
        $this->policies = app(FulfillmentPolicyService::class);
        $this->reservations = app(InventoryReservationService::class);
    }

    private function setOnHand(int $quantity, ?Product $product = null, ?Warehouse $warehouse = null): void
    {
        ProductWarehouseStock::updateOrCreate(
            ['product_id' => ($product ?? $this->product)->id, 'warehouse_id' => ($warehouse ?? $this->warehouse)->id],
            ['quantity' => $quantity]
        );
    }

    private function confirmedOrder(int $quantity = 3, ?Product $product = null): CommerceOrder
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => ($product ?? $this->product)->id, 'quantity' => $quantity],
        ]);

        return $this->orders->confirm($order);
    }

    // ═══════════════════════════════════════════════════════════
    //  Eligibility
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_confirmed_order_can_reserve(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $order = $this->confirmedOrder(3);
        $result = $this->orchestrator->reserve($order);

        $this->assertCount(1, $result);
        $this->assertTrue($result->first()->isActive());
    }

    /** @test */
    public function a_draft_order_cannot_reserve(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => $this->product->id, 'quantity' => 3],
        ]);

        $this->expectException(RuntimeException::class);
        $this->orchestrator->reserve($order);
    }

    /** @test */
    public function a_cross_tenant_order_is_rejected(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);

        $tenantB = Tenant::create(['name' => 'شركة أخرى', 'slug' => 'other-cor-tenant-1']);
        app(TenantContext::class)->set($tenantB->id);

        $this->expectException(RuntimeException::class);
        $this->orchestrator->reserve($order);
    }

    // ═══════════════════════════════════════════════════════════
    //  Fulfillment / warehouse resolution
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function the_warehouse_is_resolved_through_fulfillment_policy_service(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);

        $result = $this->orchestrator->reserve($order);

        $this->assertSame($this->warehouse->id, $result->first()->warehouse_id);
    }

    /** @test */
    public function no_configured_policy_fails_explicitly(): void
    {
        $this->setOnHand(10);
        $order = $this->confirmedOrder(3);

        $this->expectException(FulfillmentPolicyNotConfiguredException::class);
        $this->orchestrator->reserve($order);
    }

    /** @test */
    public function a_disabled_channel_fails_explicitly_even_with_a_configured_policy(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);
        $this->channel->update(['is_active' => false]);

        $this->expectException(FulfillmentPolicyNotConfiguredException::class);
        $this->orchestrator->reserve($order);
    }

    /** @test */
    public function an_inactive_policy_warehouse_fails_explicitly(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);
        $this->warehouse->update(['is_active' => false]);

        $this->expectException(FulfillmentPolicyNotConfiguredException::class);
        $this->orchestrator->reserve($order);
    }

    /** @test */
    public function there_is_no_branch_to_warehouse_assumption(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);

        // لا branch_id على CommerceOrder أصلاً (CompanyWide) — التحقق أن الحجز
        // يتم دائماً عبر FulfillmentPolicy فقط، لا سياق فرع نشط عابر.
        $this->assertArrayNotHasKey('branch_id', $order->getAttributes());

        $result = $this->orchestrator->reserve($order);
        $this->assertSame($this->warehouse->id, $result->first()->warehouse_id);
    }

    // ═══════════════════════════════════════════════════════════
    //  Quantities / UOM
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function base_quantity_comes_from_the_order_line_snapshot(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(4);

        $result = $this->orchestrator->reserve($order);

        $this->assertSame(4, $result->first()->base_quantity);
        $this->assertSame($order->lines->first()->baseQuantity(), $result->first()->base_quantity);
    }

    /** @test */
    public function an_alternate_uom_factor_produces_the_correct_base_reservation(): void
    {
        $template = UnitTemplate::create(['name' => 'قالب كراتين حجز', 'base_unit' => 'piece']);
        $template->units()->create(['name' => 'carton', 'factor' => 24]);
        $boxed = Product::create([
            'name' => 'منتج كراتين حجز', 'unit' => 'piece', 'unit_template_id' => $template->id,
            'sale_price' => 500, 'track_inventory' => true,
        ]);
        $this->setOnHand(1000, $boxed);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        // وحدة بديلة تحتاج بند قائمة أسعار صريحاً كي يُحسم لها سعر (COM-4A) —
        // نفس عقد CommercePriceResolver حرفياً، لا علاقة له بالحجز نفسه.
        $priceList = \App\Models\PriceList::create(['name' => 'قائمة كراتين حجز', 'is_active' => true]);
        app(\App\Services\PriceListService::class)->upsertItem($priceList, $boxed, ['unit_name' => 'carton', 'price' => 10800]);
        $partner = \App\Models\Partner::create(['name' => 'عميل كراتين حجز', 'type' => 'customer', 'default_price_list_id' => $priceList->id]);

        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id, 'partner_id' => $partner->id,
        ], [
            ['product_id' => $boxed->id, 'quantity' => 3, 'unit_name' => 'carton'],
        ]);
        $order = $this->orders->confirm($order);

        $result = $this->orchestrator->reserve($order);

        $this->assertSame(72, $result->first()->base_quantity, '٣ كراتين × معامل ٢٤ = ٧٢ وحدة أساس.');
    }

    /** @test */
    public function multiple_lines_reserve_the_correct_quantities_each(): void
    {
        $productB = Product::create(['name' => 'منتج ثانٍ حجز', 'sale_price' => 5000, 'track_inventory' => true]);
        $this->setOnHand(10, $this->product);
        $this->setOnHand(20, $productB);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => $this->product->id, 'quantity' => 3],
            ['product_id' => $productB->id, 'quantity' => 5],
        ]);
        $order = $this->orders->confirm($order);

        $result = $this->orchestrator->reserve($order);

        $this->assertCount(2, $result);
        $byProduct = $result->keyBy('product_id');
        $this->assertSame(3, $byProduct[$this->product->id]->base_quantity);
        $this->assertSame(5, $byProduct[$productB->id]->base_quantity);
    }

    // ═══════════════════════════════════════════════════════════
    //  Inventory boundary
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function reservation_never_changes_on_hand_and_active_reserved_increases(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(7);

        $this->orchestrator->reserve($order);

        $stock = ProductWarehouseStock::query()
            ->where('product_id', $this->product->id)->where('warehouse_id', $this->warehouse->id)->first();
        $this->assertSame(10, $stock->quantity, 'On Hand بلا تغيير.');
        $this->assertSame(7, $this->reservations->activeReservedQuantity($this->product->id, $this->warehouse->id));
    }

    /** @test */
    public function ats_decreases_correctly_after_reservation(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(7);

        $this->orchestrator->reserve($order);

        $ats = app(AvailableToSellService::class)->forWarehouse($this->product->id, $this->warehouse->id);
        $this->assertSame(10, $ats->onHand);
        $this->assertSame(7, $ats->activeReserved);
        $this->assertSame(3, $ats->availableToSell);
    }

    /** @test */
    public function no_stock_movement_or_avg_cost_change_occurs(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $avgCostBefore = $this->product->avg_cost;
        $order = $this->confirmedOrder(7);

        $this->orchestrator->reserve($order);

        $this->assertSame(0, StockMovement::query()->count());
        $this->assertSame($avgCostBefore, $this->product->fresh()->avg_cost);
    }

    // ═══════════════════════════════════════════════════════════
    //  Atomicity
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function multi_line_success_commits_all_reservations(): void
    {
        $productB = Product::create(['name' => 'منتج ثالث حجز', 'sale_price' => 5000, 'track_inventory' => true]);
        $this->setOnHand(10, $this->product);
        $this->setOnHand(10, $productB);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => $this->product->id, 'quantity' => 3],
            ['product_id' => $productB->id, 'quantity' => 4],
        ]);
        $order = $this->orders->confirm($order);

        $result = $this->orchestrator->reserve($order);

        $this->assertCount(2, $result);
        $this->assertSame(2, InventoryReservation::query()->where('status', InventoryReservation::STATUS_ACTIVE)->count());
    }

    /** @test */
    public function an_insufficient_later_line_rolls_back_all_newly_acquired_reservations(): void
    {
        $productB = Product::create(['name' => 'منتج ناقص حجز', 'sale_price' => 5000, 'track_inventory' => true]);
        $this->setOnHand(10, $this->product);   // كافٍ للسطر الأول
        $this->setOnHand(2, $productB);         // غير كافٍ للسطر الثاني
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => $this->product->id, 'quantity' => 5],
            ['product_id' => $productB->id, 'quantity' => 9],
        ]);
        $order = $this->orders->confirm($order);

        try {
            $this->orchestrator->reserve($order);
            $this->fail('كان يجب أن يفشل السطر الثاني بنقص الإتاحة.');
        } catch (InsufficientAvailabilityException) {
            // متوقَّع.
        }

        $this->assertSame(0, InventoryReservation::query()->count(), 'لا يبقى حجزٌ للسطر الأول بعد تراجع كامل الطلب.');
        $this->assertSame(0, $this->reservations->activeReservedQuantity($this->product->id, $this->warehouse->id), 'لا طلب نصف محجوز.');
    }

    // ═══════════════════════════════════════════════════════════
    //  Idempotency / retry
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function retrying_the_same_order_does_not_duplicate_reservations(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);

        $first = $this->orchestrator->reserve($order);
        $second = $this->orchestrator->reserve($order);

        $this->assertSame($first->first()->id, $second->first()->id, 'إعادة المحاولة تعيد نفس الحجز، لا حجزاً ثانياً.');
        $this->assertSame(1, InventoryReservation::query()->count());
        $this->assertSame(3, $this->reservations->activeReservedQuantity($this->product->id, $this->warehouse->id));
    }

    /** @test */
    public function a_changed_warehouse_between_retries_conflicts_instead_of_silently_reserving_twice(): void
    {
        $warehouseB = Warehouse::create(['name' => 'مخزن بديل حجز', 'code' => 'CORD-W2']);
        $this->setOnHand(10, $this->product, $this->warehouse);
        $this->setOnHand(10, $this->product, $warehouseB);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);

        $this->orchestrator->reserve($order);

        // إعادة ضبط السياسة لمخزنٍ آخر بين المحاولتين — نفس مفتاح idempotency
        // (مشتقٌّ من هوية الطلب/السطر الثابتة) لكن ببصمة طلبٍ مختلفة الآن.
        $this->policies->setFixedWarehouse($this->channel->id, $warehouseB->id);

        $this->expectException(InventoryReservationIdempotencyConflictException::class);
        $this->orchestrator->reserve($order);
    }

    // ═══════════════════════════════════════════════════════════
    //  Concurrency (functional-level; real OS-process proof is in
    //  CommerceOrderReservationPostgresConcurrencyTest)
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function active_reserved_never_exceeds_on_hand_after_sequential_orders(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $orderA = $this->confirmedOrder(7);
        $this->orchestrator->reserve($orderA);

        $orderB = $this->confirmedOrder(7);
        $this->expectException(InsufficientAvailabilityException::class);
        $this->orchestrator->reserve($orderB);
    }

    /** @test */
    public function ats_never_goes_negative(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(10);

        $this->orchestrator->reserve($order);

        $ats = app(AvailableToSellService::class)->forWarehouse($this->product->id, $this->warehouse->id);
        $this->assertSame(0, $ats->availableToSell);
        $this->assertGreaterThanOrEqual(0, $ats->availableToSell);
    }

    // ═══════════════════════════════════════════════════════════
    //  Tenant isolation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_cross_tenant_product_reference_cannot_be_reserved(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);
        $foreignProductId = $this->product->id;

        // سطرٌ مبني مباشرة (تحايل على تحقق COM-5A نفسه) بمرجع منتج مستأجرٍ آخر،
        // لإثبات أن طبقة الحجز نفسها ترفضه ولا تثق بحالة الكائن الممرَّر فقط.
        $tenantB = Tenant::create(['name' => 'شركة حجز أخرى', 'slug' => 'other-cor-tenant-2']);
        app(TenantContext::class)->set($tenantB->id);
        $channelB = SalesChannel::create(['slug' => 'mobile', 'name' => 'قناة حجز ب', 'type' => SalesChannel::TYPE_MOBILE]);
        $warehouseB = Warehouse::create(['name' => 'مخزن حجز ب', 'code' => 'CORD-WB']);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($channelB->id, $warehouseB->id);
        $productB = Product::create(['name' => 'منتج حجز ب', 'sale_price' => 5000, 'track_inventory' => true]);
        ProductWarehouseStock::create(['product_id' => $productB->id, 'warehouse_id' => $warehouseB->id, 'quantity' => 10]);

        $orderB = CommerceOrder::create([
            'sales_channel_id' => $channelB->id, 'number' => 'CORD-X-00001', 'status' => CommerceOrder::STATUS_CONFIRMED,
        ]);
        CommerceOrderLine::create([
            'commerce_order_id' => $orderB->id, 'product_id' => $foreignProductId,
            'product_name_snapshot' => 'مرجع منتج مستأجر آخر', 'quantity' => 1, 'unit_factor' => 1, 'unit_price' => 1000, 'line_total' => 1000,
        ]);

        $this->expectException(RuntimeException::class);
        $this->orchestrator->reserve($orderB);
    }

    /** @test */
    public function a_reservation_cannot_be_replayed_across_tenants(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);
        $this->orchestrator->reserve($order);

        $tenantB = Tenant::create(['name' => 'شركة حجز ثالثة', 'slug' => 'other-cor-tenant-3']);
        app(TenantContext::class)->set($tenantB->id);

        $this->assertSame(0, InventoryReservation::query()->count(), 'حجز مستأجرٍ آخر غير مرئي ولا قابل لإعادة التشغيل هنا.');
    }

    /** @test */
    public function source_identity_never_leaks_across_tenants(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);
        $this->orchestrator->reserve($order);

        $tenantB = Tenant::create(['name' => 'شركة حجز رابعة', 'slug' => 'other-cor-tenant-4']);
        app(TenantContext::class)->set($tenantB->id);

        // fail-closed (P1-3): كائن طلبٍ من مستأجرٍ آخر يُرفض صراحةً، لا يعيد
        // مجموعة فارغة بصمت — نفس اصطلاح reserve() تماماً.
        $this->expectException(RuntimeException::class);
        $this->orchestrator->reservationsFor($order);
    }

    // ═══════════════════════════════════════════════════════════
    //  Absolute boundaries
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function reservation_never_mutates_the_order_price_snapshot_or_total(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);
        $priceBefore = $order->lines->first()->unit_price;
        $totalBefore = $order->total;

        $this->orchestrator->reserve($order);

        $order->refresh();
        $this->assertSame($priceBefore, $order->lines->first()->fresh()->unit_price);
        $this->assertSame($totalBefore, $order->total);
    }

    /** @test */
    public function reservation_creates_no_accounting_or_zatca_artifact(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);

        $this->orchestrator->reserve($order);

        $this->assertSame(0, Invoice::query()->count(), 'لا فاتورة — ولا أثر ZATCA بلا فاتورة أصلاً.');
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
    }

    /** @test */
    public function reservationsFor_returns_the_reservations_linked_to_the_order(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);

        $reserved = $this->orchestrator->reserve($order);
        $linked = $this->orchestrator->reservationsFor($order);

        $this->assertSame($reserved->first()->id, $linked->first()->id);
        $this->assertSame(\App\Models\CommerceOrder::class, $linked->first()->source_type);
        $this->assertSame($order->id, $linked->first()->source_id);
    }

    // ═══════════════════════════════════════════════════════════
    //  Post-Review P1-1 — Non-inventory order lines (ADR-02 §9)
    // ═══════════════════════════════════════════════════════════

    private function nonTrackedProduct(string $name = 'خدمة حجز'): Product
    {
        // track_inventory الافتراض الفعلي على Product هو false — لا حاجة لتمريره صراحة،
        // لكنه مُثبَّت هنا بوضوح ليعكس نيّة الاختبار لا الاعتماد على افتراض ضمني فقط.
        return Product::create(['name' => $name, 'sale_price' => 20000, 'track_inventory' => false]);
    }

    /** @test */
    public function an_order_of_only_non_inventory_products_reserves_nothing_and_succeeds(): void
    {
        $service = $this->nonTrackedProduct();
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => $service->id, 'quantity' => 1],
        ]);
        $order = $this->orders->confirm($order);

        $result = $this->orchestrator->reserve($order);

        $this->assertCount(0, $result, 'طلبٌ كله خدمات ينجح بمجموعة حجوزات فارغة — ليس فشلاً.');
        $this->assertSame(0, InventoryReservation::query()->count());
    }

    /** @test */
    public function a_mixed_order_reserves_only_the_tracked_line(): void
    {
        $service = $this->nonTrackedProduct();
        $this->setOnHand(10, $this->product);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => $this->product->id, 'quantity' => 4],
            ['product_id' => $service->id, 'quantity' => 1],
        ]);
        $order = $this->orders->confirm($order);

        $result = $this->orchestrator->reserve($order);

        $this->assertCount(1, $result, 'سطر الخدمة لا يُنتج حجزاً.');
        $this->assertSame($this->product->id, $result->first()->product_id);
        $this->assertSame(4, $result->first()->base_quantity);
    }

    /** @test */
    public function a_non_tracked_line_never_affects_on_hand_ats_or_stock_movement(): void
    {
        $service = $this->nonTrackedProduct();
        $this->setOnHand(10, $this->product);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => $this->product->id, 'quantity' => 4],
            ['product_id' => $service->id, 'quantity' => 2],
        ]);
        $order = $this->orders->confirm($order);

        $this->orchestrator->reserve($order);

        $stock = ProductWarehouseStock::query()
            ->where('product_id', $this->product->id)->where('warehouse_id', $this->warehouse->id)->first();
        $this->assertSame(10, $stock->quantity, 'On Hand بلا تغيير — لا للسطر المتتبَّع ولا لسطر الخدمة.');

        $ats = app(AvailableToSellService::class)->forWarehouse($this->product->id, $this->warehouse->id);
        $this->assertSame(4, $ats->activeReserved, 'المحجوز النشط = سطر المتتبَّع فقط.');
        $this->assertSame(6, $ats->availableToSell);

        $this->assertSame(0, StockMovement::query()->count(), 'لا حركة مخزون لأي سطر — متتبَّع أو خدمة.');
    }

    /** @test */
    public function a_non_tracked_line_creates_no_accounting_or_zatca_effect(): void
    {
        $service = $this->nonTrackedProduct();
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => $service->id, 'quantity' => 1],
        ]);
        $order = $this->orders->confirm($order);

        $this->orchestrator->reserve($order);

        $this->assertSame(0, Invoice::query()->count());
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
    }

    /** @test */
    public function retrying_a_mixed_order_remains_idempotent(): void
    {
        $service = $this->nonTrackedProduct();
        $this->setOnHand(10, $this->product);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], [
            ['product_id' => $this->product->id, 'quantity' => 4],
            ['product_id' => $service->id, 'quantity' => 1],
        ]);
        $order = $this->orders->confirm($order);

        $first = $this->orchestrator->reserve($order);
        $second = $this->orchestrator->reserve($order);

        $this->assertCount(1, $first);
        $this->assertCount(1, $second);
        $this->assertSame($first->first()->id, $second->first()->id, 'إعادة المحاولة تعيد نفس الحجز الوحيد، لا حجزاً ثانياً ولا حجزاً وهمياً لسطر الخدمة.');
        $this->assertSame(1, InventoryReservation::query()->count());
    }

    // ═══════════════════════════════════════════════════════════
    //  Post-Review P1-3 — reservationsFor() fails closed
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function reservationsFor_fails_closed_without_an_active_tenant_context(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);
        $this->orchestrator->reserve($order);

        app(TenantContext::class)->forget();

        $this->expectException(RuntimeException::class);
        $this->orchestrator->reservationsFor($order);
    }

    /** @test */
    public function reservationsFor_returns_only_the_current_tenants_own_reservations(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $order = $this->confirmedOrder(3);
        $this->orchestrator->reserve($order);

        $linked = $this->orchestrator->reservationsFor($order);

        $this->assertCount(1, $linked);
    }

    /** @test */
    public function switching_tenant_context_cannot_reuse_a_stale_order_object_to_read_another_tenants_reservations(): void
    {
        $this->setOnHand(10);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $orderA = $this->confirmedOrder(3);
        $this->orchestrator->reserve($orderA);
        $tenantAId = app(TenantContext::class)->id();

        // مستأجرٌ ثانٍ حقيقي بحجزه الخاص — لإثبات عدم التلوث في الاتجاهين.
        $tenantB = Tenant::create(['name' => 'شركة حجز خامسة', 'slug' => 'other-cor-tenant-5']);
        app(TenantContext::class)->set($tenantB->id);
        $productB = Product::create(['name' => 'منتج حجز خامس', 'sale_price' => 5000, 'track_inventory' => true]);
        $channelB = SalesChannel::create(['slug' => 'mobile', 'name' => 'قناة حجز خامسة', 'type' => SalesChannel::TYPE_MOBILE]);
        $warehouseB = Warehouse::create(['name' => 'مخزن حجز خامس', 'code' => 'CORD-WE']);
        ProductWarehouseStock::create(['product_id' => $productB->id, 'warehouse_id' => $warehouseB->id, 'quantity' => 10]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($channelB->id, $warehouseB->id);
        $orderB = $this->orders->create(['sales_channel_id' => $channelB->id], [
            ['product_id' => $productB->id, 'quantity' => 2],
        ]);
        $orderB = $this->orders->confirm($orderB);
        $this->orchestrator->reserve($orderB);

        // كائن الطلب A نفسه (القديم) لا يزال بحوزتنا — العودة إلى سياق مستأجره
        // الحقيقي يجب أن يُعيد حجزه هو فقط، لا حجز B الذي أُنشئ أثناء تبديل السياق.
        app(TenantContext::class)->set($tenantAId);
        $linkedA = $this->orchestrator->reservationsFor($orderA);
        $this->assertCount(1, $linkedA);
        $this->assertSame($orderA->id, $linkedA->first()->source_id);
    }

    /** @test */
    public function no_tenant_scope_bypass_was_introduced_to_fix_reservationsFor(): void
    {
        $source = file_get_contents(app_path('Services/Commerce/CommerceOrderReservationService.php'));

        $this->assertStringNotContainsString(
            'withoutGlobalScope(TenantScope::class)',
            $source,
            'لا يجوز تجاوز TenantScope إطلاقاً لإصلاح P1-3 — الإصلاح الصحيح تحقّقٌ صريح من السياق، لا تجاوز العزل.'
        );
    }
}
