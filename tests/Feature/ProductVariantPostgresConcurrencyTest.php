<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductOption;
use App\Models\ProductOptionValue;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-CORE-1 — إثبات تزامن PostgreSQL حقيقي (لا محاكاة متسلسلة)
 * ═══════════════════════════════════════════════════════════════
 *  يشغّل عمليتي نظام حقيقيتين منفصلتين عبر `pcntl_fork()`، بنفس أسلوب
 *  `InventoryReservationPostgresConcurrencyTest` حرفياً — كل طفلٍ يفتح اتصال
 *  PostgreSQL خاصاً به (`DB::purge()` فوراً بعد `fork()`) فيتنافسان فعلياً على
 *  القيود الفريدة في قاعدة البيانات:
 *   - `product_variants(product_id, combination_key)` لمنع ازدواج التركيبة؛
 *   - `sku_registry(tenant_id, sku)` لمنع تصادم SKU بين هويتين.
 *
 *  **لا يعمل هذا الاختبار إلا على PostgreSQL حقيقي** — نفس قيد الاختبار
 *  المرجعي. يُهمَل صراحةً إن لم يكن المحرك `pgsql` أو `pcntl` غير متاح.
 *
 *  تشغيل: php artisan test --filter=ProductVariantPostgresConcurrencyTest
 */
class ProductVariantPostgresConcurrencyTest extends TestCase
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
            'name' => 'نبراس تزامن VAR', 'slug' => 'var-concurrency-'.uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    protected function tearDown(): void
    {
        if (isset($this->tenant)) {
            DB::table('product_variant_option_values')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('sku_registry')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_variants')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_option_values')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_options')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('products')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('branches')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('tenants')->where('id', $this->tenant->id)->delete();
        }

        parent::tearDown();
    }

    /** منتجٌ متعدد الخيارات مُلتزَمٌ فعلياً (بلا معاملة مفتوحة) بخيار لون وقيمتين. */
    private function committedVariantManagedProduct(string $sku): array
    {
        $product = Product::create([
            'tenant_id' => $this->tenant->id, 'name' => 'منتج تزامن', 'sku' => $sku,
            'variant_state' => 'variant_managed',
        ]);
        $option = ProductOption::create([
            'tenant_id' => $this->tenant->id, 'product_id' => $product->id,
            'name' => 'اللون', 'name_key' => 'اللون',
        ]);
        $black = ProductOptionValue::create([
            'tenant_id' => $this->tenant->id, 'product_option_id' => $option->id,
            'value' => 'أسود', 'value_key' => 'أسود',
        ]);

        return [$product, $option, $black];
    }

    /**
     * @param  list<callable(): mixed>  $jobs
     * @return list<array{ok: bool, error_class?: string, message?: string}>
     */
    private function runConcurrently(array $jobs): array
    {
        $barrier = tempnam(sys_get_temp_dir(), 'var_barrier_');
        unlink($barrier);

        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFile = tempnam(sys_get_temp_dir(), 'var_result_');
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
    public function two_concurrent_attempts_to_create_the_same_combination_leave_exactly_one_variant(): void
    {
        [$product, , $black] = $this->committedVariantManagedProduct('CONC-COMBO-1');
        $tenantId = $this->tenant->id;
        $productId = $product->id;
        $blackId = $black->id;

        $results = $this->runConcurrently([
            function () use ($tenantId, $productId, $blackId) {
                app(TenantContext::class)->set($tenantId);
                $product = Product::find($productId);

                return app(ProductVariantService::class)->createSingleVariant($product, [$blackId], null);
            },
            function () use ($tenantId, $productId, $blackId) {
                app(TenantContext::class)->set($tenantId);
                $product = Product::find($productId);

                return app(ProductVariantService::class)->createSingleVariant($product, [$blackId], null);
            },
        ]);

        foreach ($results as $result) {
            $this->assertTrue($result['ok'], 'يجب ألّا يفشل أيّ طرفٍ باستثناءٍ غير مُدار: '.json_encode($result));
        }

        $statuses = array_map(fn (array $r) => $r['value']['status'], $results);
        sort($statuses);
        $this->assertSame(['created', 'duplicate'], $statuses, 'طرفٌ واحد ينشئ، والآخر يكتشف الازدواج — لا استثناءً خاماً: '.json_encode($results));

        app(TenantContext::class)->set($tenantId);
        $this->assertSame(1, ProductVariant::where('product_id', $productId)->count(), 'يجب أن يوجد متغيّرٌ واحدٌ بالضبط بعد السباق.');
    }

    /** @test */
    public function two_concurrent_catalog_identities_claiming_the_same_sku_leave_exactly_one_winner(): void
    {
        $tenantId = $this->tenant->id;
        app(TenantContext::class)->set($tenantId);

        // منتجان مختلفان يتنافسان مباشرةً على SKU واحد صراحةً — نفس نطاق
        // العقد («منتجٌ مقابل منتج» تحت المطالبة الموحّدة، وليس تركيبةً).
        $productA = Product::create(['tenant_id' => $tenantId, 'name' => 'منتج أ', 'sku' => 'SEED-A']);
        $productB = Product::create(['tenant_id' => $tenantId, 'name' => 'منتج ب', 'sku' => 'SEED-B']);

        $results = $this->runConcurrently([
            function () use ($tenantId, $productA) {
                app(TenantContext::class)->set($tenantId);
                $p = Product::find($productA->id);
                $p->sku = 'RACE-SKU';
                $p->save();

                return true;
            },
            function () use ($tenantId, $productB) {
                app(TenantContext::class)->set($tenantId);
                $p = Product::find($productB->id);
                $p->sku = 'RACE-SKU';
                $p->save();

                return true;
            },
        ]);

        $successes = array_filter($results, fn (array $r) => $r['ok'] === true);
        $failures = array_filter($results, fn (array $r) => $r['ok'] === false);

        $this->assertCount(1, $successes, 'يجب أن تنجح مطالبةٌ واحدة فقط بـ SKU: '.json_encode($results));
        $this->assertCount(1, $failures, 'يجب أن تُرفض المطالبة الأخرى: '.json_encode($results));

        app(TenantContext::class)->set($tenantId);
        $this->assertSame(
            1,
            DB::table('sku_registry')->where('tenant_id', $tenantId)->where('sku', 'RACE-SKU')->count(),
            'يجب أن يوجد تسجيلٌ واحدٌ بالضبط لـ SKU المتنازَع عليه.'
        );
    }

    /**
     * الفجوة المتبقّية التي أُغلقت: مطالبةٌ في الفضاء الموحّد (منتجٌ مشترك
     * هنا؛ السلوك نفسه لمتغيّرٍ أو منتجٍ متعدد الخيارات) تتسابق فعلياً — عبر
     * عمليتَي نظام منفصلتين حقيقيتين — مع منتجٍ فرعي معزول يحاول الرمز نفسه.
     * القفل على صفّ المستأجر (`SkuRegistryEntry::lockTenantAnchor()`) يضمن
     * تسلسل الفحص العابر للجدولين (`sku_registry` و`products`)؛ النتيجة يجب
     * أن تكون فائزاً واحداً بالضبط — لا كلا الجدولين معاً، ولا لا شيء.
     *
     * @test
     */
    public function a_registry_claim_racing_a_branch_isolated_product_for_the_same_sku_leaves_exactly_one_winner(): void
    {
        $tenantId = $this->tenant->id;
        app(TenantContext::class)->set($tenantId);

        $branch = \App\Models\Branch::create([
            'tenant_id' => $tenantId, 'code' => 'BR-RACE', 'name' => 'فرع السباق', 'is_main' => true,
        ]);
        \App\Support\BranchSettings::merge(['share_products' => false]);

        $results = $this->runConcurrently([
            function () use ($tenantId) {
                app(TenantContext::class)->set($tenantId);
                // منتجٌ بلا فرع (مشترك) — يطالب بالرمز في الفضاء الموحّد.
                $p = Product::create(['tenant_id' => $tenantId, 'name' => 'منتج مشترك', 'sku' => 'XRACE-SKU']);

                return $p->id;
            },
            function () use ($tenantId, $branch) {
                app(TenantContext::class)->set($tenantId);
                // منتجٌ فرعي معزول — يتحقق ألّا يصطدم بالفضاء الموحّد.
                $p = Product::create([
                    'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'name' => 'منتج معزول', 'sku' => 'XRACE-SKU',
                ]);

                return $p->id;
            },
        ]);

        $successes = array_filter($results, fn (array $r) => $r['ok'] === true);
        $failures = array_filter($results, fn (array $r) => $r['ok'] === false);

        $this->assertCount(1, $successes, 'يجب أن ينجح طرفٌ واحدٌ فقط في أخذ الرمز: '.json_encode($results));
        $this->assertCount(1, $failures, 'يجب أن يُرفض الطرف الآخر بخطأ SKU مُدار، لا استثناءً خاماً: '.json_encode($results));

        app(TenantContext::class)->set($tenantId);
        $registryCount = DB::table('sku_registry')->where('tenant_id', $tenantId)->where('sku', 'XRACE-SKU')->count();
        $isolatedCount = DB::table('products')->where('tenant_id', $tenantId)->where('sku', 'XRACE-SKU')
            ->whereNotNull('branch_id')->whereNull('deleted_at')->count();

        $this->assertSame(1, $registryCount + $isolatedCount, 'يجب أن يفوز طرفٌ واحدٌ بالضبط بالرمز، محسوباً عبر الجدولين معاً.');
        $this->assertFalse($registryCount === 1 && $isolatedCount === 1, 'لا يجوز أن يفوز الطرفان معاً بنفس الرمز عبر جدولين مختلفين.');
    }
}
