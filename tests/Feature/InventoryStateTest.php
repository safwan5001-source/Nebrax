<?php

namespace Tests\Feature;

use App\Models\InventoryState;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\ProductWarehouseStock;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * VAR-INV-1 — هويّة المخزون والتقييم الموحّدة (InventoryState).
 *
 * يغطّي: السلطة الوحيدة للكمية/المتوسط، الإنشاء الكسول ودلالته لحارس
 * الأثر المخزني، عزل الهويّة (منتج/متغيّر/مستأجر)، وحماية دورة حياة المتغيّر.
 * التزامن الحقيقي على PostgreSQL في InventoryStatePostgresConcurrencyTest.
 *
 * تشغيل: php artisan test --filter=InventoryStateTest
 */
class InventoryStateTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;

    protected InventoryService $inventory;

    protected ProductVariantService $variants;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->inventory = app(InventoryService::class);
        $this->variants = app(ProductVariantService::class);
    }

    private function trackedProduct(array $overrides = []): Product
    {
        return Product::create(array_merge([
            'name' => 'بضاعة', 'sale_price' => 10000, 'track_inventory' => true,
        ], $overrides));
    }

    private function variantManagedProduct(): Product
    {
        $tenantId = app(TenantContext::class)->id();
        $product = $this->trackedProduct();
        $option = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'اللون', 'name_key' => 'اللون']);
        $value = $option->values()->create(['tenant_id' => $tenantId, 'value' => 'أحمر', 'value_key' => 'أحمر']);
        $this->variants->enableVariantManagement($product, null);
        $this->variants->createSingleVariant($product->fresh(), [$value->id], null);

        return $product->fresh();
    }

    /** @test */
    public function receiving_stock_creates_a_lazy_inventory_state_row_not_an_eager_one(): void
    {
        $product = $this->trackedProduct();
        $this->assertSame(0, InventoryState::count());

        $this->inventory->receiveStock($product, 10, 4000);

        $this->assertSame(1, InventoryState::count());
        $state = InventoryState::first();
        $this->assertSame($product->id, $state->product_id);
        $this->assertNull($state->product_variant_id);
        $this->assertSame(10, $state->quantity_on_hand);
        $this->assertSame(4000, $state->avg_cost);
    }

    /** @test */
    public function product_quantity_and_avg_cost_accessors_read_through_the_inventory_state(): void
    {
        $product = $this->trackedProduct();
        $this->inventory->receiveStock($product, 10, 4000);
        $this->inventory->receiveStock($product, 10, 6000);

        $product->refresh();
        $this->assertSame(20, $product->quantity_on_hand);
        $this->assertSame(5000, $product->avg_cost); // (10*4000+10*6000)/20
    }

    /** @test */
    public function direct_column_assignment_never_persists_to_the_frozen_physical_column(): void
    {
        $product = $this->trackedProduct();
        $this->inventory->receiveStock($product, 5, 1000);

        $raw = \DB::table('products')->where('id', $product->id)->first();
        $this->assertSame(0, (int) $raw->quantity_on_hand, 'العمود الفيزيائي يبقى مجمَّداً بلا كتابة.');
        $this->assertSame(0, (int) $raw->avg_cost);
    }

    /** @test */
    public function a_simple_product_with_no_movement_yet_has_no_inventory_state_row(): void
    {
        $product = $this->trackedProduct();

        $this->assertSame(0, $product->quantity_on_hand);
        $this->assertSame(0, InventoryState::count());
    }

    /** @test */
    public function issuing_stock_never_recomputes_the_average(): void
    {
        $product = $this->trackedProduct();
        $this->inventory->receiveStock($product, 10, 4000);
        $this->inventory->applyIssue($product, 4, 4000);

        $product->refresh();
        $this->assertSame(6, $product->quantity_on_hand);
        $this->assertSame(4000, $product->avg_cost);
    }

    /** @test */
    public function a_variant_managed_product_cannot_resolve_a_parent_inventory_state(): void
    {
        $product = $this->variantManagedProduct();

        $this->expectException(RuntimeException::class);
        $this->inventory->receiveStock($product, 10, 4000);
    }

    /** @test */
    public function each_variant_carries_its_own_independent_inventory_state(): void
    {
        $product = $this->variantManagedProduct();
        $variant = $product->variants()->firstOrFail();
        $option = $product->options()->firstOrFail();
        $value2 = $option->values()->create(['tenant_id' => app(TenantContext::class)->id(), 'value' => 'أزرق', 'value_key' => 'أزرق']);
        $result2 = $this->variants->createSingleVariant($product->fresh(), [$value2->id], null);
        $variant2 = $result2['variant'];

        $this->inventory->receiveStock($product, 10, 4000, variant: $variant);
        $this->inventory->receiveStock($product, 5, 9000, variant: $variant2);

        $variant->refresh();
        $variant2->refresh();
        $this->assertSame(10, $variant->quantity_on_hand);
        $this->assertSame(4000, $variant->avg_cost);
        $this->assertSame(5, $variant2->quantity_on_hand);
        $this->assertSame(9000, $variant2->avg_cost);

        // الأب: كميته مجموعٌ مشتقّ، ومتوسطه صفرٌ صراحةً (لا اختراع مركّب).
        $product->refresh();
        $this->assertSame(15, $product->quantity_on_hand);
        $this->assertSame(0, $product->avg_cost);
    }

    /** @test */
    public function a_variant_from_a_different_product_is_rejected_fail_closed(): void
    {
        $productA = $this->variantManagedProduct();
        $productB = $this->variantManagedProduct();
        $variantOfB = $productB->variants()->firstOrFail();

        $this->expectException(RuntimeException::class);
        $this->inventory->receiveStock($productA, 5, 1000, variant: $variantOfB);
    }

    /** @test */
    public function deleting_a_variant_with_inventory_history_is_blocked_even_at_zero_quantity(): void
    {
        $product = $this->variantManagedProduct();
        $variant = $product->variants()->firstOrFail();

        $this->inventory->receiveStock($product, 10, 4000, variant: $variant);
        $this->inventory->applyIssue($product, 10, 4000, variant: $variant);

        $variant->refresh();
        $this->assertSame(0, $variant->quantity_on_hand);

        $this->expectException(RuntimeException::class);
        $this->variants->deleteVariant($variant, null);
    }

    /** @test */
    public function deleting_a_variant_with_no_inventory_history_still_works(): void
    {
        $product = $this->variantManagedProduct();
        $variant = $product->variants()->firstOrFail();

        $this->variants->deleteVariant($variant, null);

        $this->assertSame(0, $product->variants()->count());
    }

    /** @test */
    public function enabling_variant_management_is_rejected_once_a_real_receipt_happened(): void
    {
        $product = $this->trackedProduct();
        $this->inventory->receiveStock($product, 1, 100);
        $this->inventory->applyIssue($product, 1, 100); // يعود للصفر، لكن الأثر التاريخي باقٍ

        $option = $product->options()->create(['tenant_id' => $this->tenant->id, 'name' => 'اللون', 'name_key' => 'اللون']);
        $option->values()->create(['tenant_id' => $this->tenant->id, 'value' => 'أحمر', 'value_key' => 'أحمر']);

        $this->expectException(RuntimeException::class);
        $this->variants->enableVariantManagement($product->fresh(), null);
    }

    /** @test */
    public function warehouse_stock_tracks_simple_and_variant_identities_independently(): void
    {
        $warehouse = Warehouse::create(['tenant_id' => $this->tenant->id, 'name' => 'الرئيسي', 'code' => 'WH1', 'is_default' => true]);
        $product = $this->variantManagedProduct();
        $variant = $product->variants()->firstOrFail();

        $this->inventory->receiveStock($product, 7, 1000, ['warehouse_id' => $warehouse->id], variant: $variant);

        $rows = ProductWarehouseStock::where('warehouse_id', $warehouse->id)->get();
        $this->assertCount(1, $rows);
        $this->assertSame($variant->id, $rows->first()->product_variant_id);
        $this->assertSame(7, $rows->first()->quantity);
    }

    // ───────────────────────── عزل المستأجر ─────────────────────────

    /** @test */
    public function an_inventory_state_from_another_tenant_is_invisible_under_the_active_tenant(): void
    {
        $otherTenant = Tenant::create([
            'name' => 'مستأجر آخر', 'slug' => 'other', 'vat_number' => '300000000000099', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($otherTenant->id);
        app(ChartOfAccountsSeeder::class)->seed($otherTenant->id);
        $otherProduct = $this->trackedProduct();
        $this->inventory->receiveStock($otherProduct, 5, 1000);

        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(0, InventoryState::count(), 'هويّات المستأجر الآخر يجب ألّا تظهر عبر النطاق العام.');
    }

    /** @test */
    public function a_guessed_cross_tenant_variant_id_cannot_be_used_to_receive_stock_for_this_tenants_product(): void
    {
        $otherTenant = Tenant::create([
            'name' => 'مستأجر آخر', 'slug' => 'other2', 'vat_number' => '300000000000098', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($otherTenant->id);
        app(ChartOfAccountsSeeder::class)->seed($otherTenant->id);
        $foreignProduct = $this->variantManagedProduct();
        $foreignVariant = $foreignProduct->variants()->firstOrFail();

        app(TenantContext::class)->set($this->tenant->id);
        $localProduct = $this->trackedProduct();

        // النطاق العام يمنع حتى إيجاد المتغيّر أصلاً تحت المستأجر النشط — نحاكي
        // محاولة كسره بمعرّفٍ خامّ متوقَّع كما لو أفلت من الطبقة الأعلى.
        $rawVariant = ProductVariant::withoutGlobalScopes()->findOrFail($foreignVariant->id);

        $this->expectException(\Throwable::class);
        $this->inventory->receiveStock($localProduct, 5, 1000, variant: $rawVariant);
    }
}
