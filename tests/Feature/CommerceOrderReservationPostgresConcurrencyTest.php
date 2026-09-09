<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderLine;
use App\Models\FulfillmentPolicy;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CommerceOrderReservationService;
use App\Services\Commerce\InventoryReservationService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-5B — إثبات تزامن PostgreSQL حقيقي على مستوى orchestration
 * ═══════════════════════════════════════════════════════════════
 *
 * نفس مبدأ `InventoryReservationPostgresConcurrencyTest` (COM-1B) حرفياً —
 * عمليتا نظام حقيقيتان عبر `pcntl_fork()`، لا محاكاة متسلسلة — لكن هنا
 * المتنافسان طلبا Commerce مؤكَّدان كاملان (`CommerceOrderReservationService::reserve()`)
 * لا استدعاء `acquire()` مباشرة، لإثبات أن طبقة التنسيق لا تكسر ضمان COM-1B
 * عند تركيبها فوقه.
 *
 * يُهمَل (skip) إن لم يكن المحرك `pgsql` حقيقياً أو `pcntl` غير متاح.
 *
 * تشغيل: php artisan test --filter=CommerceOrderReservationPostgresConcurrencyTest
 */
class CommerceOrderReservationPostgresConcurrencyTest extends TestCase
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

        // لا RefreshDatabase هنا: عمليات fork الفرعية تحتاج رؤية بيانات
        // مُلتزَمة فعلياً، لا معاملة أبٍ لم تُلتزَم بعد.
        $this->tenant = Tenant::create([
            'name' => 'نبراس تزامن طلب', 'slug' => 'nibras-order-concurrency-' . uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    protected function tearDown(): void
    {
        if (isset($this->tenant)) {
            DB::table('inventory_reservations')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('commerce_order_lines')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('commerce_orders')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('fulfillment_policies')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('sales_channels')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('product_warehouse_stock')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('products')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('warehouses')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('tenants')->where('id', $this->tenant->id)->delete();
        }

        parent::tearDown();
    }

    /** يبني قناة/مخزن/سياسة/منتج/رصيد وطلبَين مؤكَّدَين — كلها مُلتزَمة فعلياً. */
    private function committedFixture(int $onHand, int $qtyA, int $qtyB): array
    {
        $warehouse = Warehouse::create(['tenant_id' => $this->tenant->id, 'name' => 'مخزن تزامن طلب', 'code' => 'OCC-' . uniqid()]);
        $product = Product::create(['tenant_id' => $this->tenant->id, 'name' => 'منتج تزامن طلب', 'track_inventory' => true, 'sale_price' => 1000]);
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenant->id, 'product_id' => $product->id, 'warehouse_id' => $warehouse->id,
            'quantity' => $onHand,
        ]);
        $channel = SalesChannel::create([
            'tenant_id' => $this->tenant->id, 'slug' => 'mobile-' . uniqid(), 'name' => 'متجرنا تزامن', 'type' => SalesChannel::TYPE_MOBILE,
        ]);
        FulfillmentPolicy::create([
            'tenant_id' => $this->tenant->id, 'sales_channel_id' => $channel->id, 'warehouse_id' => $warehouse->id,
        ]);

        $orderA = CommerceOrder::create([
            'tenant_id' => $this->tenant->id, 'sales_channel_id' => $channel->id,
            'number' => 'CORD-OCC-A-' . uniqid(), 'status' => CommerceOrder::STATUS_CONFIRMED,
        ]);
        CommerceOrderLine::create([
            'tenant_id' => $this->tenant->id, 'commerce_order_id' => $orderA->id, 'product_id' => $product->id,
            'product_name_snapshot' => $product->name, 'quantity' => $qtyA, 'unit_factor' => 1,
            'unit_price' => 1000, 'line_total' => 1000 * $qtyA,
        ]);

        $orderB = CommerceOrder::create([
            'tenant_id' => $this->tenant->id, 'sales_channel_id' => $channel->id,
            'number' => 'CORD-OCC-B-' . uniqid(), 'status' => CommerceOrder::STATUS_CONFIRMED,
        ]);
        CommerceOrderLine::create([
            'tenant_id' => $this->tenant->id, 'commerce_order_id' => $orderB->id, 'product_id' => $product->id,
            'product_name_snapshot' => $product->name, 'quantity' => $qtyB, 'unit_factor' => 1,
            'unit_price' => 1000, 'line_total' => 1000 * $qtyB,
        ]);

        return [$product, $warehouse, $orderA, $orderB];
    }

    /**
     * @param  list<callable(): mixed>  $jobs
     * @return list<array{ok: bool, error_class?: string, message?: string}>
     */
    private function runConcurrently(array $jobs): array
    {
        $barrier = tempnam(sys_get_temp_dir(), 'cor_barrier_');
        unlink($barrier);

        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFile = tempnam(sys_get_temp_dir(), 'cor_result_');
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
    public function competing_confirmed_orders_cannot_collectively_oversell(): void
    {
        [$product, $warehouse, $orderA, $orderB] = $this->committedFixture(onHand: 10, qtyA: 7, qtyB: 7);
        $tenantId = $this->tenant->id;

        $results = $this->runConcurrently([
            function () use ($tenantId, $orderA) {
                app(TenantContext::class)->set($tenantId);

                return app(CommerceOrderReservationService::class)->reserve($orderA)->first()->id;
            },
            function () use ($tenantId, $orderB) {
                app(TenantContext::class)->set($tenantId);

                return app(CommerceOrderReservationService::class)->reserve($orderB)->first()->id;
            },
        ]);

        $successes = array_filter($results, fn (array $r) => $r['ok'] === true);
        $failures = array_filter($results, fn (array $r) => $r['ok'] === false);

        $this->assertCount(1, $successes, 'يجب أن ينجح طلب واحد فقط من أصل ٢: ' . json_encode($results));
        $this->assertCount(1, $failures, 'يجب أن يُرفض الطلب الآخر: ' . json_encode($results));
        $this->assertSame(
            \App\Services\Commerce\InsufficientAvailabilityException::class,
            array_values($failures)[0]['error_class'],
            'الرفض يجب أن يكون بسبب عدم كفاية ATS، لا خطأً آخر.'
        );

        app(TenantContext::class)->set($tenantId);
        $activeReserved = app(InventoryReservationService::class)->activeReservedQuantity($product->id, $warehouse->id);
        $this->assertSame(7, $activeReserved, 'المحجوز النشط = ٧ بالضبط — لا ١٤ (بيع زائد) ولا صفر.');
        $this->assertLessThanOrEqual(10, $activeReserved, 'المحجوز النشط لا يتجاوز On Hand أبداً.');

        $ats = app(AvailableToSellService::class)->forWarehouse($product->id, $warehouse->id);
        $this->assertSame(10, $ats->onHand, 'On Hand بلا تغيير.');
        $this->assertSame(3, $ats->availableToSell);
        $this->assertGreaterThanOrEqual(0, $ats->availableToSell, 'ATS لا يصبح سالباً أبداً.');
    }
}
