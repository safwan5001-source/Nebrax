<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FuelDelivery;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelReconciliation;
use App\Models\FuelSale;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerOwner;
use App\Models\Partner;
use App\Models\User;
use App\Services\FuelInventoryLedgerReconciliation as Recon;
use App\Services\FuelOpeningBalanceService;
use App\Services\FuelReconciliationService;
use App\Services\FuelSaleService;
use App\Services\FuelShiftService;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelSupplyReceivingService;
use App\Services\FuelTankerFillException;
use App\Services\FuelTankerFillInventoryPostingService;
use App\Services\FuelTankerFillInventoryReversalService;
use App\Services\FuelTankerFillService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * TANKER-PR6B-4 — عكس ترحيل سند التعبئة تحت تزامن حقيقي على PostgreSQL (`pcntl_fork` وجلسات `psql` ممسِكة): لا جمود (40P01) ولا عكس مزدوج ولا «ملغى + مرحَّل» ولا فقد في الاتساق
 * (الرصيد الرسمي = كمية مجمّع التكلفة = الدفتر التشغيلي، والمجمّع متطابق مع الأستاذ بعد التزاحم). المنافسون الحقيقيون: عكوس متوازية للسند نفسه، عكس ⇆ إلغاء، عكس ⇆ ترحيل، وعكس ⇆
 * (إنهاء بيع ERP واعتماد استلام واعتماد تسوية خزان)، وجلسة `psql` بترتيب ERP (مِرساة المستأجر ← صف الرصيد/المنتج) يجب أن ينتظرها العكس ولا يمسك المجمّع قبلها. يُتخطّى على SQLite.
 */
class FuelTankerFillInventoryReversalConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;
    use BuildsFuelOpeningWorld;

    private string $dir = '';
    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب؛ غيابه فشل لا تخطٍّ.');
        config(['fuel_stations.tanker_management_enabled' => true, 'fuel_stations.tanker_fills_enabled' => true, 'fuel_stations.tanker_inventory_posting_enabled' => true]);
        $this->dir = sys_get_temp_dir().'/fuel_tanker_rev_'.uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if ($this->dir !== '') {
            foreach (glob($this->dir.'/*') ?: [] as $file) {
                @unlink($file);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->cleanupOpeningTenants();
        }
        parent::tearDown();
    }

    /** @return array<string,mixed> */
    private function world(): array
    {
        $w = $this->openingWorld();
        $this->enter($w);
        $w['supplier'] = Partner::create(['branch_id' => $w['branch']->id, 'type' => 'supplier', 'name' => 'مورد ترحيل الصهاريج', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI ترحيل الصهاريج', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        $clearing = Account::create(['code' => '1145', 'name' => 'وسيط وقود مصروف لصهاريج', 'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true]);
        $settings = app(FuelStationSettingsService::class);
        $settings->putTenant([
            'grni_account_id' => $grni->id, 'tanker_issue_clearing_account_id' => $clearing->id,
            'tanker_inventory_posting_start_at' => now()->subDay()->utc()->format('Y-m-d\TH:i:s\Z'),
        ], $w['actor'], 'إعداد اختبار ترحيل الصهاريج');

        $doc = app(FuelOpeningBalanceService::class)->createDraft($this->openingPayload($w), $w['actor'])['document'];
        app(FuelOpeningBalanceService::class)->post($doc, $w['actor']);

        $pump = FuelPump::create(['branch_id' => $w['branch']->id, 'fuel_station_id' => $w['station']->id, 'pump_number' => 'TP-P1']);
        $w['nozzle'] = FuelNozzle::create([
            'branch_id' => $w['branch']->id, 'fuel_station_id' => $w['station']->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $w['tanks']['91']->id, 'fuel_product_id' => $w['fuels']['91']->id, 'nozzle_number' => 'TP-N1',
        ]);
        app(FuelStationProductPriceService::class)->create([
            'fuel_station_id' => $w['station']->id, 'fuel_product_id' => $w['fuels']['91']->id, 'price_per_liter_minor' => 230,
            'effective_from' => now()->subMinute()->toIso8601String(), 'reason' => 'سعر اختبار',
        ], $w['actor']);
        $settings->putStationValues($w['station'], [
            'shift_opening_meter_reading_required' => false, 'shift_closing_meter_reading_required' => false,
            'shift_opening_tank_reading_required' => false, 'shift_closing_tank_reading_required' => false,
            'shift_mandatory_staff_assignment' => false, 'fuel_sales_allow_deferred_payment' => false,
        ], $w['actor'], 'تهيئة اختبار ترحيل الصهاريج');
        $w['customer'] = Partner::create(['branch_id' => $w['branch']->id, 'type' => 'customer', 'name' => 'عميل ترحيل الصهاريج']);
        $w['shift'] = app(FuelShiftService::class)->open(['fuel_station_id' => $w['station']->id, 'opening_float_minor' => 0, 'idempotency_key' => 'tp-shift-'.$w['slug']], $w['actor']);
        $w['tanker_owner'] = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active']);

        return $w;
    }

    /** @param array<string,mixed> $w */
    private function enter(array $w): void
    {
        app(TenantContext::class)->set($w['tenant_id']);
        app(BranchContext::class)->set($w['branch']->id);
    }

    /** @param array<string,mixed> $w */
    private function fill(array $w, int $milliliters = 1_000_000): FuelTankerFill
    {
        $this->enter($w);
        $n = ++$this->seq;

        return app(FuelTankerFillService::class)->record([
            'fuel_station_id' => $w['station']->id, 'fuel_nozzle_id' => $w['nozzle']->id, 'fuel_tanker_owner_id' => $w['tanker_owner']->id,
            'quantity_milliliters' => $milliliters, 'voucher_number' => "TP-{$n}", 'idempotency_key' => "tp-fill-{$n}",
        ], User::findOrFail($w['actor']->id))['fill'];
    }

    /** @param array<string,mixed> $w */
    private function postFill(array $w, string $fillId): string
    {
        $this->enter($w);
        try {
            $result = app(FuelTankerFillInventoryPostingService::class)->post(FuelTankerFill::query()->withoutGlobalScopes()->findOrFail($fillId), User::findOrFail($w['actor']->id));

            return $result['replayed'] ? 'replayed' : 'posted';
        } catch (FuelTankerFillException $e) {
            return 'rejected:'.$e->reason.($e->details === [] ? '' : ' '.json_encode($e->details));
        }
    }

    /** @param array<string,mixed> $w */
    private function voidFill(array $w, string $fillId): string
    {
        $this->enter($w);
        try {
            app(FuelTankerFillService::class)->void(FuelTankerFill::query()->withoutGlobalScopes()->findOrFail($fillId), 'سباق ترحيل', User::findOrFail($w['actor']->id));

            return 'voided';
        } catch (FuelTankerFillException $e) {
            return 'rejected:'.$e->reason;
        }
    }

    /** @param array<string,mixed> $w */
    private function draftSale(array $w, string $key): FuelSale
    {
        return app(FuelSaleService::class)->createDraft([
            'fuel_station_id' => $w['station']->id, 'fuel_nozzle_id' => $w['nozzle']->id, 'fuel_shift_id' => $w['shift']->id,
            'partner_id' => $w['customer']->id, 'quantity_milliliters' => 1000, 'idempotency_key' => $key,
        ], $w['actor']);
    }

    /** @param array<string,mixed> $w */
    private function draftDelivery(array $w, string $key): FuelDelivery
    {
        return app(FuelSupplyReceivingService::class)->createDelivery([
            'fuel_station_id' => $w['station']->id, 'fuel_tank_id' => $w['tanks']['91']->id, 'fuel_product_id' => $w['fuels']['91']->id,
            'warehouse_id' => $w['warehouse']->id, 'supplier_id' => $w['supplier']->id, 'dispatched_liters' => '10.000', 'received_liters' => '10.000',
            'received_total_cost_minor' => 2345, 'delivery_note_number' => 'DN-'.$key, 'idempotency_key' => $key,
            'received_at' => now()->toDateTimeString(), 'created_by' => $w['actor']->id,
        ]);
    }

    private function liters(int $milliliters): string
    {
        return intdiv($milliliters, 1000).'.'.str_pad((string) ($milliliters % 1000), 3, '0', STR_PAD_LEFT);
    }

    /** @param array<string,mixed> $w */
    private function draftReconciliation(array $w, string $key): FuelReconciliation
    {
        $service = app(FuelReconciliationService::class);
        $book = $this->stock91($w);
        $reading = $service->recordReading([
            'fuel_station_id' => $w['station']->id, 'fuel_tank_id' => $w['tanks']['91']->id, 'reading_type' => 'physical',
            'quantity_liters' => $this->liters($book - 1), 'evidence_key' => 'tp-'.$key, 'recorded_by' => $w['actor']->id,
        ]);

        return $service->createDraft([
            'fuel_station_id' => $w['station']->id, 'fuel_tank_id' => $w['tanks']['91']->id, 'physical_reading_id' => $reading->id,
            'created_by' => $w['actor']->id, 'reason' => 'فقد اختبار ترحيل الصهاريج',
        ]);
    }

    /** @param array<string,mixed> $w */
    private function stock91(array $w): int
    {
        return (int) DB::table('product_warehouse_stock')->where('warehouse_id', $w['warehouse']->id)->where('product_id', $w['fuels']['91']->product_id)->value('quantity');
    }

    /** الاتساق الثابت: الرصيد = كمية المجمّع = الدفتر التشغيلي، والمجمّع متطابق مع الأستاذ، ولا رصيد سالب. @param array<string,mixed> $w */
    private function assertConsistent(array $w, string $label = ''): void
    {
        $stock = $this->stock91($w);
        $cost = (int) DB::table('fuel_inventory_cost_states')->where('warehouse_id', $w['warehouse']->id)->where('fuel_product_id', $w['fuels']['91']->id)->value('quantity_milliliters');
        $ledger = (int) DB::table('fuel_operational_ledgers')->where('warehouse_id', $w['warehouse']->id)->where('fuel_product_id', $w['fuels']['91']->id)->sum('quantity_milliliters');
        $this->assertGreaterThanOrEqual(0, $stock, "{$label}: لا رصيد سالب");
        $this->assertSame($stock, $cost, "{$label}: حالة التكلفة = الرصيد الرسمي");
        $this->assertSame($stock, $ledger, "{$label}: الدفتر التشغيلي = الرصيد الرسمي");
        $this->enter($w);
        $report = app(Recon::class)->reconcile(null, null, true, true);
        // لا أخطاء ولا فروق قيمة. التحذير الوحيد المقبول `movements_without_journal` من حركات **صفرية القيمة** (فقد 1 مل ≈ 0.218 هللة لا قيد له) — يُتحقق من أنها صفرية فعلاً.
        $errors = array_filter($report['findings'], fn (array $f) => $f['severity'] === 'error');
        $this->assertSame([], array_values($errors), "{$label}: ".json_encode($report['findings']));
        $this->assertSame([], array_values(array_diff(array_column($report['findings'], 'code'), [Recon::F_MOVEMENTS_WITHOUT_JOURNAL])), "{$label}: ".json_encode($report['findings']));
        $this->assertSame(0, (int) DB::table('fuel_inventory_cost_movements')->where('tenant_id', $w['tenant_id'])->whereNull('journal_entry_id')->where('posted_cost_minor', '<>', 0)->count(), "{$label}: حركة بقيمة بلا قيد");
        $this->assertSame($report['value']['total']['pool_value_minor'], $report['value']['total']['ledger_share_minor'], "{$label}: قيمة المجمّع = حصة الأستاذ");
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

    /** ترتيب ERP الفعلي: مِرساة المستأجر ← (نوم) ← رصيد المخزن ← حالة التكلفة. @param array<string,mixed> $w */
    private function erpOrderSql(array $w, float $sleep = 1.5): string
    {
        return sprintf(
            "BEGIN; SELECT 1 FROM tenants WHERE id='%s' FOR UPDATE; SELECT pg_sleep(%s); SELECT 1 FROM product_warehouse_stock WHERE warehouse_id='%s' FOR UPDATE; "
            ."SELECT 1 FROM fuel_inventory_cost_states WHERE warehouse_id='%s' FOR UPDATE; COMMIT;",
            $w['tenant_id'], $sleep, $w['warehouse']->id, $w['warehouse']->id,
        );
    }

    /** ترتيب بيع ERP الذي يمسك المِرساة ثم يحتاج KEY SHARE على صف المنتج (FK حركة المخزون). @param array<string,mixed> $w */
    private function erpProductKeyShareSql(array $w, float $sleep = 1.5): string
    {
        return sprintf(
            "BEGIN; SELECT 1 FROM tenants WHERE id='%s' FOR UPDATE; SELECT pg_sleep(%s); SELECT 1 FROM products WHERE id='%s' FOR KEY SHARE; COMMIT;",
            $w['tenant_id'], $sleep, $w['fuels']['91']->product_id,
        );
    }

    /** @param array<string,mixed> $w */
    private function attempt(array $w, callable $work): mixed
    {
        $this->enter($w);
        try {
            return $work();
        } catch (\PDOException $e) {
            throw $e;
        } catch (\Illuminate\Database\QueryException $e) {
            throw $e;
        } catch (\RuntimeException $e) {
            return 'rejected: '.$e->getMessage();
        }
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

    /** @param array<string,mixed> $w */
    private function reverseFill(array $w, string $fillId, string $reason = 'سباق عكس'): string
    {
        $this->enter($w);
        try {
            $result = app(FuelTankerFillInventoryReversalService::class)->reverse(FuelTankerFill::query()->withoutGlobalScopes()->findOrFail($fillId), User::findOrFail($w['actor']->id), ['reason' => $reason]);

            return $result['replayed'] ? 'replayed' : 'reversed';
        } catch (FuelTankerFillException $e) {
            return 'rejected:'.$e->reason.($e->details === [] ? '' : ' '.json_encode($e->details));
        }
    }

    /** @param array<string,mixed> $w */
    private function postedFill(array $w, int $milliliters = 1_000_000): FuelTankerFill
    {
        $fill = $this->fill($w, $milliliters);
        $this->assertSame('posted', $this->postFill($w, $fill->id));

        return $fill;
    }

    #[Test]
    public function the_same_fill_reversed_by_many_processes_restores_once_and_the_rest_replay(): void
    {
        $w = $this->world();
        $fill = $this->postedFill($w, 3_000_000);
        $this->assertSame(27_000_000, $this->stock91($w));
        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = fn () => $this->reverseFill($w, $fill->id);
        }
        $results = $this->runConcurrently($jobs);
        $this->assertAllCompleted($results);

        $values = array_column($results, 'value');
        $this->assertSame(1, count(array_filter($values, fn ($v) => $v === 'reversed')), json_encode($values));
        $this->assertSame(5, count(array_filter($values, fn ($v) => $v === 'replayed')), json_encode($values));
        $this->assertSame(30_000_000, $this->stock91($w));
        $this->assertSame(1, (int) DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $fill->id)->where('status', 'reversed')->count());
        $this->assertSame(2, (int) DB::table('journal_entries')->where('source_type', FuelTankerFill::class)->where('source_id', $fill->id)->count(), 'الأصل + عكس واحد');
        $this->assertSame(1, (int) DB::table('fuel_tanker_fill_inventory_posting_attempts')->where('fuel_tanker_fill_id', $fill->id)->where('operation_type', 'reverse')->where('outcome', 'succeeded')->count());
        $this->assertConsistent($w, 'عكس متكرر');
    }

    #[Test]
    public function reversal_racing_a_void_never_leaves_a_voided_fill_with_an_active_posting(): void
    {
        $w = $this->world();
        $ids = [];
        foreach (range(1, 4) as $i) {
            $ids[] = $this->postedFill($w, 1_000_000)->id;
        }
        $jobs = [];
        foreach ($ids as $id) {
            $jobs[] = fn () => 'void:'.$this->voidFill($w, $id);
            $jobs[] = fn () => 'reverse:'.$this->reverseFill($w, $id);
        }
        $results = $this->runConcurrently($jobs);
        $this->assertAllCompleted($results);

        $k = 0;
        foreach ($ids as $id) {
            $void = $results[$k++]['value'];
            $reverse = $results[$k++]['value'];
            $row = DB::table('fuel_tanker_fills')->where('id', $id)->first();
            $posting = DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $id)->first();
            $this->assertFalse($row->status === 'voided' && $posting->status === 'posted', "سند ملغى بترحيل نشط: {$void} / {$reverse}");
            $this->assertSame('reverse:reversed', $reverse, "العكس لا يُرفض بسبب الإلغاء: {$void}");
            $this->assertSame('reversed', $posting->status);
            $this->assertSame('reversed', $row->inventory_status);
            $this->assertContains($void, ['void:voided', 'void:rejected:'.FuelTankerFillException::FILL_INVENTORY_POSTED]);
        }
        $this->assertConsistent($w, 'عكس ⇆ إلغاء');
    }

    #[Test]
    public function reversal_racing_postings_of_other_fills_never_deadlocks_and_stays_consistent(): void
    {
        $w = $this->world();
        $posted = [$this->postedFill($w, 2_000_000), $this->postedFill($w, 1_500_000)];
        $pending = [$this->fill($w, 700_000), $this->fill($w, 300_000)];
        $jobs = [
            fn () => $this->reverseFill($w, $posted[0]->id),
            fn () => $this->postFill($w, $pending[0]->id),
            fn () => $this->reverseFill($w, $posted[1]->id),
            fn () => $this->postFill($w, $pending[1]->id),
        ];
        $results = $this->runConcurrently($jobs);
        $this->assertAllCompleted($results);
        $this->assertSame(['reversed', 'posted', 'reversed', 'posted'], array_column($results, 'value'), json_encode($results));
        $this->assertSame(30_000_000 - 1_000_000, $this->stock91($w));
        $this->assertConsistent($w, 'عكس ⇆ ترحيل');
    }

    #[Test]
    public function reversals_racing_erp_finalize_receiving_and_reconciliation_approvals_never_deadlock_and_stay_consistent(): void
    {
        $w = $this->world();
        for ($round = 1; $round <= 6; $round++) {
            $sale = $this->draftSale($w, "tr-race-sale-{$round}");
            $delivery = $this->draftDelivery($w, "tr-race-recv-{$round}");
            $draft = $this->draftReconciliation($w, "rrace-{$round}");
            $f1 = $this->postedFill($w, 500_000);
            $f2 = $this->postedFill($w, 700_000);

            $jobs = [
                fn () => $this->attempt($w, fn () => app(FuelSaleService::class)->finalize(FuelSale::findOrFail($sale->id), User::findOrFail($w['actor']->id))->status),
                fn () => $this->attempt($w, fn () => app(FuelSupplyReceivingService::class)->approveDelivery(FuelDelivery::findOrFail($delivery->id), $w['actor']->id)->status),
                fn () => $this->attempt($w, fn () => app(FuelReconciliationService::class)->approve(FuelReconciliation::findOrFail($draft->id), $w['actor']->id, 'اعتماد')->status),
                fn () => $this->reverseFill($w, $f1->id),
                fn () => $this->reverseFill($w, $f2->id),
            ];
            if ($round % 2 === 0) {
                $jobs = array_reverse($jobs);
            }
            $results = $this->runConcurrently($jobs);
            $this->assertAllCompleted($results);
            $this->assertSame('finalized', DB::table('fuel_sales')->where('id', $sale->id)->value('status'), "جولة {$round}: ".json_encode($results));
            $this->assertSame('approved', DB::table('fuel_deliveries')->where('id', $delivery->id)->value('status'), "جولة {$round}");
            $this->assertSame('approved', DB::table('fuel_reconciliations')->where('id', $draft->id)->value('status'), "جولة {$round}");
            foreach ([$f1, $f2] as $f) {
                $this->assertSame('reversed', DB::table('fuel_tanker_fills')->where('id', $f->id)->value('inventory_status'), "جولة {$round}: ".json_encode($results));
            }
        }
        $this->assertConsistent($w, 'عكس ⇆ بيع/استلام/تسوية');
    }

    /** @param array<string,mixed> $w */
    private function assertReversalWaitsBehind(array $w, string $sql, string $label): void
    {
        $fill = $this->postedFill($w, 1_000_000);
        $holder = $this->startHolder($sql);
        usleep(500000);
        $started = microtime(true);
        $this->enter($w);
        $outcome = null;
        $error = null;
        try {
            $outcome = $this->reverseFill($w, $fill->id);
        } catch (\Throwable $e) {
            $error = $e;
        }
        $elapsed = microtime(true) - $started;
        [$stderr, $exit] = $this->finishHolder($holder);

        $this->assertStringNotContainsString('deadlock', $stderr, "{$label}: جلسة ERP المحاكاة ضحية جمود — {$stderr}");
        $this->assertSame(0, $exit, "{$label}: {$stderr}");
        $this->assertNull($error, "{$label}: ".($error ? get_class($error).': '.$error->getMessage() : ''));
        $this->assertSame('reversed', $outcome, $label);
        $this->assertGreaterThan(0.6, $elapsed, "{$label}: كان يجب أن ينتظر المِرساة المحجوزة (لا يتجاوزها)");
        $this->assertConsistent($w, $label);
    }

    #[Test]
    public function the_reversal_waits_for_the_anchor_held_in_erp_order_instead_of_taking_the_pool_first(): void
    {
        $w = $this->world();
        $this->assertReversalWaitsBehind($w, $this->erpOrderSql($w), 'ترتيب ERP');
    }

    #[Test]
    public function the_reversal_never_deadlocks_with_an_erp_sale_holding_the_anchor_and_needing_the_product(): void
    {
        $w = $this->world();
        $this->assertReversalWaitsBehind($w, $this->erpProductKeyShareSql($w), 'بيع ERP يحتاج المنتج');
    }
}
