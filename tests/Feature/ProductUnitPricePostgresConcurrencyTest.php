<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductOption;
use App\Models\ProductOptionValue;
use App\Models\ProductUnitPrice;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Services\ProductPricingService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-PRICE-1 — إثبات تزامن PostgreSQL حقيقي لهويّة التسعير
 * ═══════════════════════════════════════════════════════════════
 *  عمليتا نظام حقيقيتان منفصلتان عبر `pcntl_fork()` — نفس أسلوب
 *  `InventoryStatePostgresConcurrencyTest`/`ProductVariantPostgresConcurrencyTest`
 *  حرفياً. تتنافس فعلياً على القيود الفريدة الجزئية لـ`product_unit_prices`.
 *
 *  **لا يعمل هذا الاختبار إلا على PostgreSQL حقيقي.**
 *
 *  تشغيل: php artisan test --filter=ProductUnitPricePostgresConcurrencyTest
 */
class ProductUnitPricePostgresConcurrencyTest extends TestCase
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
            'name' => 'نبراس تزامن التسعير', 'slug' => 'price-concurrency-'.uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    protected function tearDown(): void
    {
        if (isset($this->tenant)) {
            DB::table('product_unit_prices')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('unit_template_units')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('unit_templates')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_variant_option_values')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_variants')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_option_values')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_options')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('products')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('branches')->where('tenant_id', $this->tenant->id)->delete();
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
        $barrier = tempnam(sys_get_temp_dir(), 'price_barrier_');
        unlink($barrier);

        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFile = tempnam(sys_get_temp_dir(), 'price_result_');
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
    public function two_concurrent_writes_to_the_same_product_unit_price_leave_exactly_one_row_with_the_last_writer_winning_or_first_consistent(): void
    {
        $tenantId = $this->tenant->id;
        $product = Product::create(['tenant_id' => $tenantId, 'name' => 'منتج سباق تسعير', 'sale_price' => 100]);
        $template = \App\Models\UnitTemplate::create(['tenant_id' => $tenantId, 'name' => 'قالب سباق', 'base_unit' => $product->unit]);
        $template->units()->create(['tenant_id' => $tenantId, 'name' => 'carton', 'factor' => 12]);
        $product->update(['unit_template_id' => $template->id]);
        $productId = $product->id;

        $results = $this->runConcurrently([
            function () use ($tenantId, $productId) {
                app(TenantContext::class)->set($tenantId);

                return app(ProductPricingService::class)->setPrice(Product::find($productId), null, 'carton', 5000)->id;
            },
            function () use ($tenantId, $productId) {
                app(TenantContext::class)->set($tenantId);

                return app(ProductPricingService::class)->setPrice(Product::find($productId), null, 'carton', 7000)->id;
            },
        ]);

        foreach ($results as $result) {
            $this->assertTrue($result['ok'], 'كلا الكتابتين يجب أن تنجح — لا سباق ينتج استثناءً خاماً: '.json_encode($result));
        }

        app(TenantContext::class)->set($tenantId);
        $rows = ProductUnitPrice::where('product_id', $productId)->where('unit_name', 'carton')->get();
        $this->assertCount(1, $rows, 'صفٌّ واحدٌ بالضبط رغم السباق على الإنشاء الأوّل — لا ازدواج.');
        $this->assertContains((int) $rows->first()->price, [5000, 7000], 'قيمةٌ متّسقة من أحد الطرفين، لا قيمةٌ فاسدة.');
    }

    /** @test */
    public function concurrent_first_time_creation_for_two_sibling_variants_never_cross_contaminates(): void
    {
        $tenantId = $this->tenant->id;
        $product = Product::create(['tenant_id' => $tenantId, 'name' => 'منتج متغيّرات سباق تسعير', 'variant_state' => 'variant_managed']);
        $option = ProductOption::create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'name' => 'اللون', 'name_key' => 'اللون']);
        $red = ProductOptionValue::create(['tenant_id' => $tenantId, 'product_option_id' => $option->id, 'value' => 'أحمر', 'value_key' => 'أحمر']);
        $blue = ProductOptionValue::create(['tenant_id' => $tenantId, 'product_option_id' => $option->id, 'value' => 'أزرق', 'value_key' => 'أزرق']);
        $variantRed = ProductVariant::create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'sku' => 'PRICE-RACE-RED', 'combination_key' => $red->id]);
        $variantBlue = ProductVariant::create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'sku' => 'PRICE-RACE-BLUE', 'combination_key' => $blue->id]);

        $productId = $product->id;
        $redId = $variantRed->id;
        $blueId = $variantBlue->id;

        $results = $this->runConcurrently([
            function () use ($tenantId, $productId, $redId) {
                app(TenantContext::class)->set($tenantId);
                $product = Product::find($productId);
                $variant = ProductVariant::find($redId);

                return app(ProductPricingService::class)->setPrice($product, $variant, null, 5500)->id;
            },
            function () use ($tenantId, $productId, $blueId) {
                app(TenantContext::class)->set($tenantId);
                $product = Product::find($productId);
                $variant = ProductVariant::find($blueId);

                return app(ProductPricingService::class)->setPrice($product, $variant, null, 4800)->id;
            },
        ]);

        foreach ($results as $result) {
            $this->assertTrue($result['ok'], json_encode($result));
        }

        app(TenantContext::class)->set($tenantId);
        $this->assertSame(5500, ProductUnitPrice::where('product_variant_id', $redId)->value('price'));
        $this->assertSame(4800, ProductUnitPrice::where('product_variant_id', $blueId)->value('price'));
    }

    /** @test */
    public function a_duplicate_simple_product_base_price_race_never_leaves_two_rows(): void
    {
        $tenantId = $this->tenant->id;
        $product = Product::create(['tenant_id' => $tenantId, 'name' => 'منتج سباق أساسي', 'sale_price' => 100]);
        $productId = $product->id;

        // كلاهما يكتب نفس الوحدة الأساسية صراحةً — محاكاة سباقٍ على القيد
        // الجزئي `(product_id, unit_name) WHERE product_variant_id IS NULL`.
        $results = $this->runConcurrently([
            function () use ($tenantId, $productId) {
                app(TenantContext::class)->set($tenantId);
                $product = Product::find($productId);

                return app(ProductPricingService::class)->setPrice($product, null, null, 1100)->id;
            },
            function () use ($tenantId, $productId) {
                app(TenantContext::class)->set($tenantId);
                $product = Product::find($productId);

                return app(ProductPricingService::class)->setPrice($product, null, null, 1300)->id;
            },
        ]);

        foreach ($results as $result) {
            $this->assertTrue($result['ok'], json_encode($result));
        }

        app(TenantContext::class)->set($tenantId);
        $this->assertSame(
            1,
            ProductUnitPrice::where('product_id', $productId)->whereNull('product_variant_id')->where('unit_name', 'piece')->count(),
            'صفٌّ واحدٌ بالضبط — القيد الجزئي هو الضامن الحقيقي.'
        );
    }
}
