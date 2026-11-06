<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Partner;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
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
 * FUEL-B1 / FS-16 — تعارض التزامن على مفاتيح idempotency للاستلام وفاتورة المورد والمطابقة (PostgreSQL + `pcntl_fork`).
 * الفائز واحد؛ الخاسر المتطابق الحمولة يُعيد الفائز، والمختلف الحمولة يُرفض بوضوح — لا 500 من الفهرس الفريد ولا أثر مزدوج.
 * على PostgreSQL لا يُتخطّى إن غاب `pcntl`؛ يُتخطّى على SQLite فقط.
 */
class FuelReceivingPostgresConcurrencyTest extends TestCase
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
        $this->dir = sys_get_temp_dir() . '/fuel_receiving_' . uniqid();
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
    public function concurrent_identical_delivery_posts_yield_one_draft_and_all_callers_get_it(): void
    {
        $f = $this->fixture();

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($f) {
                $this->enter($f);

                return app(FuelSupplyReceivingService::class)->createDelivery($this->deliveryData($f, 'conc-dlv-same', 2345) + ['created_by' => $f['actor_id']])->id;
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertCount(1, array_unique(array_map(fn ($r) => $r['value'], $results)));
        $this->assertSame(1, (int) DB::table('fuel_deliveries')->where('tenant_id', $f['tenant_id'])->count());
    }

    /** @test */
    public function concurrent_delivery_posts_with_different_content_yield_one_winner_and_clear_rejections(): void
    {
        $f = $this->fixture();

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($f, $i) {
                $this->enter($f);
                try {
                    app(FuelSupplyReceivingService::class)->createDelivery($this->deliveryData($f, 'conc-dlv-diff', 1000 + $i) + ['created_by' => $f['actor_id']]);

                    return 'ok';
                } catch (RuntimeException $e) {
                    return str_contains($e->getMessage(), 'FUEL_IDEMPOTENCY_PAYLOAD_MISMATCH') ? 'mismatch' : 'other:' . $e->getMessage();
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['value'] === 'ok')), json_encode($results));
        $this->assertSame(5, count(array_filter($results, fn ($r) => $r['value'] === 'mismatch')), json_encode($results));
        $this->assertSame(1, (int) DB::table('fuel_deliveries')->where('tenant_id', $f['tenant_id'])->count());
    }

    /** @test */
    public function concurrent_identical_supplier_invoice_posts_yield_one_invoice_with_its_lines_once(): void
    {
        $f = $this->fixture();

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($f) {
                $this->enter($f);

                return app(FuelSupplyReceivingService::class)->createSupplierInvoice($this->invoiceData($f, 'CONC-INV-1') + ['created_by' => $f['actor_id']])->id;
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertCount(1, array_unique(array_map(fn ($r) => $r['value'], $results)));
        $this->assertSame(1, (int) DB::table('fuel_supplier_invoices')->where('tenant_id', $f['tenant_id'])->count());
        $this->assertSame(1, (int) DB::table('fuel_supplier_invoice_lines')->where('tenant_id', $f['tenant_id'])->count());
    }

    /** @test */
    public function one_match_key_raced_across_two_invoices_creates_one_match_one_entry_and_no_double_counting(): void
    {
        $f = $this->fixture();
        $service = app(FuelSupplyReceivingService::class);
        $delivery = $service->createDelivery($this->deliveryData($f, 'conc-match-delivery', 2345) + ['created_by' => $f['actor_id']]);
        $service->approveDelivery($delivery, $f['actor_id']);
        $invoiceOne = $service->createSupplierInvoice($this->invoiceData($f, 'CONC-INV-A') + ['created_by' => $f['actor_id']]);
        $invoiceTwo = $service->createSupplierInvoice($this->invoiceData($f, 'CONC-INV-B') + ['created_by' => $f['actor_id']]);
        $entriesBefore = (int) DB::table('journal_entries')->where('tenant_id', $f['tenant_id'])->count();

        $jobs = [];
        $jobInvoices = [$invoiceOne->id, $invoiceOne->id, $invoiceOne->id, $invoiceTwo->id, $invoiceTwo->id, $invoiceTwo->id];
        foreach ([$invoiceOne, $invoiceOne, $invoiceOne, $invoiceTwo, $invoiceTwo, $invoiceTwo] as $invoice) {
            $jobs[] = function () use ($f, $invoice, $delivery) {
                $this->enter($f);
                try {
                    return 'ok:' . app(FuelSupplyReceivingService::class)->matchSupplierInvoiceLine(
                        \App\Models\FuelSupplierInvoice::findOrFail($invoice->id),
                        [
                            'fuel_supplier_invoice_line_id' => \App\Models\FuelSupplierInvoiceLine::where('fuel_supplier_invoice_id', $invoice->id)->firstOrFail()->id,
                            'fuel_delivery_id' => $delivery->id,
                            'quantity_liters' => '5.000',
                            'idempotency_key' => 'conc-shared-match',
                        ],
                        $f['actor_id'],
                    )->id;
                } catch (RuntimeException $e) {
                    return str_contains($e->getMessage(), 'FUEL_IDEMPOTENCY_PAYLOAD_MISMATCH') ? 'mismatch' : 'other:' . $e->getMessage();
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $values = array_map(fn ($r) => $r['value'], $results);
        $this->assertSame([], array_filter($values, fn ($v) => str_starts_with($v, 'other:')), json_encode($results));
        $this->assertCount(1, array_unique(array_filter($values, fn ($v) => str_starts_with($v, 'ok:'))), json_encode($results));
        $this->assertSame(1, (int) DB::table('fuel_supplier_invoice_matches')->where('tenant_id', $f['tenant_id'])->count());
        // الخاسرة الفاتورة الأخرى: تُرفض كلها بوضوح ولا يُردّ لها صفّ مطابقة فاتورة غيرها بصمت.
        $winnerInvoice = DB::table('fuel_supplier_invoice_matches')->where('tenant_id', $f['tenant_id'])->value('fuel_supplier_invoice_id');
        foreach ($values as $index => $value) {
            if ($jobInvoices[$index] === $winnerInvoice) {
                $this->assertStringStartsWith('ok:', $value, json_encode($results));
            } else {
                $this->assertSame('mismatch', $value, json_encode($results));
            }
        }
        $this->assertSame($entriesBefore + 1, (int) DB::table('journal_entries')->where('tenant_id', $f['tenant_id'])->count());
        $this->assertSame(5000, (int) DB::table('fuel_supplier_invoices')->where('tenant_id', $f['tenant_id'])->sum('matched_quantity_milliliters'));
        $this->assertSame(5000, (int) DB::table('fuel_supplier_invoice_lines')->where('tenant_id', $f['tenant_id'])->sum('matched_quantity_milliliters'));
    }

    /** @param array<string,string> $f */
    private function enter(array $f): void
    {
        app(TenantContext::class)->set($f['tenant_id']);
        app(BranchContext::class)->set($f['branch_id']);
    }

    /** @param array<string,string> $f @return array<string,mixed> */
    private function deliveryData(array $f, string $key, int $cost): array
    {
        return [
            'fuel_station_id' => $f['station_id'], 'fuel_tank_id' => $f['tank_id'], 'fuel_product_id' => $f['fuel_id'],
            'warehouse_id' => $f['warehouse_id'], 'supplier_id' => $f['supplier_id'],
            'dispatched_liters' => '10.000', 'received_liters' => '10.000', 'received_total_cost_minor' => $cost,
            'delivery_note_number' => 'DN-' . $key . '-' . $cost, 'idempotency_key' => $key,
        ];
    }

    /** @param array<string,string> $f @return array<string,mixed> */
    private function invoiceData(array $f, string $number): array
    {
        return [
            'supplier_id' => $f['supplier_id'], 'invoice_number' => $number, 'invoice_date' => '2026-08-23', 'currency' => 'SAR',
            'lines' => [['fuel_product_id' => $f['fuel_id'], 'quantity_liters' => '10.000', 'value_minor' => 2345]],
        ];
    }

    /** @return array<string,string> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-rcv-pg-' . Str::random(6), 'owner-' . Str::random(6) . '@fuel-rcv-pg.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        $this->tenants[] = $tenantId;
        app(TenantContext::class)->set($tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_b1_pg', reason: 'اختبار تزامن الاستلام B1.',
        );
        $branch = Branch::where('tenant_id', $tenantId)->where('is_main', true)->firstOrFail();
        app(BranchContext::class)->set($branch->id);
        $warehouse = Warehouse::where('tenant_id', $tenantId)->where('is_default', true)->firstOrFail();
        $actor = User::where('tenant_id', $tenantId)->where('role', 'owner')->sole();

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود تزامن mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-RCV-PG', 'name' => 'محطة تزامن الاستلام']);
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-RCV-PG', 'name' => 'وقود تزامن']);
        $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-RCV-PG', 'name' => 'خزان تزامن', 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000]);
        $supplier = Partner::create(['branch_id' => $branch->id, 'type' => 'supplier', 'name' => 'مورد تزامن', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI تزامن', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        $this->withToken($auth['token'])->putJson(self::BASE . '/settings', ['grni_account_id' => $grni->id, 'reason' => 'GRNI لاختبار التزامن'])->assertOk();

        return [
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'actor_id' => $actor->id, 'warehouse_id' => $warehouse->id,
            'station_id' => $station->id, 'tank_id' => $tank->id, 'fuel_id' => $fuel->id, 'supplier_id' => $supplier->id,
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
