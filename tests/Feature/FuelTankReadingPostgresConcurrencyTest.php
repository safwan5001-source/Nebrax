<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Services\FuelReconciliationService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * FUEL-B6 — تزامن قراءات الخزانات المستقلة على PostgreSQL (`pcntl_fork`): تكرار المفتاح نفسه لا يُنتج أكثر من سجل واحد، والاختلاف يُرفض بوضوح
 * (لا 500 من الفهرس الفريد)، والقراءات المتعددة المختلفة المفاتيح للخزان نفسه كلها تُسجَّل بلا جمود ولا أثر مخزني.
 * على PostgreSQL لا يُتخطّى إن غاب `pcntl`؛ يُتخطّى على SQLite فقط.
 */
class FuelTankReadingPostgresConcurrencyTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

    private const BASE = '/api/fuel-stations';

    private string $dir;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على الفهارس الفريدة.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب لاختبارات تزامن PostgreSQL؛ غيابه فشل لا تخطٍّ.');
        $this->dir = sys_get_temp_dir() . '/fuel_tank_reading_' . uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir . '/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->tenants as $id) {
                DB::table('tenants')->where('id', $id)->delete();
            }
        }
        parent::tearDown();
    }

    /** @test */
    public function concurrent_identical_readings_yield_one_record_and_every_caller_gets_it(): void
    {
        $f = $this->fixture();
        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($f) {
                $this->enter($f);

                return app(FuelReconciliationService::class)->recordReading($this->data($f, 'b6-conc-same', '50.000'))->id;
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertCount(1, array_unique(array_map(fn ($r) => $r['value'], $results)));
        $this->assertSame(1, (int) DB::table('fuel_tank_readings')->where('tenant_id', $f['tenant_id'])->count());
        $this->assertSame(1, (int) DB::table('fuel_station_audit_events')->where('tenant_id', $f['tenant_id'])->where('action', 'tank_reading.recorded')->count());
    }

    /** @test */
    public function concurrent_readings_with_the_same_key_but_different_content_yield_one_winner_and_clear_rejections(): void
    {
        $f = $this->fixture();
        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($f, $i) {
                $this->enter($f);
                try {
                    app(FuelReconciliationService::class)->recordReading($this->data($f, 'b6-conc-diff', (string) (10 + $i) . '.000'));

                    return 'ok';
                } catch (RuntimeException $e) {
                    return str_contains($e->getMessage(), 'FUEL_READING_EVIDENCE_MISMATCH') ? 'mismatch' : 'other:' . $e->getMessage();
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['value'] === 'ok')), json_encode($results));
        $this->assertSame(5, count(array_filter($results, fn ($r) => $r['value'] === 'mismatch')), json_encode($results));
        $this->assertSame(1, (int) DB::table('fuel_tank_readings')->where('tenant_id', $f['tenant_id'])->count());
    }

    /** @test */
    public function concurrent_readings_with_distinct_keys_on_one_tank_are_all_recorded_without_deadlock_or_stock_effect(): void
    {
        $f = $this->fixture();
        $jobs = [];
        foreach (range(1, 8) as $i) {
            $jobs[] = function () use ($f, $i) {
                $this->enter($f);

                return app(FuelReconciliationService::class)->recordReading($this->data($f, 'b6-conc-distinct-' . $i, (string) (20 + $i) . '.000'))->id;
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertCount(8, array_unique(array_map(fn ($r) => $r['value'], $results)));
        $this->assertSame(8, (int) DB::table('fuel_tank_readings')->where('tenant_id', $f['tenant_id'])->count());
        $this->assertSame(0, (int) DB::table('stock_movements')->where('tenant_id', $f['tenant_id'])->count());
        $this->assertSame(0, (int) DB::table('journal_entries')->where('tenant_id', $f['tenant_id'])->count());
        $this->assertSame(0, (int) DB::table('fuel_operational_ledgers')->where('tenant_id', $f['tenant_id'])->count());

        // المراقب (نافذة ROW_NUMBER) يعمل على PostgreSQL ويعيد صفاً لكل خزان نشط (القراءة الأخيرة لواحد وفارغ للآخر)
        $this->enter($f);
        $rows = app(\App\Services\FuelTankLevelMonitor::class)->snapshot(FuelTank::query());
        $this->assertCount(2, $rows);
        $byTank = collect($rows)->keyBy(fn ($r) => $r['tank']['id']);
        $this->assertNotNull($byTank[$f['tank_id']]['latest']);
        $this->assertNull($byTank[$f['tank2_id']]['latest']);
    }

    /** @test */
    public function concurrent_reuse_of_one_key_across_two_tanks_keeps_a_single_record(): void
    {
        $f = $this->fixture();
        $jobs = [];
        foreach ([$f['tank_id'], $f['tank2_id'], $f['tank_id'], $f['tank2_id']] as $tankId) {
            $jobs[] = function () use ($f, $tankId) {
                $this->enter($f);
                try {
                    app(FuelReconciliationService::class)->recordReading(['fuel_tank_id' => $tankId] + $this->data($f, 'b6-conc-cross', '30.000'));

                    return 'ok';
                } catch (RuntimeException $e) {
                    return str_contains($e->getMessage(), 'FUEL_READING_EVIDENCE_MISMATCH') ? 'mismatch' : 'other:' . $e->getMessage();
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(1, (int) DB::table('fuel_tank_readings')->where('tenant_id', $f['tenant_id'])->count());
        $this->assertSame(0, count(array_filter($results, fn ($r) => str_starts_with((string) $r['value'], 'other:'))), json_encode($results));
    }

    /** @param array<string,string> $f @return array<string,mixed> */
    private function data(array $f, string $key, string $liters): array
    {
        return [
            'fuel_station_id' => $f['station_id'], 'fuel_tank_id' => $f['tank_id'], 'reading_type' => 'physical',
            'quantity_liters' => $liters, 'evidence_key' => $key, 'recorded_by' => $f['actor_id'],
        ];
    }

    /** @param array<string,string> $f */
    private function enter(array $f): void
    {
        app(TenantContext::class)->set($f['tenant_id']);
        app(BranchContext::class)->set($f['branch_id']);
    }

    /** @return array<string,string> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-rd-pg-' . Str::random(6), 'owner-' . Str::random(6) . '@fuel-rd-pg.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        $this->tenants[] = $tenantId;
        app(TenantContext::class)->set($tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_b6_pg', reason: 'اختبار تزامن قراءات الخزانات B6.',
        );
        $branch = Branch::where('tenant_id', $tenantId)->where('is_main', true)->firstOrFail();
        app(BranchContext::class)->set($branch->id);
        $warehouse = Warehouse::where('tenant_id', $tenantId)->where('is_default', true)->firstOrFail();
        $actor = User::where('tenant_id', $tenantId)->where('role', 'owner')->sole();

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود قراءات mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-RD-PG', 'name' => 'محطة قراءات']);
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-RD-PG', 'name' => 'وقود قراءات']);
        $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-RD-1', 'name' => 'خزان 1', 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000]);
        $tank2 = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-RD-2', 'name' => 'خزان 2', 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000]);

        return [
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'actor_id' => $actor->id,
            'station_id' => $station->id, 'tank_id' => $tank->id, 'tank2_id' => $tank2->id,
        ];
    }

    private function assertAllCompleted(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
        }
    }

    /** @param list<callable> $jobs @return array<int, array<string, mixed>> */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir.'/barrier_'.uniqid();
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir.'/result_'.uniqid()."_{$i}";
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork.');
            }
            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $job()]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage()]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }

        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
