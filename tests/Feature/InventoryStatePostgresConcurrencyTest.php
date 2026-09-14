<?php

namespace Tests\Feature;

use App\Models\InventoryState;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\ProductOptionValue;
use App\Models\ProductVariant;
use App\Models\ProductWarehouseStock;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-INV-1 — إثبات تزامن PostgreSQL حقيقي لهويّة المخزون
 * ═══════════════════════════════════════════════════════════════
 *  عمليتا نظام حقيقيتان منفصلتان عبر `pcntl_fork()` (نفس أسلوب
 *  `ProductVariantPostgresConcurrencyTest`/`InventoryReservationPostgresConcurrencyTest`
 *  حرفياً): كل طفلٍ يفتح اتصال PostgreSQL خاصاً به فيتنافسان فعلياً على:
 *   - القيد الفريد الجزئي لهويّة المخزون البسيطة (`inventory_states.product_id`
 *     حيث `product_variant_id IS NULL`) — سباق إنشاء الصفّ الأوّل؛
 *   - قفل `lockForUpdate()` على صفّ الهويّة — سباق استلامين متزامنين؛
 *   - القيد الفريد الجزئي لرصيد المخزن (`product_warehouse_stock`) لكل
 *     متغيّرٍ شقيق على حدة — عدم تلوّث كميّة/مراجعة شقيقٍ بآخر.
 *
 *  **لا يعمل هذا الاختبار إلا على PostgreSQL حقيقي.**
 *
 *  تشغيل: php artisan test --filter=InventoryStatePostgresConcurrencyTest
 */
class InventoryStatePostgresConcurrencyTest extends TestCase
{
    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً حقيقياً على قيدٍ فريد.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $this->tenant = Tenant::create([
            'name' => 'نبراس تزامن المخزون', 'slug' => 'inv-concurrency-'.uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
    }

    protected function tearDown(): void
    {
        if (isset($this->tenant)) {
            DB::table('product_warehouse_stock')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('inventory_states')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('stock_movements')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_variant_option_values')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('sku_registry')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_variants')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_option_values')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_options')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('journal_lines')->whereIn('journal_entry_id', function ($q) {
                $q->select('id')->from('journal_entries')->where('tenant_id', $this->tenant->id);
            })->delete();
            DB::table('journal_entries')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('products')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('warehouses')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('branches')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('account_balances')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('account_role_mappings')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('accounts')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('tenants')->where('id', $this->tenant->id)->delete();
        }

        parent::tearDown();
    }

    /**
     * @param  list<callable(): mixed>  $jobs
     * @return list<array{ok: bool, error_class?: string, message?: string, value?: mixed}>
     */
    private function runConcurrently(array $jobs): array
    {
        $barrier = tempnam(sys_get_temp_dir(), 'inv_barrier_');
        unlink($barrier);

        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFile = tempnam(sys_get_temp_dir(), 'inv_result_');
            $resultFiles[$i] = $resultFile;

            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork — لا يمكن إثبات تزامن حقيقي بدونه.');
            }

            if ($pid === 0) {
                DB::purge(config('database.default'));

                $deadline = microtime(true) + 5.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }

                try {
                    $value = $job();
                    file_put_contents($resultFile, json_encode(['ok' => true, 'value' => $value]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFile, json_encode([
                        'ok' => false,
                        'error_class' => get_class($e),
                        'message' => $e->getMessage(),
                    ]));
                }

                exit(0);
            }

            $pids[] = $pid;
        }

        touch($barrier);

        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }
        @unlink($barrier);

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = file_get_contents($file);
            @unlink($file);
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }

    /** @test */
    public function two_concurrent_receipts_for_a_brand_new_simple_product_leave_exactly_one_state_row_with_both_quantities(): void
    {
        $tenantId = $this->tenant->id;
        $product = Product::create(['tenant_id' => $tenantId, 'name' => 'بضاعة سباق', 'track_inventory' => true]);
        $productId = $product->id;

        $results = $this->runConcurrently([
            function () use ($tenantId, $productId) {
                app(TenantContext::class)->set($tenantId);

                return app(InventoryService::class)->receiveStock(Product::find($productId), 10, 1000)->id;
            },
            function () use ($tenantId, $productId) {
                app(TenantContext::class)->set($tenantId);

                return app(InventoryService::class)->receiveStock(Product::find($productId), 20, 3000)->id;
            },
        ]);

        foreach ($results as $result) {
            $this->assertTrue($result['ok'], 'كلا الاستلامين يجب أن ينجح — لا سباق ينتج استثناءً خاماً: '.json_encode($result));
        }

        app(TenantContext::class)->set($tenantId);
        $this->assertSame(1, InventoryState::where('product_id', $productId)->count(), 'صفٌّ واحدٌ بالضبط رغم السباق على الإنشاء الأوّل.');

        $state = InventoryState::where('product_id', $productId)->first();
        // (10*1000 + 20*3000) / 30 = 2333 (intdiv) — بصرف النظر عن ترتيب الفوز.
        $this->assertSame(30, $state->quantity_on_hand, 'لا فقد تحديثٍ (lost update) — كلا الكميتين محتسَبتان.');
        $this->assertSame(2333, $state->avg_cost);
    }

    /** @test */
    public function concurrent_receipt_and_issue_on_the_same_identity_serialize_to_a_consistent_final_quantity(): void
    {
        $tenantId = $this->tenant->id;
        $product = Product::create(['tenant_id' => $tenantId, 'name' => 'بضاعة سباق ٢', 'track_inventory' => true]);
        app(InventoryService::class)->receiveStock($product, 50, 1000);
        $productId = $product->id;

        $results = $this->runConcurrently([
            function () use ($tenantId, $productId) {
                app(TenantContext::class)->set($tenantId);

                return app(InventoryService::class)->receiveStock(Product::find($productId), 10, 1000)->id;
            },
            function () use ($tenantId, $productId) {
                app(TenantContext::class)->set($tenantId);

                // applyIssue() بلا قيد محاسبي عمداً — عقده الموثَّق يشترط
                // استدعاءه **ضمن معاملة المستدعي** (كما تفعل ReturnService/
                // StockPermitService فعلياً) لأن قفل `resolveInventoryState()`
                // بلا معاملة صريحة يُحرَّر فور انتهاء جملته فلا يُسلسل شيئاً.
                return \Illuminate\Support\Facades\DB::transaction(
                    fn () => app(InventoryService::class)->applyIssue(Product::find($productId), 5, 1000)->id
                );
            },
        ]);

        foreach ($results as $result) {
            $this->assertTrue($result['ok'], json_encode($result));
        }

        app(TenantContext::class)->set($tenantId);
        $state = InventoryState::where('product_id', $productId)->whereNull('product_variant_id')->firstOrFail();
        $this->assertSame(55, $state->quantity_on_hand, '50 + 10 - 5 = 55 مهما كان ترتيب التنفيذ الفعلي.');
    }

    /** @test */
    public function concurrent_stock_mutations_on_sibling_variants_never_cross_contaminate(): void
    {
        $tenantId = $this->tenant->id;
        $product = Product::create(['tenant_id' => $tenantId, 'name' => 'منتج متغيّرات سباق', 'variant_state' => 'variant_managed']);
        $option = ProductOption::create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'name' => 'اللون', 'name_key' => 'اللون']);
        $red = ProductOptionValue::create(['tenant_id' => $tenantId, 'product_option_id' => $option->id, 'value' => 'أحمر', 'value_key' => 'أحمر']);
        $blue = ProductOptionValue::create(['tenant_id' => $tenantId, 'product_option_id' => $option->id, 'value' => 'أزرق', 'value_key' => 'أزرق']);
        $variantRed = ProductVariant::create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'sku' => 'RACE-RED', 'combination_key' => $red->id]);
        $variantBlue = ProductVariant::create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'sku' => 'RACE-BLUE', 'combination_key' => $blue->id]);
        $warehouse = Warehouse::create(['tenant_id' => $tenantId, 'name' => 'الرئيسي', 'code' => 'WH-RACE', 'is_default' => true]);

        $productId = $product->id;
        $warehouseId = $warehouse->id;
        $redId = $variantRed->id;
        $blueId = $variantBlue->id;

        // `applyReceipt()` مباشرةً (لا `receiveStock()`): الهدف هنا إثبات عزل
        // هويّة كل متغيّرٍ شقيق عن الآخر تحت التزامن، لا سلوك قفل `tenants`
        // الموجود أصلاً في `AccountingDateGuard`/`LedgerService` عند ترحيل
        // قيدين لنفس المستأجر معاً — ذاك خارج نطاق VAR-INV-1 تماماً (لا تغيير
        // في دلالات الدفتر أو الأستاذ هنا). كل استدعاء داخل معاملته الخاصة
        // كعقد `applyReceipt()` الموثَّق يشترط.
        $results = $this->runConcurrently([
            function () use ($tenantId, $productId, $warehouseId, $redId) {
                app(TenantContext::class)->set($tenantId);

                return DB::transaction(function () use ($productId, $warehouseId, $redId) {
                    $product = Product::find($productId);
                    $variant = ProductVariant::find($redId);

                    return app(InventoryService::class)->applyReceipt($product, 7, 1000, ['warehouse_id' => $warehouseId], variant: $variant)->id;
                });
            },
            function () use ($tenantId, $productId, $warehouseId, $blueId) {
                app(TenantContext::class)->set($tenantId);

                return DB::transaction(function () use ($productId, $warehouseId, $blueId) {
                    $product = Product::find($productId);
                    $variant = ProductVariant::find($blueId);

                    return app(InventoryService::class)->applyReceipt($product, 13, 2000, ['warehouse_id' => $warehouseId], variant: $variant)->id;
                });
            },
        ]);

        foreach ($results as $result) {
            $this->assertTrue($result['ok'], json_encode($result));
        }

        app(TenantContext::class)->set($tenantId);

        $redState = InventoryState::where('product_variant_id', $redId)->firstOrFail();
        $blueState = InventoryState::where('product_variant_id', $blueId)->firstOrFail();
        $this->assertSame(7, $redState->quantity_on_hand);
        $this->assertSame(1000, $redState->avg_cost);
        $this->assertSame(13, $blueState->quantity_on_hand);
        $this->assertSame(2000, $blueState->avg_cost);

        $redStock = ProductWarehouseStock::where('product_variant_id', $redId)->where('warehouse_id', $warehouseId)->firstOrFail();
        $blueStock = ProductWarehouseStock::where('product_variant_id', $blueId)->where('warehouse_id', $warehouseId)->firstOrFail();
        $this->assertSame(7, $redStock->quantity);
        $this->assertSame(13, $blueStock->quantity);
        $this->assertSame(1, $redStock->revision);
        $this->assertSame(1, $blueStock->revision);
    }
}
