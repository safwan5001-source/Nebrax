<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelDelivery;
use App\Models\FuelProduct;
use App\Models\FuelReconciliation;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Partner;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Services\FuelReconciliationService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelSupplyReceivingService;
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
 * FUEL-B2 — الاعتماد تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`) مع سياسة فصل المعتمِد:
 *  - عدة معتمِدين متزامنين لسجل واحد ⇒ اعتماد واحد وأثر مخزني/محاسبي/تشغيلي واحد، والباقي رفض واضح (لا جمود).
 *  - المنشئ المتزامن مع غيره لا يفوز أبداً حين تلزم السياسة، ولا يترك أثراً.
 * على PostgreSQL لا يُتخطّى إن غاب `pcntl`؛ يُتخطّى على SQLite فقط.
 */
class FuelApprovalConcurrencyPostgresTest extends TestCase
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
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على الأقفال.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب لاختبارات تزامن PostgreSQL؛ غيابه فشل لا تخطٍّ.');
        $this->dir = sys_get_temp_dir() . '/fuel_approval_' . uniqid();
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
    public function concurrent_approvers_approve_a_delivery_exactly_once_with_one_stock_movement_and_one_entry(): void
    {
        $f = $this->fixture();
        $delivery = $this->draftDelivery($f, 'conc-appr-1');

        $jobs = [];
        foreach ($f['approvers'] as $approverId) {
            $jobs[] = fn () => $this->attempt($f, fn () => app(FuelSupplyReceivingService::class)->approveDelivery(FuelDelivery::findOrFail($delivery->id), $approverId));
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['value'] === 'ok')), json_encode($results));
        $this->assertSame(count($jobs) - 1, count(array_filter($results, fn ($r) => $r['value'] === 'rejected')), json_encode($results));
        $this->assertSame('approved', DB::table('fuel_deliveries')->where('id', $delivery->id)->value('status'));
        $this->assertSame(1, (int) DB::table('stock_movements')->where('tenant_id', $f['tenant_id'])->count());
        $this->assertSame(1, (int) DB::table('journal_entries')->where('tenant_id', $f['tenant_id'])->where('source_type', FuelDelivery::class)->count());
        $this->assertSame(1, (int) DB::table('fuel_operational_ledgers')->where('tenant_id', $f['tenant_id'])->count());
    }

    /** @test */
    public function the_creator_racing_other_approvers_never_wins_when_the_policy_applies(): void
    {
        $f = $this->fixture();
        $delivery = $this->draftDelivery($f, 'conc-appr-2');

        $actors = [$f['creator_id'], $f['creator_id'], $f['creator_id'], ...$f['approvers']];
        $jobs = [];
        foreach ($actors as $actorId) {
            $jobs[] = fn () => $this->attempt($f, fn () => app(FuelSupplyReceivingService::class)->approveDelivery(FuelDelivery::findOrFail($delivery->id), $actorId), $actorId);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $winners = [];
        foreach ($results as $i => $r) {
            if ($r['value'] === 'ok') {
                $winners[] = $actors[$i];
            }
        }
        $this->assertCount(1, $winners, json_encode($results));
        $this->assertNotSame($f['creator_id'], $winners[0], 'المنشئ لا يفوز بالاعتماد');
        $this->assertSame(1, (int) DB::table('stock_movements')->where('tenant_id', $f['tenant_id'])->count());
    }

    /** @test */
    public function only_the_creator_attempting_leaves_the_delivery_draft_with_no_effects(): void
    {
        $f = $this->fixture();
        $delivery = $this->draftDelivery($f, 'conc-appr-3');

        $jobs = [];
        foreach (range(1, 5) as $i) {
            $jobs[] = fn () => $this->attempt($f, fn () => app(FuelSupplyReceivingService::class)->approveDelivery(FuelDelivery::findOrFail($delivery->id), $f['creator_id']), $f['creator_id']);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(5, count(array_filter($results, fn ($r) => $r['value'] === 'sod')), json_encode($results));
        $this->assertSame('draft', DB::table('fuel_deliveries')->where('id', $delivery->id)->value('status'));
        $this->assertSame(0, (int) DB::table('stock_movements')->where('tenant_id', $f['tenant_id'])->count());
        $this->assertSame(0, (int) DB::table('journal_entries')->where('tenant_id', $f['tenant_id'])->where('source_type', FuelDelivery::class)->count());
    }

    /** @test */
    public function concurrent_approvers_approve_a_reconciliation_exactly_once(): void
    {
        $f = $this->fixture();
        $draft = $this->draftReconciliation($f, 'conc-recon-1');

        $jobs = [];
        foreach ($f['approvers'] as $approverId) {
            $jobs[] = fn () => $this->attempt($f, fn () => app(FuelReconciliationService::class)->approve(FuelReconciliation::findOrFail($draft->id), $approverId, null));
        }
        // والمنشئ بينهم: يُرفض بالسياسة.
        $jobs[] = fn () => $this->attempt($f, fn () => app(FuelReconciliationService::class)->approve(FuelReconciliation::findOrFail($draft->id), $f['creator_id'], null), $f['creator_id']);
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['value'] === 'ok')), json_encode($results));
        $this->assertSame('approved', DB::table('fuel_reconciliations')->where('id', $draft->id)->value('status'));
        $this->assertSame(1, (int) DB::table('fuel_operational_ledgers')->where('fuel_reconciliation_id', $draft->id)->count());
        $this->assertNotSame($f['creator_id'], DB::table('fuel_reconciliations')->where('id', $draft->id)->value('approved_by'));
    }

    /**
     * ينفّذ المحاولة داخل العملية الفرعية ويصنّف النتيجة: ok | sod (رفض فصل المعتمِد) | rejected (أي رفض عمل آخر، مثل الحالة غير المسودة).
     *
     * @param array<string,mixed> $f
     */
    private function attempt(array $f, callable $work, ?string $actorId = null): string
    {
        $this->enter($f);
        try {
            $work();

            return 'ok';
        } catch (RuntimeException $e) {
            return str_contains($e->getMessage(), 'FUEL_DISTINCT_APPROVER_REQUIRED') ? 'sod' : 'rejected';
        }
    }

    /** @param array<string,mixed> $f */
    private function draftDelivery(array $f, string $key): FuelDelivery
    {
        $this->enter($f);

        return app(FuelSupplyReceivingService::class)->createDelivery([
            'fuel_station_id' => $f['station_id'], 'fuel_tank_id' => $f['tank_id'], 'fuel_product_id' => $f['fuel_id'],
            'warehouse_id' => $f['warehouse_id'], 'supplier_id' => $f['supplier_id'],
            'dispatched_liters' => '10.000', 'received_liters' => '10.000', 'received_total_cost_minor' => 2345,
            'delivery_note_number' => 'DN-' . $key, 'idempotency_key' => $key, 'created_by' => $f['creator_id'],
        ]);
    }

    /** @param array<string,mixed> $f */
    private function draftReconciliation(array $f, string $key): FuelReconciliation
    {
        $this->enter($f);
        $reading = app(FuelReconciliationService::class)->recordReading([
            'fuel_station_id' => $f['station_id'], 'fuel_tank_id' => $f['tank_id'], 'reading_type' => 'physical',
            'quantity_liters' => '0', 'evidence_key' => $key, 'recorded_by' => $f['creator_id'],
        ]);

        return app(FuelReconciliationService::class)->createDraft([
            'fuel_station_id' => $f['station_id'], 'fuel_tank_id' => $f['tank_id'], 'physical_reading_id' => $reading->id, 'created_by' => $f['creator_id'],
        ]);
    }

    /** @param array<string,mixed> $f */
    private function enter(array $f): void
    {
        app(TenantContext::class)->set($f['tenant_id']);
        app(BranchContext::class)->set($f['branch_id']);
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-appr-pg-' . Str::random(6), 'owner-' . Str::random(6) . '@fuel-appr-pg.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        $this->tenants[] = $tenantId;
        app(TenantContext::class)->set($tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_b2_pg', reason: 'اختبار تزامن الاعتماد B2.',
        );
        $branch = Branch::where('tenant_id', $tenantId)->where('is_main', true)->firstOrFail();
        app(BranchContext::class)->set($branch->id);
        $warehouse = Warehouse::where('tenant_id', $tenantId)->where('is_default', true)->firstOrFail();

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود اعتماد mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-APPR-PG', 'name' => 'محطة اعتماد']);
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-APPR-PG', 'name' => 'وقود اعتماد']);
        $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-APPR-PG', 'name' => 'خزان اعتماد', 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000]);
        $supplier = Partner::create(['branch_id' => $branch->id, 'type' => 'supplier', 'name' => 'مورد اعتماد', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI اعتماد', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        $this->withToken($auth['token'])->putJson(self::BASE . '/settings', ['grni_account_id' => $grni->id, 'reason' => 'GRNI لاختبار التزامن'])->assertOk();
        // السياسة مفعَّلة بقرار صريح على المحطة (مستقل عن حدّ التفعيل).
        app(FuelStationSettingsService::class)->putStation($station, 'fuel_distinct_approver_required', true);

        $mk = fn (string $n) => User::create(['tenant_id' => $tenantId, 'name' => $n, 'email' => "{$n}-" . Str::random(5) . '@fuel-appr-pg.test', 'password' => 'password123', 'role' => 'staff'])->id;

        return [
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id,
            'station_id' => $station->id, 'tank_id' => $tank->id, 'fuel_id' => $fuel->id, 'supplier_id' => $supplier->id,
            'creator_id' => $mk('creator'), 'approvers' => [$mk('approver1'), $mk('approver2'), $mk('approver3'), $mk('approver4')],
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
