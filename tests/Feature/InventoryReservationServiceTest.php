<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InventoryReservation;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\InsufficientAvailabilityException;
use App\Services\Commerce\InvalidReservationStateTransitionException;
use App\Services\Commerce\InventoryReservationIdempotencyConflictException;
use App\Services\Commerce\InventoryReservationService;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-1B — Inventory Reservation (ADR-02)
 * ═══════════════════════════════════════════════════════════════
 *  حجزٌ تشغيلي فقط: لا `StockMovement`، لا قيدٌ محاسبي، لا تعديل على
 *  `products.quantity_on_hand`/`avg_cost`. ATS = max(0, On Hand - Active
 *  Reserved) عبر `AvailableToSellService` بعد أن يستهلك `activeReserved`
 *  الحقيقي من `InventoryReservationService`.
 *
 *  اختبارات تزامن PostgreSQL الحقيقية منفصلة في
 *  `InventoryReservationPostgresConcurrencyTest` — هذا الملف وظيفي/متسلسل
 *  ويعمل على أي محرك (SQLite أو PostgreSQL) في CI.
 *
 *  تشغيل: php artisan test --filter=InventoryReservationServiceTest
 */
class InventoryReservationServiceTest extends TestCase
{
    use RefreshDatabase;

    private InventoryReservationService $reservations;
    private AvailableToSellService $ats;
    private Warehouse $warehouse;
    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenant->id);

        $this->warehouse = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'RES-W1', 'is_default' => true]);
        $this->product = Product::create(['name' => 'منتج حجز', 'track_inventory' => true]);
        $this->reservations = app(InventoryReservationService::class);
        $this->ats = app(AvailableToSellService::class);
    }

    private function setOnHand(Product $product, Warehouse $warehouse, int $quantity): void
    {
        ProductWarehouseStock::updateOrCreate(
            ['product_id' => $product->id, 'warehouse_id' => $warehouse->id],
            ['quantity' => $quantity]
        );
    }

    private function acquire(int $quantity, string $key, ?Product $product = null, ?Warehouse $warehouse = null): InventoryReservation
    {
        return $this->reservations->acquire(
            ($product ?? $this->product)->id,
            ($warehouse ?? $this->warehouse)->id,
            $quantity,
            $key,
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  Reservation creation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function it_creates_an_active_reservation_when_ats_is_sufficient(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);

        $reservation = $this->acquire(7, 'key-1');

        $this->assertSame(InventoryReservation::STATUS_ACTIVE, $reservation->status);
        $this->assertTrue($reservation->isActive());
        $this->assertSame($this->product->id, $reservation->product_id);
        $this->assertSame($this->warehouse->id, $reservation->warehouse_id);
    }

    /** @test */
    public function the_reservation_quantity_is_stored_verbatim_as_base_units(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 48);

        $reservation = $this->acquire(48, 'key-base-qty');

        $this->assertSame(48, $reservation->base_quantity);
        $this->assertIsInt($reservation->base_quantity);
    }

    /** @test */
    public function it_rejects_a_zero_or_negative_quantity(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);

        foreach ([0, -1, -100] as $quantity) {
            try {
                $this->acquire($quantity, 'key-zero-neg-' . $quantity);
                $this->fail('كان يجب رفض كمية غير موجبة.');
            } catch (RuntimeException $e) {
                $this->assertNotInstanceOf(InsufficientAvailabilityException::class, $e);
            }
        }

        $this->assertSame(0, InventoryReservation::count());
    }

    /** @test */
    public function it_rejects_when_available_to_sell_is_insufficient(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 5);

        $this->expectException(InsufficientAvailabilityException::class);
        $this->acquire(6, 'key-insufficient');
    }

    // ═══════════════════════════════════════════════════════════
    //  ATS integration
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function ats_decreases_after_an_active_reservation(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $this->acquire(7, 'key-ats-1');

        $snapshot = $this->ats->forWarehouse($this->product->id, $this->warehouse->id);

        $this->assertSame(10, $snapshot->onHand);
        $this->assertSame(7, $snapshot->activeReserved);
        $this->assertSame(3, $snapshot->availableToSell);
    }

    /** @test */
    public function a_released_reservation_no_longer_reduces_ats(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $reservation = $this->acquire(7, 'key-release-ats');

        $this->reservations->release($reservation->id);

        $snapshot = $this->ats->forWarehouse($this->product->id, $this->warehouse->id);
        $this->assertSame(0, $snapshot->activeReserved);
        $this->assertSame(10, $snapshot->availableToSell);
    }

    /** @test */
    public function a_consumed_reservation_no_longer_reduces_ats(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $reservation = $this->acquire(7, 'key-consume-ats');

        $this->reservations->consume($reservation->id);

        $snapshot = $this->ats->forWarehouse($this->product->id, $this->warehouse->id);
        $this->assertSame(0, $snapshot->activeReserved);
    }

    /** @test */
    public function an_expired_reservation_no_longer_reduces_ats(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $reservation = $this->acquire(7, 'key-expire-ats');

        $this->reservations->expire($reservation->id);

        $snapshot = $this->ats->forWarehouse($this->product->id, $this->warehouse->id);
        $this->assertSame(0, $snapshot->activeReserved);
    }

    /** @test */
    public function multiple_active_reservations_aggregate_correctly(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);

        $this->acquire(3, 'key-multi-1');
        $this->acquire(2, 'key-multi-2');
        $this->acquire(1, 'key-multi-3');

        $snapshot = $this->ats->forWarehouse($this->product->id, $this->warehouse->id);
        $this->assertSame(6, $snapshot->activeReserved);
        $this->assertSame(4, $snapshot->availableToSell);
    }

    /** @test */
    public function negative_legacy_on_hand_still_clamps_ats_to_zero_with_reservations_in_play(): void
    {
        $this->setOnHand($this->product, $this->warehouse, -5);

        $this->expectException(InsufficientAvailabilityException::class);
        $this->acquire(1, 'key-negative-on-hand');
    }

    // ═══════════════════════════════════════════════════════════
    //  Idempotency
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function the_same_idempotency_key_does_not_double_reserve(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);

        $first = $this->acquire(7, 'idem-key-1');
        $second = $this->acquire(7, 'idem-key-1');

        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, InventoryReservation::count());
        $this->assertSame(7, $this->reservations->activeReservedQuantity($this->product->id, $this->warehouse->id));
    }

    /** @test */
    public function the_same_key_with_a_materially_different_payload_is_rejected(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $this->acquire(7, 'idem-key-conflict');

        $this->expectException(InventoryReservationIdempotencyConflictException::class);
        $this->acquire(3, 'idem-key-conflict');
    }

    /** @test */
    public function idempotency_keys_are_tenant_scoped_and_never_collide_across_tenants(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $reservationA = $this->acquire(4, 'shared-literal-key');

        $tenantB = Tenant::create(['name' => 'شركة أخرى', 'slug' => 'other-tenant-res']);
        app(TenantContext::class)->set($tenantB->id);
        $warehouseB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'RES-W2', 'is_default' => true]);
        $productB = Product::create(['name' => 'منتج ب', 'track_inventory' => true]);
        $this->setOnHand($productB, $warehouseB, 10);

        $reservationB = $this->reservations->acquire($productB->id, $warehouseB->id, 4, 'shared-literal-key');

        $this->assertNotSame($reservationA->id, $reservationB->id);
        // فحصٌ عبر استعلام SQL خام لا Eloquent — يتحقّق من الواقع الفعلي في
        // الجدول بلا حاجة لتجاوز TenantScope في كود الاختبار نفسه.
        $this->assertSame(2, \Illuminate\Support\Facades\DB::table('inventory_reservations')->count());
    }

    // ═══════════════════════════════════════════════════════════
    //  Isolation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_cross_tenant_product_id_is_rejected(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $foreignProductId = $this->product->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٢', 'slug' => 'other-tenant-product']);
        app(TenantContext::class)->set($tenantB->id);
        // مخزن صالحٌ فعلاً لمستأجر ب — يعزل الفشل على المنتج وحده، لا مخزناً غريباً أيضاً.
        $warehouseUnderTenantB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'RES-W-B1']);

        $this->expectException(RuntimeException::class);
        $this->reservations->acquire($foreignProductId, $warehouseUnderTenantB->id, 1, 'cross-tenant-product-key');
    }

    /** @test */
    public function a_cross_tenant_warehouse_id_is_rejected(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $ownProductId = $this->product->id;
        $foreignWarehouseId = $this->warehouse->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٣', 'slug' => 'other-tenant-warehouse']);
        app(TenantContext::class)->set($tenantB->id);
        $productUnderTenantB = Product::create(['name' => 'منتج تحت ب', 'track_inventory' => true]);

        $this->expectException(RuntimeException::class);
        $this->reservations->acquire($productUnderTenantB->id, $foreignWarehouseId, 1, 'cross-tenant-warehouse-key');
    }

    /** @test */
    public function releasing_another_tenants_reservation_is_rejected(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $reservation = $this->acquire(5, 'cross-tenant-mutation-key');

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٤', 'slug' => 'other-tenant-mutation']);
        app(TenantContext::class)->set($tenantB->id);

        $this->expectException(ModelNotFoundException::class);
        $this->reservations->release($reservation->id);
    }

    /** @test */
    public function reservations_for_one_product_or_warehouse_never_affect_another(): void
    {
        $warehouseB = Warehouse::create(['name' => 'مخزن عزل', 'code' => 'RES-W3']);
        $productB = Product::create(['name' => 'منتج عزل', 'track_inventory' => true]);
        $this->setOnHand($this->product, $this->warehouse, 10);
        $this->setOnHand($this->product, $warehouseB, 10);
        $this->setOnHand($productB, $this->warehouse, 10);

        $this->acquire(6, 'isolation-key-1');
        $this->acquire(6, 'isolation-key-2', warehouse: $warehouseB);
        $this->acquire(6, 'isolation-key-3', product: $productB);

        $this->assertSame(6, $this->reservations->activeReservedQuantity($this->product->id, $this->warehouse->id));
        $this->assertSame(6, $this->reservations->activeReservedQuantity($this->product->id, $warehouseB->id));
        $this->assertSame(6, $this->reservations->activeReservedQuantity($productB->id, $this->warehouse->id));
    }

    // ═══════════════════════════════════════════════════════════
    //  Lifecycle
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function active_transitions_to_released(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $reservation = $this->acquire(5, 'lifecycle-release');

        $released = $this->reservations->release($reservation->id);

        $this->assertSame(InventoryReservation::STATUS_RELEASED, $released->status);
        $this->assertNotNull($released->released_at);
    }

    /** @test */
    public function active_transitions_to_consumed(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $reservation = $this->acquire(5, 'lifecycle-consume');

        $consumed = $this->reservations->consume($reservation->id);

        $this->assertSame(InventoryReservation::STATUS_CONSUMED, $consumed->status);
        $this->assertNotNull($consumed->consumed_at);
    }

    /** @test */
    public function active_transitions_to_expired(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $reservation = $this->acquire(5, 'lifecycle-expire');

        $expired = $this->reservations->expire($reservation->id);

        $this->assertSame(InventoryReservation::STATUS_EXPIRED, $expired->status);
        $this->assertNotNull($expired->expired_at);
    }

    /** @test */
    public function invalid_state_transitions_are_rejected(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 30);

        $released = $this->reservations->release($this->acquire(1, 'invalid-t-1')->id);
        $consumed = $this->reservations->consume($this->acquire(1, 'invalid-t-2')->id);
        $expired = $this->reservations->expire($this->acquire(1, 'invalid-t-3')->id);

        $cases = [
            fn () => $this->reservations->consume($released->id),   // RELEASED → CONSUMED
            fn () => $this->reservations->release($consumed->id),   // CONSUMED → RELEASED
            fn () => $this->reservations->consume($expired->id),    // EXPIRED  → CONSUMED
            fn () => $this->reservations->release($expired->id),    // EXPIRED  → RELEASED
            fn () => $this->reservations->expire($released->id),    // RELEASED → EXPIRED
            fn () => $this->reservations->expire($consumed->id),    // CONSUMED → EXPIRED
        ];

        foreach ($cases as $i => $case) {
            try {
                $case();
                $this->fail("الحالة رقم {$i} كان يجب رفضها.");
            } catch (InvalidReservationStateTransitionException $e) {
                $this->assertTrue(true);
            }
        }
    }

    /** @test */
    public function repeated_release_consume_expire_calls_are_retry_safe_no_ops(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 30);

        $r1 = $this->acquire(1, 'retry-release');
        $this->reservations->release($r1->id);
        $again = $this->reservations->release($r1->id);
        $this->assertSame(InventoryReservation::STATUS_RELEASED, $again->status);

        $r2 = $this->acquire(1, 'retry-consume');
        $this->reservations->consume($r2->id);
        $again = $this->reservations->consume($r2->id);
        $this->assertSame(InventoryReservation::STATUS_CONSUMED, $again->status);

        $r3 = $this->acquire(1, 'retry-expire');
        $this->reservations->expire($r3->id);
        $again = $this->reservations->expire($r3->id);
        $this->assertSame(InventoryReservation::STATUS_EXPIRED, $again->status);
    }

    // ═══════════════════════════════════════════════════════════
    //  Mutation boundaries — CommerceBoundary
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function no_stock_movement_is_created_across_the_full_lifecycle(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $reservation = $this->acquire(5, 'boundary-stock-movement');
        $this->reservations->consume($reservation->id);

        $this->assertSame(0, StockMovement::count());
    }

    /** @test */
    public function no_journal_entry_is_created_across_the_full_lifecycle(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $reservation = $this->acquire(5, 'boundary-journal');
        $this->reservations->release($reservation->id);

        $this->assertSame(0, JournalEntry::count());
    }

    /** @test */
    public function no_valuation_or_avg_cost_mutation_occurs(): void
    {
        $this->product->update(['quantity_on_hand' => 10, 'avg_cost' => 12345]);
        $this->setOnHand($this->product, $this->warehouse, 10);

        $reservation = $this->acquire(5, 'boundary-valuation');
        $this->reservations->consume($reservation->id);

        $this->product->refresh();
        $this->assertSame(10, $this->product->quantity_on_hand, 'الحجز لا يغيّر On Hand على مستوى المنتج.');
        $this->assertSame(12345, $this->product->avg_cost, 'الحجز لا يغيّر متوسط التكلفة.');
        $this->assertSame(
            10,
            (int) ProductWarehouseStock::where('product_id', $this->product->id)
                ->where('warehouse_id', $this->warehouse->id)->value('quantity'),
            'الحجز لا يغيّر رصيد المخزن الكمّي.'
        );
    }

    /** @test */
    public function no_invoice_or_zatca_artifact_is_created(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);
        $reservation = $this->acquire(5, 'boundary-invoice');
        $this->reservations->release($reservation->id);
        $this->reservations->acquire($this->product->id, $this->warehouse->id, 5, 'boundary-invoice-2');

        $this->assertSame(0, Invoice::count());
    }
}
