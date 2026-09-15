<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\ProductWarehouseStock;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PurchaseService;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-REPORT-1 — تقارير ومحلّلات متعددة الخيارات
 * ═══════════════════════════════════════════════════════════════
 *  يغطّي: هويّة `product_id` + `product_variant_id` في تقارير المبيعات/
 *  المشتريات/لوحة التحكم (متغيّرٌ شقيقٌ سطرٌ مستقل)، الحقيقة التاريخية
 *  (لقطة السطر لا الاسم الحي)، تقرير المخزون (توسيعٌ لصفٍّ لكل متغيّر بدل
 *  صفٍّ أبٍ مضلِّل)، أرصدة المخازن وحركاتها الموسومة بالمتغيّر، فلاتر
 *  المتغيّر (إضافيّة، عزل مستأجر/منتج)، وعدم تسرّب الفرع/المخزن.
 *
 *  البيانات تُزرَع عبر طبقة الخدمة مباشرة (`InvoiceService`/`PurchaseService`)
 *  — نفس نمط `VariantDocumentLineTest` (VAR-DOC-1) حرفياً، لأن مسار HTTP
 *  لإنشاء فاتورة/مشترى بمتغيّرٍ لا يقبل `items.*.product_variant_id` بعد
 *  (فجوةٌ سابقة على هذه المهمة تركتها VAR-DOC-1 — موثَّقةٌ في التقرير، لا
 *  تُصلَح هنا لأنها خارج نطاق التقارير). قراءة التقارير نفسها تمرّ عبر
 *  HTTP الحقيقي دوماً.
 */
class VariantReportingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $tenantId;
    private string $customerId;
    private string $supplierId;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant();
        $this->token = $auth['token'];
        $this->tenantId = $auth['tenant_id'];

        $this->customerId = $this->withToken($this->token)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $this->supplierId = $this->withToken($this->token)->postJson('/api/partners', [
            'name' => 'مورد', 'type' => 'supplier',
        ])->assertCreated()['data']['id'];
    }

    /** @return array{0: Product, 1: ProductVariant, 2: ProductVariant} */
    private function variantManagedProduct(string $sku = 'SHIRT-1'): array
    {
        app(TenantContext::class)->set($this->tenantId);
        $product = Product::create([
            'name' => 'قميص', 'sku' => $sku, 'sale_price' => 20000, 'track_inventory' => true,
        ]);

        $color = $product->options()->create(['tenant_id' => $this->tenantId, 'name' => 'اللون', 'name_key' => 'اللون', 'sort_order' => 0]);
        $black = $color->values()->create(['tenant_id' => $this->tenantId, 'value' => 'أسود', 'value_key' => 'أسود', 'sort_order' => 0]);
        $white = $color->values()->create(['tenant_id' => $this->tenantId, 'value' => 'أبيض', 'value_key' => 'أبيض', 'sort_order' => 1]);

        $size = $product->options()->create(['tenant_id' => $this->tenantId, 'name' => 'المقاس', 'name_key' => 'المقاس', 'sort_order' => 1]);
        $large = $size->values()->create(['tenant_id' => $this->tenantId, 'value' => 'كبير', 'value_key' => 'كبير', 'sort_order' => 0]);
        $small = $size->values()->create(['tenant_id' => $this->tenantId, 'value' => 'صغير', 'value_key' => 'صغير', 'sort_order' => 1]);

        $variants = app(ProductVariantService::class);
        $variants->enableVariantManagement($product, null);
        $product = $product->fresh();

        $black1 = $variants->createSingleVariant($product, [$black->id, $large->id], null)['variant'];
        $white1 = $variants->createSingleVariant($product, [$white->id, $small->id], null)['variant'];

        app(TenantContext::class)->forget();

        return [$product->fresh(), $black1, $white1];
    }

    /** فاتورةٌ مرحَّلة بسطرٍ واحد — منتجٌ بسيطٌ أو متغيّرٌ فعلي. */
    /** يشتري كميةً كافيةً أولاً (منتجٌ متتبَّعٌ مخزونياً يرفض بيعاً بلا رصيد) ثم يبيع. */
    private function postedInvoiceLine(string $productId, ?string $variantId, int $quantity, int $unitPrice): void
    {
        app(TenantContext::class)->set($this->tenantId);
        if (Product::findOrFail($productId)->track_inventory) {
            app(TenantContext::class)->forget();
            $this->postedPurchaseLine($productId, $variantId, $quantity, intdiv($unitPrice, 2));
            app(TenantContext::class)->set($this->tenantId);
        }

        $invoices = app(InvoiceService::class);
        $invoice = $invoices->create(
            ['partner_id' => $this->customerId, 'payment_type' => 'cash'],
            [['product_id' => $productId, 'product_variant_id' => $variantId, 'quantity' => $quantity, 'unit_price' => $unitPrice, 'tax_rate' => 0]]
        );
        $invoices->post($invoice);
        app(TenantContext::class)->forget();
    }

    /** مشترى مرحَّل بسطرٍ واحد — منتجٌ بسيطٌ أو متغيّرٌ فعلي. */
    private function postedPurchaseLine(string $productId, ?string $variantId, int $quantity, int $unitPrice): void
    {
        app(TenantContext::class)->set($this->tenantId);
        $purchases = app(PurchaseService::class);
        $purchase = $purchases->create(
            ['partner_id' => $this->supplierId, 'payment_type' => 'cash'],
            [['product_id' => $productId, 'product_variant_id' => $variantId, 'quantity' => $quantity, 'unit_price' => $unitPrice, 'tax_rate' => 0]]
        );
        $purchases->post($purchase);
        app(TenantContext::class)->forget();
    }

    /** @return array<int, array<string, mixed>> صفوف التقرير (`data`) — الأموال بصيغة ريال نصّية (`Money::toRiyal()`). */
    private function salesReport(string $query): array
    {
        return $this->withToken($this->token)->getJson("/api/reports/sales?{$query}")->assertOk()->json('data');
    }

    private function purchaseReport(string $query): array
    {
        return $this->withToken($this->token)->getJson("/api/reports/purchases?{$query}")->assertOk()->json('data');
    }

    private function inventoryReport(string $query): array
    {
        return $this->withToken($this->token)->getJson("/api/reports/inventory?{$query}")->assertOk()->json('data');
    }

    /** هللاتٌ → نفس صيغة عرض Money::toRiyal() المستعملة في طبقة العرض. */
    private function riyal(int $minor): string
    {
        return sprintf('%d.%02d', intdiv($minor, 100), $minor % 100);
    }

    // ───────────────────────── ١) توافقٌ رجعي ─────────────────────────

    /** @test */
    public function simple_product_sales_report_is_unaffected(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        $product = Product::create(['name' => 'إسمنت', 'sku' => 'CEM-1', 'sale_price' => 20000, 'track_inventory' => false]);
        app(TenantContext::class)->forget();

        $this->postedInvoiceLine($product->id, null, 2, 20000);

        $rows = $this->salesReport('view=product');
        $this->assertCount(1, $rows);
        $this->assertSame($product->id, $rows[0]['key']);
        $this->assertNull($rows[0]['product_variant_id']);
        $this->assertSame('إسمنت', $rows[0]['label']);
        $this->assertSame(2, $rows[0]['quantity']);
    }

    // ───────────────────────── ٢) المبيعات ─────────────────────────

    /** @test */
    public function sibling_variants_remain_distinct_rows_in_the_sales_report(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        app(TenantContext::class)->forget();
        [$product, $black, $white] = $this->variantManagedProduct();

        $this->postedInvoiceLine($product->id, $black->id, 3, 20000);
        $this->postedInvoiceLine($product->id, $white->id, 5, 22000);

        $rows = $this->salesReport('view=product');
        $this->assertCount(2, $rows);

        $byVariant = collect($rows)->keyBy('product_variant_id');
        $this->assertSame(3, $byVariant[$black->id]['quantity']);
        $this->assertSame($this->riyal(60000), $byVariant[$black->id]['amount']);
        $this->assertSame('قميص — أسود / كبير', $byVariant[$black->id]['label']);
        $this->assertSame(5, $byVariant[$white->id]['quantity']);
        $this->assertSame($this->riyal(110000), $byVariant[$white->id]['amount']);
        $this->assertSame('قميص — أبيض / صغير', $byVariant[$white->id]['label']);
        $this->assertNotSame($byVariant[$black->id]['key'], $byVariant[$white->id]['key']);
    }

    /** @test */
    public function the_product_filter_includes_all_its_variants(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        app(TenantContext::class)->forget();
        [$product, $black, $white] = $this->variantManagedProduct();
        $this->postedInvoiceLine($product->id, $black->id, 1, 20000);
        $this->postedInvoiceLine($product->id, $white->id, 1, 22000);

        $rows = $this->salesReport('view=product&product_id='.$product->id);
        $this->assertCount(2, $rows);
    }

    /** @test */
    public function the_variant_filter_returns_only_that_concrete_variant(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        app(TenantContext::class)->forget();
        [$product, $black, $white] = $this->variantManagedProduct();
        $this->postedInvoiceLine($product->id, $black->id, 1, 20000);
        $this->postedInvoiceLine($product->id, $white->id, 1, 22000);

        $rows = $this->salesReport('view=product&product_variant_id='.$black->id);
        $this->assertCount(1, $rows);
        $this->assertSame($black->id, $rows[0]['product_variant_id']);
    }

    /** @test */
    public function a_cross_product_variant_filter_returns_empty_safely(): void
    {
        [$productA, $blackOfA] = $this->variantManagedProduct('SHIRT-A');
        [, $variantOfB] = $this->variantManagedProduct('SHIRT-B');
        $this->postedInvoiceLine($productA->id, $blackOfA->id, 1, 20000);

        $rows = $this->salesReport('view=product&product_id='.$productA->id.'&product_variant_id='.$variantOfB->id);
        $this->assertCount(0, $rows);
    }

    /** @test */
    public function a_cross_tenant_variant_filter_is_denied_and_leaks_nothing(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        [$product, $black] = $this->variantManagedProduct();
        $this->postedInvoiceLine($product->id, $black->id, 1, 20000);
        app(TenantContext::class)->forget();

        $otherAuth = $this->registerTenant('other-variant-tenant', 'other-variant@nibras.test');
        app(TenantContext::class)->set($otherAuth['tenant_id']);
        app(TenantContext::class)->forget();

        $rows = $this->withToken($otherAuth['token'])
            ->getJson('/api/reports/sales?view=product&product_variant_id='.$black->id)
            ->assertOk()->json('data');
        $this->assertCount(0, $rows);
    }

    /** @test */
    public function variant_rename_does_not_rewrite_the_historical_sales_label(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        app(TenantContext::class)->forget();
        [$product, $black] = $this->variantManagedProduct();
        $this->postedInvoiceLine($product->id, $black->id, 1, 20000);

        app(TenantContext::class)->set($this->tenantId);
        $product->update(['name' => 'قميص جديد الاسم']);
        app(TenantContext::class)->forget();

        $rows = $this->salesReport('view=product');
        $this->assertSame('قميص — أسود / كبير', $rows[0]['label']);
    }

    /** @test */
    public function deactivating_a_variant_does_not_break_the_historical_sales_report(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        app(TenantContext::class)->forget();
        [$product, $black] = $this->variantManagedProduct();
        $this->postedInvoiceLine($product->id, $black->id, 2, 20000);

        app(TenantContext::class)->set($this->tenantId);
        $black->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $rows = $this->salesReport('view=product');
        $this->assertCount(1, $rows);
        $this->assertSame(2, $rows[0]['quantity']);
        $this->assertSame('قميص — أسود / كبير', $rows[0]['label']);
    }

    // ───────────────────────── ٣) المشتريات ─────────────────────────

    /** @test */
    public function sibling_variants_remain_distinct_rows_in_the_purchase_report(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        app(TenantContext::class)->forget();
        [$product, $black, $white] = $this->variantManagedProduct();

        $this->postedPurchaseLine($product->id, $black->id, 4, 8000);
        $this->postedPurchaseLine($product->id, $white->id, 6, 9000);

        $rows = $this->purchaseReport('view=product');
        $this->assertCount(2, $rows);
        $byVariant = collect($rows)->keyBy('product_variant_id');
        $this->assertSame(4, $byVariant[$black->id]['quantity']);
        $this->assertSame(6, $byVariant[$white->id]['quantity']);
        $this->assertNotSame('0.00', $byVariant[$black->id]['amount']);
    }

    // ───────────────────────── ٤) المخزون ─────────────────────────

    /** @test */
    public function inventory_value_report_shows_each_variant_with_its_own_cost_not_a_misleading_parent_row(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        app(TenantContext::class)->forget();
        [$product, $black, $white] = $this->variantManagedProduct();

        $this->postedPurchaseLine($product->id, $black->id, 10, 4000);
        $this->postedPurchaseLine($product->id, $white->id, 20, 5000);

        $rows = $this->inventoryReport('view=value');
        $this->assertCount(2, $rows);

        $byVariant = collect($rows)->keyBy('product_variant_id');
        $this->assertSame(10, $byVariant[$black->id]['quantity']);
        $this->assertSame($this->riyal(4000), $byVariant[$black->id]['avg_cost']);
        $this->assertSame($this->riyal(40000), $byVariant[$black->id]['stock_value']);
        $this->assertSame(20, $byVariant[$white->id]['quantity']);
        $this->assertSame($this->riyal(5000), $byVariant[$white->id]['avg_cost']);
        $this->assertSame($this->riyal(100000), $byVariant[$white->id]['stock_value']);

        // لا صفٌّ أبٌ إضافي (منتجٌ متعدد الخيارات) — التوسيع الكامل بديلٌ لا إضافة.
        $this->assertNull(collect($rows)->firstWhere('product_variant_id', null));
    }

    /** @test */
    public function inventory_value_variant_filter_returns_only_the_requested_variant(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        app(TenantContext::class)->forget();
        [$product, $black, $white] = $this->variantManagedProduct();
        $this->postedPurchaseLine($product->id, $black->id, 3, 1000);
        $this->postedPurchaseLine($product->id, $white->id, 7, 2000);

        $rows = $this->inventoryReport('view=value&product_variant_id='.$white->id);
        $this->assertCount(1, $rows);
        $this->assertSame($white->id, $rows[0]['product_variant_id']);
        $this->assertSame(7, $rows[0]['quantity']);
    }

    /** @test */
    public function simple_product_inventory_value_row_is_unchanged(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        $simple = Product::create(['name' => 'أسمنت', 'sku' => 'CEM-INV-1', 'sale_price' => 3000, 'track_inventory' => true]);
        app(TenantContext::class)->forget();
        $this->postedPurchaseLine($simple->id, null, 15, 1200);

        $rows = $this->inventoryReport('view=value');
        $this->assertCount(1, $rows);
        $this->assertNull($rows[0]['product_variant_id']);
        $this->assertSame(15, $rows[0]['quantity']);
        $this->assertSame($this->riyal(1200), $rows[0]['avg_cost']);
    }

    /** @test */
    public function warehouse_stock_distinguishes_sibling_variants(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        $warehouse = Warehouse::create(['name' => 'مخزن التقرير', 'code' => 'RPT-W1', 'is_default' => true]);
        app(TenantContext::class)->forget();
        [$product, $black, $white] = $this->variantManagedProduct();
        $this->postedPurchaseLine($product->id, $black->id, 8, 1000);
        $this->postedPurchaseLine($product->id, $white->id, 12, 1500);

        app(TenantContext::class)->set($this->tenantId);
        $blackStock = ProductWarehouseStock::where('product_id', $product->id)->where('product_variant_id', $black->id)->first();
        $whiteStock = ProductWarehouseStock::where('product_id', $product->id)->where('product_variant_id', $white->id)->first();
        $this->assertNotNull($blackStock);
        $this->assertNotNull($whiteStock);
        app(TenantContext::class)->forget();

        $rows = $this->inventoryReport('view=warehouses');
        $byVariant = collect($rows)->keyBy('product_variant_id');
        $this->assertSame(8, $byVariant[$black->id]['quantity']);
        $this->assertSame(12, $byVariant[$white->id]['quantity']);
        $this->assertSame('قميص — أسود / كبير', $byVariant[$black->id]['label']);
    }

    /** @test */
    public function stock_movements_report_distinguishes_sibling_variants(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        app(TenantContext::class)->forget();
        [$product, $black, $white] = $this->variantManagedProduct();
        $this->postedPurchaseLine($product->id, $black->id, 5, 1000);
        $this->postedPurchaseLine($product->id, $white->id, 9, 2000);

        $rows = $this->inventoryReport('view=movements');
        $this->assertCount(2, $rows);
        $byVariant = collect($rows)->keyBy('product_variant_id');
        $this->assertSame(5, $byVariant[$black->id]['quantity']);
        $this->assertSame(9, $byVariant[$white->id]['quantity']);
    }

    // ───────────────────────── ٥) لوحة التحكم ─────────────────────────

    /** @test */
    public function dashboard_product_breakdown_keeps_sibling_variants_distinct(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        app(TenantContext::class)->forget();
        [$product, $black, $white] = $this->variantManagedProduct();
        $this->postedInvoiceLine($product->id, $black->id, 1, 20000);
        $this->postedInvoiceLine($product->id, $white->id, 1, 22000);

        $rows = $this->withToken($this->token)
            ->getJson('/api/dashboard/sales-breakdown?by=product')
            ->assertOk()->json('data');

        $this->assertCount(2, $rows);
        $byVariant = collect($rows)->keyBy('product_variant_id');
        $this->assertSame($this->riyal(20000), $byVariant[$black->id]['amount']);
        $this->assertSame($this->riyal(22000), $byVariant[$white->id]['amount']);
    }
}
