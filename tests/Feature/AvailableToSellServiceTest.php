<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\StockPermitService;
use App\Services\Commerce\AvailableToSellService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-1A — Available-to-Sell read model
 * ═══════════════════════════════════════════════════════════════
 *  ATS = max(0, On Hand - Active Reserved)، وActive Reserved = 0 حصراً في
 *  هذه المرحلة (PR-COM-1B وحدها تملأ حجزاً حقيقياً). كل اختبار هنا يقرأ عبر
 *  `AvailableToSellService` فقط، ولا يفترض جدولاً موازياً — الحقيقة الوحيدة
 *  هي `product_warehouse_stock.quantity`، نفس ما يقرأه
 *  `InventoryService::assertStockAvailable()` اليوم.
 *
 *  تشغيل: php artisan test --filter=AvailableToSellServiceTest
 */
class AvailableToSellServiceTest extends TestCase
{
    use RefreshDatabase;

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

        $this->warehouse = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'ATS-W1', 'is_default' => true]);
        $this->product = Product::create(['name' => 'منتج اختبار ATS', 'track_inventory' => true]);
        $this->ats = app(AvailableToSellService::class);
    }

    private function setOnHand(Product $product, Warehouse $warehouse, int $quantity): void
    {
        ProductWarehouseStock::updateOrCreate(
            ['product_id' => $product->id, 'warehouse_id' => $warehouse->id],
            ['quantity' => $quantity]
        );
    }

    /** @test */
    public function positive_on_hand_is_fully_available(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);

        $snapshot = $this->ats->forWarehouse($this->product->id, $this->warehouse->id);

        $this->assertSame(10, $snapshot->onHand);
        $this->assertSame(0, $snapshot->activeReserved);
        $this->assertSame(10, $snapshot->availableToSell);
    }

    /** @test */
    public function zero_on_hand_is_zero_available(): void
    {
        // لا صفّ إطلاقاً في product_warehouse_stock لهذا المنتج/المخزن — حالة
        // طبيعية (لا حركة مخزون بعد)، لا خطأ.
        $snapshot = $this->ats->forWarehouse($this->product->id, $this->warehouse->id);

        $this->assertSame(0, $snapshot->onHand);
        $this->assertSame(0, $snapshot->availableToSell);
    }

    /** @test */
    public function negative_legacy_on_hand_floors_available_to_sell_without_hiding_the_deficit(): void
    {
        $this->setOnHand($this->product, $this->warehouse, -5);

        $snapshot = $this->ats->forWarehouse($this->product->id, $this->warehouse->id);

        $this->assertSame(-5, $snapshot->onHand, 'العجز التاريخي يبقى ظاهراً في on_hand — ATS لا يغيّر On Hand.');
        $this->assertSame(0, $snapshot->availableToSell, 'ATS لا يعرض رقماً سالباً أبداً.');
    }

    /** @test */
    public function tenant_a_inventory_never_leaks_into_tenant_bs_ats(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 25);

        $tenantB = Tenant::create(['name' => 'شركة أخرى', 'slug' => 'other-tenant']);
        app(TenantContext::class)->set($tenantB->id);

        // معرّفا المنتج والمخزن ينتميان لمستأجر آخر — لا يُحلّان أصلاً تحت
        // سياق مستأجر ب، فيُرفَضان بدل إرجاع رقمٍ مسرَّب.
        $this->expectException(RuntimeException::class);
        $this->ats->forWarehouse($this->product->id, $this->warehouse->id);
    }

    /** @test */
    public function ats_for_one_warehouse_never_mixes_stock_from_another_warehouse(): void
    {
        $warehouseB = Warehouse::create(['name' => 'مخزن ثانٍ', 'code' => 'ATS-W2']);
        $this->setOnHand($this->product, $this->warehouse, 40);
        $this->setOnHand($this->product, $warehouseB, 7);

        $snapshotA = $this->ats->forWarehouse($this->product->id, $this->warehouse->id);
        $snapshotB = $this->ats->forWarehouse($this->product->id, $warehouseB->id);

        $this->assertSame(40, $snapshotA->onHand);
        $this->assertSame(7, $snapshotB->onHand);
    }

    /** @test */
    public function product_as_stock_never_leaks_into_product_bs_ats(): void
    {
        $productB = Product::create(['name' => 'منتج آخر', 'track_inventory' => true]);
        $this->setOnHand($this->product, $this->warehouse, 15);
        $this->setOnHand($productB, $this->warehouse, 3);

        $snapshotA = $this->ats->forWarehouse($this->product->id, $this->warehouse->id);
        $snapshotB = $this->ats->forWarehouse($productB->id, $this->warehouse->id);

        $this->assertSame(15, $snapshotA->onHand);
        $this->assertSame(3, $snapshotB->onHand);
    }

    /** @test */
    public function active_reserved_is_exactly_zero_until_com_1b_supplies_reservation_data(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 100);

        $snapshot = $this->ats->forWarehouse($this->product->id, $this->warehouse->id);

        $this->assertSame(0, $snapshot->activeReserved);
        $this->assertSame($snapshot->onHand, $snapshot->availableToSell, 'بلا حجز، ATS = On Hand تماماً.');
    }

    /** @test */
    public function an_ats_lookup_creates_no_stock_movement_or_financial_record(): void
    {
        $this->setOnHand($this->product, $this->warehouse, 10);

        $this->ats->forWarehouse($this->product->id, $this->warehouse->id);
        $this->ats->forWarehouse($this->product->id, $this->warehouse->id);

        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(
            10,
            (int) ProductWarehouseStock::where('product_id', $this->product->id)
                ->where('warehouse_id', $this->warehouse->id)->value('quantity'),
            'الاستدعاء المتكرر لا يغيّر الرصيد.'
        );
    }

    /** @test */
    public function ats_reflects_the_already_converted_base_quantity_not_a_second_uom_conversion(): void
    {
        $template = UnitTemplate::create(['name' => 'قالب كراتين ATS', 'base_unit' => 'piece']);
        $template->units()->create(['name' => 'carton', 'factor' => 24]);

        $boxedProduct = Product::create([
            'name' => 'بضاعة كراتين ATS', 'unit' => 'piece', 'unit_template_id' => $template->id,
            'track_inventory' => true,
        ]);

        app(ChartOfAccountsSeeder::class)->seed(app(TenantContext::class)->id());

        $permits = app(StockPermitService::class);
        $permits->post($permits->create(
            ['type' => 'receipt', 'warehouse_id' => $this->warehouse->id, 'reason' => 'اختبار ATS UOM'],
            [['product_id' => $boxedProduct->id, 'quantity' => 2, 'unit' => 'carton', 'unit_cost' => 240000]]
        ));

        $snapshot = $this->ats->forWarehouse($boxedProduct->id, $this->warehouse->id);

        // كرتونان × ٢٤ = ٤٨ قطعة أساس بالفعل في دفتر المخزون — ATS يقرأها كما
        // هي، لا يحوّلها مرة ثانية (وإلا لظهرت ١١٥٢ أو أي معامل مضاعَف خطأً).
        $this->assertSame(48, $snapshot->onHand);
        $this->assertSame(48, $snapshot->availableToSell);
    }

    /** @test */
    public function an_unknown_product_is_rejected_rather_than_silently_reported_as_zero(): void
    {
        $this->expectException(RuntimeException::class);
        $this->ats->forWarehouse((string) \Illuminate\Support\Str::uuid(), $this->warehouse->id);
    }

    /** @test */
    public function an_unknown_warehouse_is_rejected_rather_than_silently_reported_as_zero(): void
    {
        $this->expectException(RuntimeException::class);
        $this->ats->forWarehouse($this->product->id, (string) \Illuminate\Support\Str::uuid());
    }
}
