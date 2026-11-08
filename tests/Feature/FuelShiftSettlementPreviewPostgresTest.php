<?php

namespace Tests\Feature;

use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\Partner;
use App\Models\User;
use App\Services\FuelSaleService;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use App\Services\FuelShiftSettlementPreviewService;
use App\Services\FuelStationWalkInPartnerService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * P1-3a — تزامن حقيقي على PostgreSQL (`pcntl_fork` + عمليات `psql` منفصلة) لمعاينة التسوية وتعيين العميل النقدي.
 *
 * الثوابت: (1) المعاينة **لا تأخذ أي قفل ولا تنتظر أحداً** — تعمل كاملةً بينما عملية أخرى تقفل الوردية والمحطة والمِرساة وحالة التكلفة والرصيد والعميل والفاتورة
 * (مع `lock_timeout` قصير على جلستها ليفشل أي انتظار)؛ (2) معاينات متكررة متزامنة مع بيع ERP وتحصيل وإقرار تحصيل بلا جمود ولا خطأ، وتعكس حالة مثبَّتة متسقة؛
 * (3) تعيين العميل النقدي المتزامن لمحطة واحدة ينتج طرفاً واحداً وربطاً واحداً بلا فشل. يُتخطّى على SQLite؛ غياب pcntl/psql على PostgreSQL فشل لا تخطٍّ.
 */
class FuelShiftSettlementPreviewPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;
    use BuildsFuelCashFixture;

    private string $dir;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على الأقفال.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب؛ غيابه فشل لا تخطٍّ.');
        config([
            'fuel_stations.shift_settlement_enabled' => true, 'fuel_stations.shift_settlement_tax_opinion_ref' => 'TAX-OPINION-PG',
            'fuel_stations.shift_collection_declaration_enabled' => true, 'fuel_stations.shift_cash_receipts_enabled' => true,
        ]);
        $this->dir = sys_get_temp_dir().'/fuel_settlement_preview_'.uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir.'/*') ?: [] as $file) {
                @unlink($file);
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

    private function prepare(string $suffix): void
    {
        $this->f = $this->fixture('-pgs-'.$suffix.'-'.bin2hex(random_bytes(3)));
        $this->tenants[] = $this->f['tenant_id'];
        $this->tenants[] = $this->f['foreign_tenant_id'];
        $this->setBasis('declared_collection');
    }

    private function meters(FuelShift $shift, int $opening = 1_000_000, int $closing = 1_020_000): void
    {
        foreach (['opening' => $opening, 'closing' => $closing] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "pg-{$shift->id}-{$stage}",
            ], $this->f['actor']);
        }
    }

    /** @param array<string,mixed> $f */
    private function enter(array $f): void
    {
        app(TenantContext::class)->set($f['tenant_id']);
        app(BranchContext::class)->set($f['branch']->id);
    }

    // ───────── 1) تعيين العميل النقدي المتزامن ─────────

    /** @test */
    public function concurrent_walk_in_assignment_creates_exactly_one_partner_and_one_link(): void
    {
        $this->prepare('wi');
        $f = $this->f;
        $before = Partner::query()->count();

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($f) {
                $this->enter($f);
                $result = app(FuelStationWalkInPartnerService::class)->assign(FuelStation::findOrFail($f['station']->id), User::findOrFail($f['actor']->id));

                return $result['created'] ? 'created' : 'existing';
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['value'] === 'created')), json_encode($results));
        $this->assertSame(1, DB::table('fuel_station_walk_in_partners')->where('fuel_station_id', $f['station']->id)->count());
        $this->assertSame(1, DB::table('partners')->where('tenant_id', $f['tenant_id'])->where('system_kind', 'fuel_walk_in')->count());
        $this->assertSame($before + 1, Partner::query()->count());
    }

    // ───────── 2) المعاينة لا تنتظر أحداً ─────────

    /** @test */
    public function the_preview_runs_to_completion_while_every_related_row_is_locked_by_another_session(): void
    {
        $this->prepare('nolock');
        $f = $this->f;
        app(FuelStationWalkInPartnerService::class)->assign($f['station'], $f['actor']);
        $shift = $this->open('nl');
        $this->meters($shift);
        $sale = $this->sale('nl-sale', $shift);
        $this->declare($shift, 4000);

        $sql = sprintf(
            "BEGIN; SELECT 1 FROM fuel_shifts WHERE id='%s' FOR UPDATE; SELECT 1 FROM fuel_stations WHERE id='%s' FOR UPDATE; SELECT 1 FROM tenants WHERE id='%s' FOR UPDATE; "
            ."SELECT 1 FROM fuel_inventory_cost_states WHERE warehouse_id='%s' FOR UPDATE; SELECT 1 FROM product_warehouse_stock WHERE warehouse_id='%s' FOR UPDATE; "
            ."SELECT 1 FROM invoices WHERE id='%s' FOR UPDATE; SELECT 1 FROM fuel_sales WHERE id='%s' FOR UPDATE; SELECT 1 FROM partners WHERE tenant_id='%s' AND system_kind='fuel_walk_in' FOR UPDATE; "
            .'SELECT pg_sleep(4); COMMIT;',
            $shift->id, $f['station']->id, $f['tenant_id'], $f['warehouse']->id, $f['warehouse']->id, $sale->invoice_id, $sale->id, $f['tenant_id'],
        );
        $holder = $this->startHolder($sql);
        usleep(700000); // يكتسب الممسك كل أقفاله.

        // أي انتظار على قفل يفشل خلال 300ms بدل أن يتأخر صامتاً.
        DB::statement("SET lock_timeout = '300ms'");
        $started = microtime(true);
        $preview = app(FuelShiftSettlementPreviewService::class)->preview($shift->fresh(), $f['actor']);
        $elapsed = microtime(true) - $started;
        DB::statement("SET lock_timeout = '60s'");

        [$err, $exit] = $this->finishHolder($holder);
        $this->assertSame(0, $exit, $err);
        $this->assertTrue($preview['writes_nothing']);
        $this->assertLessThan(3.0, $elapsed, 'المعاينة لا تنتظر الأقفال');
        $this->assertSame(20000, $preview['lines'][0]['metered_milliliters']);
    }

    // ───────── 3) معاينات متزامنة مع بيع/تحصيل/إقرار ─────────

    /** @test */
    public function repeated_previews_race_with_sales_collections_and_declarations_without_deadlock_or_inconsistency(): void
    {
        $this->prepare('race');
        $f = $this->f;
        app(FuelStationWalkInPartnerService::class)->assign($f['station'], $f['actor']);
        $shift = $this->open('race');
        $this->meters($shift);
        $this->declare($shift, 2000);

        $jobs = [
            function () use ($f, $shift) {          // بيع ERP + تحصيل متكرران
                $this->enter($f);
                $done = 0;
                foreach (range(1, 6) as $i) {
                    $actor = User::findOrFail($f['actor']->id);
                    $service = app(FuelSaleService::class);
                    $sale = $service->finalize($service->createDraft([
                        'fuel_station_id' => $f['station']->id, 'fuel_nozzle_id' => $f['nozzle']->id, 'fuel_shift_id' => $shift->id,
                        'partner_id' => $f['customer']->id, 'quantity_milliliters' => 1000, 'idempotency_key' => "race-sale-{$i}",
                    ], $actor), $actor);
                    $service->collectPayment($sale->fresh(), ['payment_method_id' => $f['cash']->id, 'amount_minor' => (int) $sale->invoice->total, 'idempotency_key' => "race-pay-{$i}"], $actor);
                    $done++;
                }

                return $done;
            },
            function () use ($f, $shift) {          // إعادة إقرار التحصيل
                $this->enter($f);
                $revision = 1;
                foreach (range(1, 6) as $i) {
                    app(FuelShiftCollectionService::class)->declare(FuelShift::findOrFail($shift->id), [
                        'idempotency_key' => "race-decl-{$i}", 'base_revision' => $revision,
                        'lines' => [['payment_method_id' => $f['cash']->id, 'amount_minor' => 2000 + $i], ['payment_method_id' => $f['bank']->id, 'amount_minor' => 0]],
                    ], User::findOrFail($f['actor']->id));
                    $revision++;
                }

                return $revision;
            },
        ];
        foreach ([1, 2] as $reader) {
            $jobs[] = function () use ($f, $shift) {   // معاينات متكررة
                $this->enter($f);
                $seen = 0;
                foreach (range(1, 15) as $i) {
                    $p = app(FuelShiftSettlementPreviewService::class)->preview(FuelShift::findOrFail($shift->id), User::findOrFail($f['actor']->id));
                    if ($p['writes_nothing'] !== true || $p['lines'][0]['metered_milliliters'] !== 20000 || ($p['lines'][0]['erp_milliliters'] % 1000) !== 0) {
                        throw new \RuntimeException('معاينة غير متسقة: '.json_encode($p['lines'][0]));
                    }
                    $seen++;
                }

                return $seen;
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(6, $results[0]['value']);
        $final = app(FuelShiftSettlementPreviewService::class)->preview($shift->fresh(), $f['actor']);
        $this->assertSame(6000, $final['lines'][0]['erp_milliliters']);
        $this->assertSame(14000, $final['lines'][0]['residual_milliliters']);
    }

    // ───────── مساعدات ─────────

    private function declare(FuelShift $shift, int $cash): void
    {
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => $shift->id.'-decl', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => $cash], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
        ], $this->f['actor']);
    }

    /** @return array{0: resource, 1: array} */
    private function startHolder(string $sql): array
    {
        $c = config('database.connections.pgsql');
        $proc = proc_open(
            ['psql', '-h', $c['host'], '-p', (string) $c['port'], '-U', $c['username'], '-d', DB::connection()->getDatabaseName(), '-v', 'ON_ERROR_STOP=1', '-c', $sql],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, ['PGPASSWORD' => (string) $c['password']] + getenv(),
        );
        $this->assertIsResource($proc, 'تعذر تشغيل psql');

        return [$proc, $pipes];
    }

    /** @return array{0:string,1:int} */
    private function finishHolder(array $holder): array
    {
        [$proc, $pipes] = $holder;

        return [trim((string) stream_get_contents($pipes[2])), proc_close($proc)];
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
        DB::purge(config('database.default'));
        $out = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $out[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $out;
    }
}
