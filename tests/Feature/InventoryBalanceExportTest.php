<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Support\SpreadsheetReader;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تصدير أرصدة المخزون — خادميّ، بدلالة الشاشة نفسها، وقراءةٌ محضة
 * ═══════════════════════════════════════════════════════════════
 *  **الثوابت المحروسة:**
 *   1. «النتائج الحالية» = كل المطابق للفلاتر لا الصفحة المرئية.
 *   2. قيمة المخزون = الكمية × متوسط التكلفة، من مصدر الحقيقة نفسه.
 *   3. الرمز والباركود نصّاً في XLSX (أصفار بادئة، بلا صيغة علمية).
 *   4. لا كتابة: صفر حركة، صفر قيد، صفر تغيّر في الكمية أو المتوسط.
 *
 *  تشغيل: php artisan test --filter=InventoryBalanceExportTest
 */
class InventoryBalanceExportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /**
     * صنفٌ متتبَّع برصيد فعلي عبر `InventoryService` — لا كتابة مباشرة على
     * الكمية أو المتوسط، فالبيانات تُبنى كما تُبنى في الإنتاج.
     */
    private function stockedProduct(string $tenantId, array $overrides, int $qty, int $unitCost): Product
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create(array_merge([
            'name' => 'صنف', 'type' => 'good', 'sale_price' => 10000,
            'purchase_price' => $unitCost, 'track_inventory' => true,
        ], $overrides));

        if ($qty > 0) {
            app(InventoryService::class)->receiveStock($product, $qty, $unitCost, [
                'warehouse_id' => Warehouse::default()?->id,
            ]);
        }

        return $product->fresh();
    }

    /** @return array<int, array<int, string>> */
    private function readCsv(TestResponse $response): array
    {
        $path = tempnam(sys_get_temp_dir(), 'inv-export-csv-');
        file_put_contents($path, $response->streamedContent());
        $rows = SpreadsheetReader::read($path, 'csv', 60000, 200);
        @unlink($path);

        return $rows;
    }

    /** @return array<int, array<int, string>> */
    private function readXlsx(TestResponse $response): array
    {
        $path = tempnam(sys_get_temp_dir(), 'inv-export-xlsx-');
        file_put_contents($path, $response->getContent());
        $rows = SpreadsheetReader::read($path, 'xlsx', 60000, 200);
        @unlink($path);

        return $rows;
    }

    /** @param array<int, array<int, string>> $rows @return array<int, string> */
    private function column(array $rows, string $header): array
    {
        $index = array_search($header, $rows[0], true);
        $this->assertNotFalse($index, "العمود «{$header}» غير موجود في الملف المصدَّر.");

        return array_map(static fn (array $row): string => (string) ($row[$index] ?? ''), array_slice($rows, 1));
    }

    // ═══════════════════════════ الصيغ والنطاق ═══════════════════════════

    /** @test */
    public function it_exports_all_tracked_balances_as_csv(): void
    {
        $auth = $this->registerTenant();
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'SKU-1', 'name' => 'إسمنت'], 100, 1000);
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'SKU-2', 'name' => 'حديد'], 50, 3000);
        // خدمةٌ غير متتبَّعة لا تظهر في تقرير الأرصدة.
        app(TenantContext::class)->set($auth['tenant_id']);
        Product::create(['name' => 'خدمة', 'type' => 'service', 'sale_price' => 5000, 'track_inventory' => false]);

        $response = $this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=all&format=csv')
            ->assertOk();

        $this->assertStringContainsString('text/csv', $response->headers->get('Content-Type'));
        $rows = $this->readCsv($response);
        $this->assertCount(3, $rows, 'صف عناوين وصفّا بيانات — الخدمة غير المتتبَّعة مستبعَدة.');
        $this->assertSame(['SKU-1', 'SKU-2'], $this->column($rows, 'رمز الصنف'));
    }

    /** @test */
    public function it_exports_as_a_readable_xlsx_with_the_documented_columns(): void
    {
        $auth = $this->registerTenant();
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'SKU-1', 'name' => 'إسمنت', 'unit' => 'كيس'], 100, 1850);

        $response = $this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=all&format=xlsx')
            ->assertOk();

        $this->assertStringContainsString('spreadsheetml', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('.xlsx', $response->headers->get('Content-Disposition'));
        $rows = $this->readXlsx($response);

        $this->assertSame(
            ['رمز الصنف', 'الباركود', 'اسم الصنف', 'الوحدة', 'الكمية', 'متوسط التكلفة', 'قيمة المخزون'],
            $rows[0]
        );
        $this->assertSame('100', $this->column($rows, 'الكمية')[0]);
        $this->assertSame('18.50', $this->column($rows, 'متوسط التكلفة')[0]);
        // قيمة المخزون = 100 × 18.50 = 1850.00 (= الكمية × المتوسط بالهللات).
        $this->assertSame('1850.00', $this->column($rows, 'قيمة المخزون')[0]);
    }

    /** @test */
    public function english_headers_follow_the_locale_parameter(): void
    {
        $auth = $this->registerTenant();
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'SKU-1'], 10, 1000);

        $rows = $this->readCsv($this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=all&format=csv&locale=en')->assertOk());

        $this->assertSame(
            ['SKU', 'Barcode', 'Product name', 'Unit', 'Quantity', 'Average cost', 'Inventory value'],
            $rows[0]
        );
    }

    // ═══════════════════════════ دلالة الفلاتر ═══════════════════════════

    /** @test */
    public function the_filtered_scope_respects_the_search_term(): void
    {
        $auth = $this->registerTenant();
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'CEM-1', 'name' => 'إسمنت'], 100, 1000);
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'STL-1', 'name' => 'حديد'], 50, 3000);

        $rows = $this->readCsv($this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=filtered&format=csv&search=إسمنت')->assertOk());

        $this->assertSame(['CEM-1'], $this->column($rows, 'رمز الصنف'), 'البحث بالاسم يطابق الشاشة.');
    }

    /** @test */
    public function the_filtered_scope_respects_the_unit_and_quantity_filters(): void
    {
        $auth = $this->registerTenant();
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'A', 'unit' => 'كيس'], 100, 1000);
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'B', 'unit' => 'كيس'], 5, 1000);
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'C', 'unit' => 'طن'], 100, 1000);

        $rows = $this->readCsv($this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=filtered&format=csv&unit=كيس&qty_min=10')->assertOk());

        $this->assertSame(['A'], $this->column($rows, 'رمز الصنف'), 'الوحدة والحد الأدنى للكمية معاً.');
    }

    /** @test */
    public function the_filtered_scope_respects_the_money_range_in_riyal(): void
    {
        $auth = $this->registerTenant();
        // متوسط التكلفة يُدخل ريالاً في الفلتر ويُقارَن بالهللات في الخادم.
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'CHEAP'], 10, 500);   // 5.00 ريال
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'MID'], 10, 2000);    // 20.00 ريال
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'DEAR'], 10, 9000);   // 90.00 ريال

        $rows = $this->readCsv($this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=filtered&format=csv&avg_cost_min=10&avg_cost_max=50')->assertOk());

        $this->assertSame(['MID'], $this->column($rows, 'رمز الصنف'));
    }

    /** @test */
    public function the_filtered_scope_respects_the_stock_value_range(): void
    {
        $auth = $this->registerTenant();
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'SMALL'], 2, 1000);    // قيمة 20.00
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'BIG'], 100, 1000);    // قيمة 1000.00

        $rows = $this->readCsv($this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=filtered&format=csv&stock_value_min=100')->assertOk());

        $this->assertSame(['BIG'], $this->column($rows, 'رمز الصنف'));
    }

    /** @test */
    public function the_sort_order_is_respected(): void
    {
        $auth = $this->registerTenant();
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'A'], 10, 1000);
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'B'], 90, 1000);
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'C'], 50, 1000);

        $rows = $this->readCsv($this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=filtered&format=csv&sort=-quantity_on_hand')->assertOk());

        $this->assertSame(['B', 'C', 'A'], $this->column($rows, 'رمز الصنف'), 'الكمية تنازلياً.');
    }

    /** @test */
    public function the_all_scope_ignores_the_current_filters(): void
    {
        $auth = $this->registerTenant();
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'A', 'name' => 'إسمنت'], 100, 1000);
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'B', 'name' => 'حديد'], 50, 3000);

        // فلترٌ يطابق واحداً فقط، لكن النطاق «الكل» يتجاوزه.
        $rows = $this->readCsv($this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=all&format=csv&search=إسمنت')->assertOk());

        $this->assertSame(['A', 'B'], $this->column($rows, 'رمز الصنف'));
    }

    // ═══════════════════════════ الرصيد الصفري ═══════════════════════════

    /** @test */
    public function include_zero_true_keeps_zero_balances(): void
    {
        $auth = $this->registerTenant();
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'HAS-STOCK'], 100, 1000);
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'ZERO'], 0, 1000);   // بلا رصيد

        $rows = $this->readCsv($this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=all&format=csv&include_zero=1&sort=sku')->assertOk());

        $this->assertSame(['HAS-STOCK', 'ZERO'], $this->column($rows, 'رمز الصنف'));
    }

    /** @test */
    public function include_zero_false_drops_zero_balances(): void
    {
        $auth = $this->registerTenant();
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'HAS-STOCK'], 100, 1000);
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'ZERO'], 0, 1000);

        $rows = $this->readCsv($this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=all&format=csv&include_zero=0&sort=sku')->assertOk());

        $this->assertSame(['HAS-STOCK'], $this->column($rows, 'رمز الصنف'), 'الأصناف بلا رصيد مستبعَدة.');
    }

    /** @test */
    public function the_default_includes_zero_like_the_screen(): void
    {
        $auth = $this->registerTenant();
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'HAS-STOCK'], 100, 1000);
        $this->stockedProduct($auth['tenant_id'], ['sku' => 'ZERO'], 0, 1000);

        $rows = $this->readCsv($this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=all&format=csv&sort=sku')->assertOk());

        $this->assertSame(['HAS-STOCK', 'ZERO'], $this->column($rows, 'رمز الصنف'));
    }

    // ═══════════════════════════ التنسيق والعزل ═══════════════════════════

    /** @test */
    public function leading_zeros_in_sku_and_barcode_survive_the_xlsx(): void
    {
        $auth = $this->registerTenant();
        $this->stockedProduct($auth['tenant_id'], ['sku' => '00123', 'barcode' => '6280000000001'], 10, 1000);

        $rows = $this->readXlsx($this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=all&format=xlsx')->assertOk());

        $this->assertSame('00123', $this->column($rows, 'رمز الصنف')[0], 'الأصفار البادئة محفوظة.');
        $this->assertSame('6280000000001', $this->column($rows, 'الباركود')[0], 'الباركود بلا صيغة علمية.');
    }

    /** @test */
    public function it_never_leaks_another_tenants_balances(): void
    {
        $first = $this->registerTenant('acme', 'owner@acme.test');
        $this->stockedProduct($first['tenant_id'], ['sku' => 'ACME-1'], 10, 1000);

        $second = $this->registerTenant('other', 'owner@other.test');
        $this->stockedProduct($second['tenant_id'], ['sku' => 'OTHER-1'], 20, 2000);

        $rows = $this->readCsv($this->withToken($second['token'])
            ->get('/api/inventory/export?scope=all&format=csv')->assertOk());

        $this->assertSame(['OTHER-1'], $this->column($rows, 'رمز الصنف'), 'كلٌّ يرى كتالوجه وحده.');
    }

    /** @test */
    public function export_writes_no_stock_movement_no_inventory_change_no_journal(): void
    {
        $auth = $this->registerTenant();
        $product = $this->stockedProduct($auth['tenant_id'], ['sku' => 'SKU-1'], 100, 1000);

        app(TenantContext::class)->set($auth['tenant_id']);
        $movementsBefore = StockMovement::count();
        $entriesBefore = JournalEntry::count();
        $stockBefore = ProductWarehouseStock::sum('quantity');

        foreach (['csv', 'xlsx'] as $format) {
            $this->withToken($auth['token'])->get("/api/inventory/export?scope=all&format={$format}")->assertOk();
        }

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame($movementsBefore, StockMovement::count(), 'لا حركة جديدة.');
        $this->assertSame($entriesBefore, JournalEntry::count(), 'لا قيد جديد.');
        $this->assertSame($stockBefore, ProductWarehouseStock::sum('quantity'), 'لا تغيّر في أرصدة المخازن.');
        $this->assertSame(100, $product->fresh()->quantity_on_hand, 'الكمية لم تتغيّر.');
        $this->assertSame(1000, $product->fresh()->avg_cost, 'المتوسط لم يتغيّر.');
    }

    /** @test */
    public function inventory_value_equals_quantity_times_avg_cost(): void
    {
        $auth = $this->registerTenant();
        // دفعتان بتكلفتين → متوسط متحرك، فقيمة المخزون ليست بديهية.
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = Product::create(['name' => 'صنف', 'sku' => 'AVG-1', 'type' => 'good',
            'sale_price' => 10000, 'purchase_price' => 1000, 'track_inventory' => true]);
        $inventory = app(InventoryService::class);
        $wh = Warehouse::default()?->id;
        $inventory->receiveStock($product, 100, 1000, ['warehouse_id' => $wh]);  // 100 × 10.00
        $inventory->receiveStock($product, 100, 3000, ['warehouse_id' => $wh]);  // 100 × 30.00 → متوسط 20.00

        $rows = $this->readCsv($this->withToken($auth['token'])
            ->get('/api/inventory/export?scope=all&format=csv')->assertOk());

        $this->assertSame('200', $this->column($rows, 'الكمية')[0]);
        $this->assertSame('20.00', $this->column($rows, 'متوسط التكلفة')[0]);
        // 200 × 20.00 = 4000.00 — القيمة من مصدر الحقيقة نفسه.
        $this->assertSame('4000.00', $this->column($rows, 'قيمة المخزون')[0]);
        $this->assertSame($product->fresh()->quantity_on_hand * $product->fresh()->avg_cost, 200 * 2000);
    }

    // ═══════════════════════════ الصلاحيات ═══════════════════════════

    /** @test */
    public function the_export_route_requires_the_products_view_permission(): void
    {
        $auth = $this->registerTenant();
        $this->getJson('/api/inventory/export')->assertUnauthorized();
    }
}
