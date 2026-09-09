<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\InventoryReservationService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-1B — إثبات تزامن PostgreSQL حقيقي (لا محاكاة متسلسلة)
 * ═══════════════════════════════════════════════════════════════
 *
 * يشغّل عمليتي حجز في عمليتَي نظام (OS processes) حقيقيتين منفصلتين عبر
 * `pcntl_fork()` — لا Job/queue وهمي ولا استدعاءين متتاليين في نفس العملية.
 * كل عملية طفل تفتح اتصال PostgreSQL خاصاً بها (`DB::purge()` فوراً بعد
 * `fork()`؛ اتصال PDO لا يجوز مشاركته بين عمليتين بعد fork) فتتنافسان فعلياً
 * على قفل الصفّ `product_warehouse_stock(product_id, warehouse_id)` الذي
 * تفرضه `InventoryReservationService::acquire()`.
 *
 * **لا يعمل هذا الاختبار إلا على PostgreSQL حقيقي**: SQLite يسلسل الكتابة
 * على مستوى الملف فلا يُظهر تنافساً حقيقياً على قفل صفّ، وSQLite في الذاكرة
 * لا تشاركه عمليات نظام منفصلة أصلاً. يُهمَل (skip) صراحة إن لم يكن المحرك
 * `pgsql` أو `pcntl` غير متاح — ولا يُهمَل أبداً على PostgreSQL في CI.
 *
 * تشغيل: php artisan test --filter=InventoryReservationPostgresConcurrencyTest
 */
class InventoryReservationPostgresConcurrencyTest extends TestCase
{
    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً حقيقياً على قفل صفّ.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        // ترحيل fresh هنا (لا RefreshDatabase): يجب أن تُلتزَم (commit) بيانات
        // الاختبار فعلياً في القاعدة، فعمليات fork الفرعية تفتح اتصالاً جديداً
        // مستقلاً ولن ترى أي شيء داخل معاملة الأب غير المُلتزَمة — وهذا بالضبط
        // ما يمنعه `RefreshDatabase`.
        $this->tenant = Tenant::create([
            'name' => 'نبراس تزامن', 'slug' => 'nibras-concurrency-' . uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    protected function tearDown(): void
    {
        if (isset($this->tenant)) {
            // حذفٌ يدوي صريح: لا معاملة تُلتزَم تلقائياً تنظّف خلفها هنا.
            DB::table('inventory_reservations')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_warehouse_stock')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('products')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('warehouses')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('tenants')->where('id', $this->tenant->id)->delete();
        }

        parent::tearDown();
    }

    /**
     * ينشئ منتجاً ومخزناً ورصيداً **مُلتزَماً فعلياً** (بلا معاملة مفتوحة)
     * كي تراه عمليات fork الفرعية.
     */
    private function committedFixture(int $onHand): array
    {
        $warehouse = Warehouse::create(['tenant_id' => $this->tenant->id, 'name' => 'مخزن تزامن', 'code' => 'CC-' . uniqid()]);
        $product = Product::create(['tenant_id' => $this->tenant->id, 'name' => 'منتج تزامن', 'track_inventory' => true]);
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenant->id, 'product_id' => $product->id, 'warehouse_id' => $warehouse->id,
            'quantity' => $onHand,
        ]);

        return [$product, $warehouse];
    }

    /**
     * يشغّل كل دالة في `$jobs` داخل عملية نظام منفصلة عبر fork، مع حاجزٍ
     * (busy-wait على وجود ملف) يقرّب لحظة انطلاقهما كي يتزاحما فعلياً على
     * القفل بدل أن تُنهي إحداهما قبل أن تبدأ الأخرى. يعيد نتيجة كل عملية
     * (نجاح/فشل ونوع الاستثناء) قُرئت من ملفٍّ مؤقت كتبته كل عملية طفل.
     *
     * @param  list<callable(): mixed>  $jobs
     * @return list<array{ok: bool, error_class?: string, message?: string}>
     */
    private function runConcurrently(array $jobs): array
    {
        $barrier = tempnam(sys_get_temp_dir(), 'ats_barrier_');
        unlink($barrier); // الملف نفسه هو الإشارة — البداية بغيابه.

        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFile = tempnam(sys_get_temp_dir(), 'ats_result_');
            $resultFiles[$i] = $resultFile;

            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork — لا يمكن إثبات تزامن حقيقي بدونه.');
            }

            if ($pid === 0) {
                // ── عملية طفل: اتصال قاعدة بيانات جديد تماماً، لا يشارك PDO الأب.
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

        // كلا الطفلين الآن ينتظران الحاجز — إشارة الانطلاق المتزامنة.
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
    public function competing_reservations_cannot_collectively_oversell(): void
    {
        [$product, $warehouse] = $this->committedFixture(onHand: 10);
        $tenantId = $this->tenant->id;

        $results = $this->runConcurrently([
            function () use ($tenantId, $product, $warehouse) {
                app(TenantContext::class)->set($tenantId);

                return app(InventoryReservationService::class)
                    ->acquire($product->id, $warehouse->id, 7, 'concurrency-case-a-1')
                    ->id;
            },
            function () use ($tenantId, $product, $warehouse) {
                app(TenantContext::class)->set($tenantId);

                return app(InventoryReservationService::class)
                    ->acquire($product->id, $warehouse->id, 7, 'concurrency-case-a-2')
                    ->id;
            },
        ]);

        $successes = array_filter($results, fn (array $r) => $r['ok'] === true);
        $failures = array_filter($results, fn (array $r) => $r['ok'] === false);

        $this->assertCount(1, $successes, 'يجب أن تنجح عملية حجز واحدة فقط من أصل ٢: ' . json_encode($results));
        $this->assertCount(1, $failures, 'يجب أن تُرفض العملية الأخرى: ' . json_encode($results));
        $this->assertSame(
            \App\Services\Commerce\InsufficientAvailabilityException::class,
            array_values($failures)[0]['error_class'],
            'الرفض يجب أن يكون بسبب عدم كفاية ATS، لا خطأً آخر.'
        );

        app(TenantContext::class)->set($tenantId);
        $activeReserved = app(InventoryReservationService::class)->activeReservedQuantity($product->id, $warehouse->id);
        $this->assertSame(7, $activeReserved, 'المحجوز النشط يجب أن يساوي ٧ بالضبط — لا ١٤ (بيع زائد) ولا صفر.');

        $ats = app(AvailableToSellService::class)->forWarehouse($product->id, $warehouse->id);
        $this->assertSame(10, $ats->onHand);
        $this->assertSame(3, $ats->availableToSell);
    }

    /** @test */
    public function reserving_exactly_to_the_boundary_succeeds_for_both_requests(): void
    {
        [$product, $warehouse] = $this->committedFixture(onHand: 10);
        $tenantId = $this->tenant->id;
        app(TenantContext::class)->set($tenantId);
        $reservations = app(InventoryReservationService::class);

        $first = $reservations->acquire($product->id, $warehouse->id, 6, 'concurrency-case-b-1');
        $second = $reservations->acquire($product->id, $warehouse->id, 4, 'concurrency-case-b-2');

        $this->assertTrue($first->isActive());
        $this->assertTrue($second->isActive());
        $this->assertSame(10, $reservations->activeReservedQuantity($product->id, $warehouse->id));

        $ats = app(AvailableToSellService::class)->forWarehouse($product->id, $warehouse->id);
        $this->assertSame(0, $ats->availableToSell);
    }

    /** @test */
    public function one_unit_beyond_a_fully_reserved_boundary_is_rejected(): void
    {
        [$product, $warehouse] = $this->committedFixture(onHand: 10);
        $tenantId = $this->tenant->id;
        app(TenantContext::class)->set($tenantId);
        $reservations = app(InventoryReservationService::class);

        $reservations->acquire($product->id, $warehouse->id, 6, 'concurrency-case-c-1');
        $reservations->acquire($product->id, $warehouse->id, 4, 'concurrency-case-c-2');

        $this->expectException(\App\Services\Commerce\InsufficientAvailabilityException::class);
        $reservations->acquire($product->id, $warehouse->id, 1, 'concurrency-case-c-3');
    }
}
