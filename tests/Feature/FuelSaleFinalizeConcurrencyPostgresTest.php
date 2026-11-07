<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelSale;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Services\FuelSaleService;
use App\Services\FuelShiftService;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelSupplyReceivingService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * P0 (Tank Level) — اعتماد بيع الوقود تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`).
 *
 * يكمل `FuelApprovalConcurrencyPostgresTest` (الذي يغطي الاستلام والتسوية فقط) ويثبت للبيع:
 *  - اعتماد البيع نفسه من عدة عمليات متزامنة ⇒ خصم واحد: حركة مخزون واحدة وصف دفتر واحد وفاتورة واحدة وقيد COGS واحد.
 *  - بيعان يتجاوز مجموعهما الرصيد ⇒ يُعتمد أحدهما فقط ولا يهبط الرصيد تحت صفر ولا يبقى أثر للمرفوض.
 *  - مسودات متزامنة بمفتاح تكرار واحد ⇒ بيع واحد.
 * يُتخطّى على SQLite فقط؛ على PostgreSQL غياب `pcntl` فشل لا تخطٍّ. لا جمود (40P01) مقبول في أي حالة.
 */
class FuelSaleFinalizeConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

    private const DELIVERED_ML = 10000;

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
        $this->dir = sys_get_temp_dir() . '/fuel_sale_conc_' . uniqid();
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

    #[Test]
    public function concurrent_finalizations_of_the_same_sale_deduct_exactly_once(): void
    {
        $f = $this->fixture();
        $sale = $this->draft($f, 'conc-same-1', 3000);

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = fn () => $this->attempt($f, fn () => app(FuelSaleService::class)->finalize(FuelSale::findOrFail($sale->id), $f['actor'])->id);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        // كل المستدعين ينتهون بالبيع المعتمد نفسه (المتأخر يرى الحالة النهائية بعد القفل ويعيده)، لا رفض ولا خطأ.
        foreach ($results as $i => $r) {
            $this->assertSame($sale->id, $r['value'], "العملية {$i}: " . json_encode($r));
        }

        $this->assertSame('finalized', DB::table('fuel_sales')->where('id', $sale->id)->value('status'));
        $this->assertSame(1, (int) DB::table('stock_movements')->where('tenant_id', $f['tenant_id'])->where('source_type', FuelSale::class)->count());
        $this->assertSame(1, (int) DB::table('fuel_operational_ledgers')->where('tenant_id', $f['tenant_id'])->where('source_type', FuelSale::class)->where('source_id', $sale->id)->count());
        $this->assertSame(1, (int) DB::table('invoices')->where('tenant_id', $f['tenant_id'])->count());
        $cogs = DB::table('fuel_sales')->where('id', $sale->id)->value('cogs_journal_entry_id');
        $this->assertNotNull($cogs);
        $this->assertSame(1, (int) DB::table('journal_entries')->where('id', $cogs)->count());
        $this->assertSame(self::DELIVERED_ML - 3000, $this->pool($f));
        // الدفتر يتّسق مع الرصيد الرسمي: +10000 استلام −3000 بيع.
        $this->assertSame($this->pool($f), (int) DB::table('fuel_operational_ledgers')->where('tenant_id', $f['tenant_id'])->sum('quantity_milliliters'));
        $this->assertSame(-3000, (int) DB::table('fuel_operational_ledgers')->where('source_id', $sale->id)->value('quantity_milliliters'));
    }

    #[Test]
    public function two_sales_that_together_exceed_the_balance_never_oversell_and_the_loser_leaves_no_trace(): void
    {
        $f = $this->fixture();
        $a = $this->draft($f, 'conc-over-a', 6000);
        $b = $this->draft($f, 'conc-over-b', 6000); // 6000 + 6000 > 10000

        // كل بيع من عمليتين متزامنتين: ضغط أعلى على قفل المجمّع نفسه.
        $jobs = [];
        foreach ([$a, $b, $a, $b] as $sale) {
            $jobs[] = fn () => $this->attempt($f, fn () => app(FuelSaleService::class)->finalize(FuelSale::findOrFail($sale->id), $f['actor'])->id);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $finalized = DB::table('fuel_sales')->where('tenant_id', $f['tenant_id'])->where('status', 'finalized')->pluck('id')->all();
        $this->assertCount(1, $finalized, 'يُعتمد بيع واحد فقط: ' . json_encode($results));
        $winner = $finalized[0];
        $loser = $winner === $a->id ? $b->id : $a->id;

        $this->assertSame('draft', DB::table('fuel_sales')->where('id', $loser)->value('status'));
        $this->assertSame(self::DELIVERED_ML - 6000, $this->pool($f), 'الرصيد لم يهبط تحت صفر ولم يُخصم مرتين');
        $this->assertSame(1, (int) DB::table('stock_movements')->where('tenant_id', $f['tenant_id'])->where('source_type', FuelSale::class)->count());
        $this->assertSame(1, (int) DB::table('fuel_operational_ledgers')->where('tenant_id', $f['tenant_id'])->where('source_type', FuelSale::class)->count());
        $this->assertSame(0, (int) DB::table('fuel_operational_ledgers')->where('source_type', FuelSale::class)->where('source_id', $loser)->count());
        $this->assertSame(1, (int) DB::table('invoices')->where('tenant_id', $f['tenant_id'])->count());
        $this->assertNull(DB::table('fuel_sales')->where('id', $loser)->value('invoice_id'));
        // كل عملية على الفائز أعادته، وكل عملية على الخاسر رُفضت.
        foreach ([$a, $b, $a, $b] as $i => $sale) {
            $this->assertSame($sale->id === $winner ? $winner : 'rejected', $results[$i]['value'], "العملية {$i}: " . json_encode($results[$i]));
        }
    }

    #[Test]
    public function concurrent_drafts_with_one_idempotency_key_create_a_single_sale_and_touch_nothing(): void
    {
        $f = $this->fixture();
        $before = $this->effects($f);

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = fn () => $this->attempt($f, fn () => $this->draft($f, 'conc-key-1', 2000)->id);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $ids = array_values(array_unique(array_map(fn ($r) => $r['value'], $results)));
        $this->assertCount(1, $ids, json_encode($results));
        $this->assertSame(1, (int) DB::table('fuel_sales')->where('tenant_id', $f['tenant_id'])->where('idempotency_key', 'conc-key-1')->count());
        $this->assertSame($before, $this->effects($f), 'المسودات لا تمس الرصيد ولا الدفتر ولا الفواتير');
    }

    // ───────────────────────── أدوات ─────────────────────────

    /** @param array<string,mixed> $f @return array<string,int> */
    private function effects(array $f): array
    {
        return [
            'pool' => $this->pool($f),
            'stock_movements' => (int) DB::table('stock_movements')->where('tenant_id', $f['tenant_id'])->count(),
            'ledger' => (int) DB::table('fuel_operational_ledgers')->where('tenant_id', $f['tenant_id'])->count(),
            'invoices' => (int) DB::table('invoices')->where('tenant_id', $f['tenant_id'])->count(),
            'journal_entries' => (int) DB::table('journal_entries')->where('tenant_id', $f['tenant_id'])->count(),
        ];
    }

    /** @param array<string,mixed> $f */
    private function pool(array $f): int
    {
        return (int) (DB::table('product_warehouse_stock')->where('warehouse_id', $f['warehouse_id'])->where('product_id', $f['product_id'])->value('quantity') ?? 0);
    }

    /**
     * ok ⇒ القيمة المُرجَعة (معرّف) | rejected ⇒ أي رفض عمل (RuntimeException، مثل نقص الرصيد). غيرها (جمود/خطأ قاعدة) يُفشل assertAllCompleted.
     *
     * @param array<string,mixed> $f
     */
    private function attempt(array $f, callable $work): mixed
    {
        $this->enter($f);
        try {
            return $work();
        } catch (RuntimeException) {
            return 'rejected';
        }
    }

    /** @param array<string,mixed> $f */
    private function draft(array $f, string $key, int $milliliters): FuelSale
    {
        $this->enter($f);

        return app(FuelSaleService::class)->createDraft([
            'fuel_station_id' => $f['station_id'], 'fuel_nozzle_id' => $f['nozzle_id'], 'fuel_shift_id' => $f['shift_id'],
            'partner_id' => $f['customer_id'], 'quantity_milliliters' => $milliliters, 'idempotency_key' => $key,
        ], $f['actor']);
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
        $slug = 'fuel-sale-pg-' . Str::lower(Str::random(6));
        $auth = $this->registerTenant($slug, "owner-{$slug}@fuel-sale-pg.test");
        $tenantId = $auth['tenant_id'];
        $this->tenants[] = $tenantId;
        app(TenantContext::class)->set($tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_sale_pg', reason: 'اختبار تزامن اعتماد بيع الوقود.',
        );
        Tenant::findOrFail($tenantId)->update(['country' => 'SA']);
        $branch = Branch::where('tenant_id', $tenantId)->where('is_main', true)->firstOrFail();
        app(BranchContext::class)->set($branch->id);
        $warehouse = Warehouse::where('tenant_id', $tenantId)->where('is_default', true)->firstOrFail();
        $actor = User::where('tenant_id', $tenantId)->where('role', 'owner')->firstOrFail();

        $customer = Partner::create(['branch_id' => $branch->id, 'type' => 'customer', 'name' => 'عميل تزامن البيع']);
        $supplier = Partner::create(['branch_id' => $branch->id, 'type' => 'supplier', 'name' => 'مورد تزامن البيع', 'is_active' => true]);
        $product = Product::create(['branch_id' => $branch->id, 'sku' => 'FSP-' . $slug, 'name' => 'وقود تزامن', 'unit' => 'mL', 'track_inventory' => true]);
        $fuel = FuelProduct::create(['product_id' => $product->id, 'code' => 'FSP-' . $slug, 'name' => 'بنزين تزامن']);
        $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FSS-' . $slug, 'name' => 'محطة تزامن البيع']);
        $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'FST-' . $slug, 'name' => 'خزان تزامن', 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000]);
        $pump = FuelPump::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => 'FSM-' . $slug]);
        $nozzle = FuelNozzle::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'nozzle_number' => 'FSN-' . $slug]);

        $grni = Account::create(['code' => '2199', 'name' => 'GRNI تزامن البيع', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        app(FuelStationSettingsService::class)->putTenant(['grni_account_id' => $grni->id], $actor, 'GRNI لاختبار تزامن البيع');
        app(FuelStationProductPriceService::class)->create([
            'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'price_per_liter_minor' => 230,
            'effective_from' => now()->subMinute()->toIso8601String(), 'reason' => 'سعر اختبار تزامن البيع',
        ], $actor);

        // رصيد حقيقي عبر مسار الاستلام المعتمد (يكتب المخزون والدفتر معاً)، ثم وردية مفتوحة يشترطها اعتماد البيع.
        $receiving = app(FuelSupplyReceivingService::class);
        $delivery = $receiving->createDelivery([
            'fuel_station_id' => $station->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'warehouse_id' => $warehouse->id, 'supplier_id' => $supplier->id,
            'dispatched_liters' => '10.000', 'received_liters' => '10.000', 'received_total_cost_minor' => 2345,
            'delivery_note_number' => 'DN-' . $slug, 'idempotency_key' => 'seed-' . $slug, 'received_at' => '2026-08-23 10:00:00', 'created_by' => $actor->id,
        ]);
        $receiving->approveDelivery($delivery, $actor->id);
        $shift = app(FuelShiftService::class)->open(['fuel_station_id' => $station->id, 'opening_float_minor' => 0, 'idempotency_key' => 'shift-' . $slug], $actor);

        return [
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'product_id' => $product->id,
            'station_id' => $station->id, 'nozzle_id' => $nozzle->id, 'customer_id' => $customer->id, 'shift_id' => $shift->id, 'actor' => $actor,
        ];
    }

    private function assertAllCompleted(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: " . ($result['error_class'] ?? '') . ' ' . ($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
        }
    }

    /** @param list<callable> $jobs @return array<int, array<string, mixed>> */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir . '/barrier_' . uniqid();
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir . '/result_' . uniqid() . "_{$i}";
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
