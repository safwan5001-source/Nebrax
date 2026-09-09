<?php

namespace Tests\Feature;

use App\Models\FulfillmentPolicy;
use App\Models\Invoice;
use App\Models\InventoryReservation;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\SalesChannel;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\FulfillmentPolicyNotConfiguredException;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\Commerce\InventoryReservationService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-2B — Fixed Fulfillment Policy (ADR-03)
 * ═══════════════════════════════════════════════════════════════
 *  عقد V1: قناة → صفر أو مخزن تنفيذ واحد صريح ثابت. لا قائمة، لا أولوية،
 *  لا تقسيم تلقائي. الحلّ صريح دائماً — بلا سياسة أو قناة معطّلة أو مخزن
 *  معطّل = فشلٌ واضح، لا مخزنٌ افتراضي مخمَّن.
 *
 *  تشغيل: php artisan test --filter=FulfillmentPolicyServiceTest
 */
class FulfillmentPolicyServiceTest extends TestCase
{
    use RefreshDatabase;

    private FulfillmentPolicyService $policies;
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

        $this->channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'متجرنا', 'type' => SalesChannel::TYPE_MOBILE]);
        $this->warehouse = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'FP-W1', 'is_default' => true]);
        $this->policies = app(FulfillmentPolicyService::class);
    }

    // ═══════════════════════════════════════════════════════════
    //  Model / configuration
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_policy_can_be_created_within_a_tenant(): void
    {
        $policy = $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $this->assertSame($this->channel->id, $policy->sales_channel_id);
        $this->assertSame($this->warehouse->id, $policy->warehouse_id);
    }

    /** @test */
    public function a_policy_links_the_channel_to_exactly_one_warehouse(): void
    {
        $warehouseB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'FP-W2']);

        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $updated = $this->policies->setFixedWarehouse($this->channel->id, $warehouseB->id);

        $this->assertSame(1, FulfillmentPolicy::count(), 'سياسة واحدة فقط لكل قناة — استبدال لا إضافة.');
        $this->assertSame($warehouseB->id, $updated->warehouse_id);
    }

    /** @test */
    public function a_policy_does_not_require_a_branch(): void
    {
        $this->assertNotContains('branch_id', (new FulfillmentPolicy())->getFillable());
    }

    /** @test */
    public function a_policy_does_not_require_a_pickup_location(): void
    {
        $this->assertNotContains('pickup_location_id', (new FulfillmentPolicy())->getFillable());
        $this->assertFalse(class_exists('App\\Models\\PickupLocation'), 'PickupLocation خارج نطاق COM-2B.');
    }

    /** @test */
    public function the_one_policy_per_channel_invariant_is_enforced_at_the_database_level(): void
    {
        FulfillmentPolicy::create([
            'sales_channel_id' => $this->channel->id, 'warehouse_id' => $this->warehouse->id,
        ]);

        $this->expectException(QueryException::class);
        FulfillmentPolicy::create([
            'sales_channel_id' => $this->channel->id, 'warehouse_id' => $this->warehouse->id,
        ]);
    }

    // ═══════════════════════════════════════════════════════════
    //  Resolver
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_active_configured_channel_resolves_the_exact_policy_warehouse(): void
    {
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $resolved = $this->policies->resolveWarehouseFor($this->channel->id);

        $this->assertSame($this->warehouse->id, $resolved->id);
    }

    /** @test */
    public function no_policy_fails_explicitly(): void
    {
        $this->expectException(FulfillmentPolicyNotConfiguredException::class);
        $this->policies->resolveWarehouseFor($this->channel->id);
    }

    /** @test */
    public function a_disabled_channel_fails_explicitly_even_with_a_configured_policy(): void
    {
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $this->channel->update(['is_active' => false]);

        $this->expectException(FulfillmentPolicyNotConfiguredException::class);
        $this->policies->resolveWarehouseFor($this->channel->id);
    }

    /** @test */
    public function an_inactive_policy_warehouse_fails_explicitly(): void
    {
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $this->warehouse->update(['is_active' => false]);

        $this->expectException(FulfillmentPolicyNotConfiguredException::class);
        $this->policies->resolveWarehouseFor($this->channel->id);
    }

    /** @test */
    public function the_resolver_never_falls_back_to_the_default_or_first_warehouse(): void
    {
        // مخزنٌ افتراضي حقيقي غير مرتبط بأي سياسة — يجب ألا يُختار أبداً.
        $defaultWarehouse = $this->warehouse; // is_default = true من setUp
        $policyWarehouse = Warehouse::create(['name' => 'مخزن السياسة', 'code' => 'FP-W3', 'is_default' => false]);

        $this->policies->setFixedWarehouse($this->channel->id, $policyWarehouse->id);

        $resolved = $this->policies->resolveWarehouseFor($this->channel->id);

        $this->assertSame($policyWarehouse->id, $resolved->id);
        $this->assertNotSame($defaultWarehouse->id, $resolved->id);
    }

    /** @test */
    public function the_resolver_returns_exactly_one_warehouse_instance(): void
    {
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $resolved = $this->policies->resolveWarehouseFor($this->channel->id);

        $this->assertInstanceOf(Warehouse::class, $resolved);
    }

    // ═══════════════════════════════════════════════════════════
    //  Tenant isolation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function setting_a_policy_with_a_cross_tenant_channel_is_rejected(): void
    {
        $foreignChannelId = $this->channel->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى', 'slug' => 'other-fp-tenant-1']);
        app(TenantContext::class)->set($tenantB->id);
        $warehouseUnderB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'FP-B-W1']);

        $this->expectException(RuntimeException::class);
        $this->policies->setFixedWarehouse($foreignChannelId, $warehouseUnderB->id);
    }

    /** @test */
    public function setting_a_policy_with_a_cross_tenant_warehouse_is_rejected(): void
    {
        $foreignWarehouseId = $this->warehouse->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٢', 'slug' => 'other-fp-tenant-2']);
        app(TenantContext::class)->set($tenantB->id);
        $channelUnderB = SalesChannel::create(['slug' => 'mobile', 'name' => 'متجرنا ب', 'type' => SalesChannel::TYPE_MOBILE]);

        $this->expectException(RuntimeException::class);
        $this->policies->setFixedWarehouse($channelUnderB->id, $foreignWarehouseId);
    }

    /** @test */
    public function a_policy_is_hidden_from_another_tenant(): void
    {
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٣', 'slug' => 'other-fp-tenant-3']);
        app(TenantContext::class)->set($tenantB->id);

        $this->assertSame(0, FulfillmentPolicy::count());
    }

    /** @test */
    public function resolving_a_cross_tenant_channel_is_rejected(): void
    {
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $foreignChannelId = $this->channel->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٤', 'slug' => 'other-fp-tenant-4']);
        app(TenantContext::class)->set($tenantB->id);

        $this->expectException(RuntimeException::class);
        $this->policies->resolveWarehouseFor($foreignChannelId);
    }

    /** @test */
    public function a_same_tenant_valid_channel_and_warehouse_succeeds(): void
    {
        $policy = $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $resolved = $this->policies->resolveWarehouseFor($this->channel->id);

        $this->assertNotNull($policy->id);
        $this->assertSame($this->warehouse->id, $resolved->id);
    }

    // ═══════════════════════════════════════════════════════════
    //  Inventory boundaries
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function resolving_never_changes_on_hand(): void
    {
        $product = Product::create(['name' => 'منتج FP', 'track_inventory' => true]);
        ProductWarehouseStock::create([
            'product_id' => $product->id, 'warehouse_id' => $this->warehouse->id, 'quantity' => 10,
        ]);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $this->policies->resolveWarehouseFor($this->channel->id);

        $this->assertSame(
            10,
            (int) ProductWarehouseStock::where('product_id', $product->id)
                ->where('warehouse_id', $this->warehouse->id)->value('quantity')
        );
    }

    /** @test */
    public function resolving_creates_no_inventory_reservation(): void
    {
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $this->policies->resolveWarehouseFor($this->channel->id);

        $this->assertSame(0, InventoryReservation::count());
    }

    /** @test */
    public function resolving_creates_no_stock_movement(): void
    {
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $this->policies->resolveWarehouseFor($this->channel->id);

        $this->assertSame(0, StockMovement::count());
    }

    /** @test */
    public function resolving_never_changes_available_to_sell(): void
    {
        $product = Product::create(['name' => 'منتج FP ATS', 'track_inventory' => true]);
        ProductWarehouseStock::create([
            'product_id' => $product->id, 'warehouse_id' => $this->warehouse->id, 'quantity' => 10,
        ]);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $before = app(AvailableToSellService::class)->forWarehouse($product->id, $this->warehouse->id);
        $this->policies->resolveWarehouseFor($this->channel->id);
        $after = app(AvailableToSellService::class)->forWarehouse($product->id, $this->warehouse->id);

        $this->assertSame($before->onHand, $after->onHand);
        $this->assertSame($before->availableToSell, $after->availableToSell);
    }

    // ═══════════════════════════════════════════════════════════
    //  Accounting boundaries
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function resolving_creates_no_journal_entry(): void
    {
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $this->policies->resolveWarehouseFor($this->channel->id);

        $this->assertSame(0, JournalEntry::count());
    }

    /** @test */
    public function resolving_creates_no_invoice(): void
    {
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $this->policies->resolveWarehouseFor($this->channel->id);

        $this->assertSame(0, Invoice::count());
    }

    /** @test */
    public function resolving_creates_no_payment(): void
    {
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $this->policies->resolveWarehouseFor($this->channel->id);

        $this->assertSame(0, Payment::count());
    }

    /** @test */
    public function resolving_has_no_zatca_effect(): void
    {
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        $this->policies->resolveWarehouseFor($this->channel->id);

        // لا Invoice على الإطلاق ⇐ لا يوجد سطح ZATCA (QR/UUID/ICV) يمكن أن يتأثر.
        $this->assertSame(0, Invoice::count());
    }

    // ═══════════════════════════════════════════════════════════
    //  Domain interoperability with COM-1A/1B (no new orchestration)
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function the_resolved_warehouse_composes_directly_with_reservation_and_ats(): void
    {
        $product = Product::create(['name' => 'منتج تركيب', 'track_inventory' => true]);
        ProductWarehouseStock::create([
            'product_id' => $product->id, 'warehouse_id' => $this->warehouse->id, 'quantity' => 10,
        ]);
        $this->policies->setFixedWarehouse($this->channel->id, $this->warehouse->id);

        $resolvedWarehouse = $this->policies->resolveWarehouseFor($this->channel->id);

        $reservation = app(InventoryReservationService::class)->acquire(
            $product->id, $resolvedWarehouse->id, 4, 'fp-interop-key',
        );

        $this->assertTrue($reservation->isActive());
        $ats = app(AvailableToSellService::class)->forWarehouse($product->id, $resolvedWarehouse->id);
        $this->assertSame(6, $ats->availableToSell);
    }
}
