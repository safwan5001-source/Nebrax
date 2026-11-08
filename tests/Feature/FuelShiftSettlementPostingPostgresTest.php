<?php

namespace Tests\Feature;

use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\FuelCostBasisService;
use App\Services\FuelStationProductPriceService;
use App\Models\FuelProduct;
use App\Services\FuelSaleService;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use App\Services\FuelShiftSettlementPostingService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelStationWalkInPartnerService;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * P1-3b-2b — تزاحم محرك ترحيل التسوية على PostgreSQL حقيقي بعمليات فعلية (`pcntl_fork`):
 *  1) N عمليات تُرحّل وردية واحدة معاً ⇒ ترحيل واحد والبقية إعادة، بلا جمود ولا ازدواج.
 *  2) المحرك مقابل بيع ERP حيّ على الفوهة نفسها (وردية أخرى) ⇒ كلاهما ينجح بلا جمود (ترتيب أقفال موحَّد: الترقيم قبل المِرساة).
 * يُتخطّى على SQLite؛ على PostgreSQL غياب `pcntl` فشل لا تخطٍّ. بيانات اختبار معزولة وبوابة مفتوحة داخل الاختبار فقط.
 */
class FuelShiftSettlementPostingPostgresTest extends TestCase
{
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;
    use UsesWorkerDatabaseWithoutTransaction;

    /** @var list<string> */
    private array $tenants = [];

    private string $dir = '';

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تزاحم الأقفال بين عمليات.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب؛ غيابه فشل لا تخطٍّ.');
        $this->dir = sys_get_temp_dir().'/fuel_settlement_engine_'.uniqid();
        mkdir($this->dir);

        config([
            'fuel_stations.shift_settlement_enabled' => true,
            'fuel_stations.shift_settlement_tax_opinion_ref' => 'TAX-OPINION-TEST-ENGINE-PG',
            'fuel_stations.shift_settlement_invoice_granularity' => 'per_nozzle',
            'fuel_stations.shift_collection_declaration_enabled' => true,
            'fuel_stations.shift_cash_receipts_enabled' => true,
        ]);
        $this->f = $this->fixture('pgeng');
        $this->tenants[] = $this->f['tenant_id'];
        $this->tenants[] = $this->f['foreign_tenant_id'];
        $this->setBasis('declared_collection');
        app(FuelStationWalkInPartnerService::class)->assign($this->f['station'], $this->f['actor']);
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل اختبار');
        $this->travel(3)->seconds();   // استلام المثبّت الأولي يسبق فتح الورديات (وإلا حُجب السطر بحدث تكلفة داخل النافذة)
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
            foreach ($this->tenants as $id) {
                DB::table('tenants')->where('id', $id)->delete();
            }
        }
        parent::tearDown();
    }

    private function closedShift(string $key, int $openingMeter): FuelShift
    {
        $shift = $this->open($key);
        foreach (['opening' => $openingMeter, 'closing' => $openingMeter + 20_000] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "pgeng-{$shift->id}-{$stage}",
            ], $this->f['actor']);
        }
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => $shift->id.'decl', 'base_revision' => 0,
            'lines' => [
                ['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 4600],
                ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0],
            ],
        ], $this->f['actor']);

        return app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + 4600, null, $this->f['actor']);
    }


    /**
     * محطة ثانية بالمؤسسة والفرع نفسيهما (مخزن ومجمّع وسعر وعميل نقدي خاصة بها) ثم وردية مغلقة عليها.
     * يستبدل `$this->f` مؤقتاً كي تعيد `closedShift()` استعمال المنطق نفسه.
     */
    private function closedShiftOnSecondStation(string $key, int $openingMeter, bool $otherBranch = false): FuelShift
    {
        $f = $this->f;
        $tenantId = $f['tenant_id'];
        $branch = $otherBranch ? \App\Models\Branch::create(['code' => 'BR-'.substr(uniqid(), -6), 'name' => 'فرع المحطة الثانية', 'is_main' => false]) : $f['branch'];
        $original = app(\App\Tenancy\BranchContext::class)->id();
        if ($otherBranch) {
            app(\App\Tenancy\BranchContext::class)->set($branch->id);
        }
        $actor = $f['actor'];
        $warehouse = Warehouse::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'name' => 'مخزن محطة ثانية', 'code' => 'WH2-'.uniqid()]);
        $station = FuelStation::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FCS-2-'.uniqid(), 'name' => 'محطة ثانية']);
        $fuelProduct = $f['fuelProduct'];
        $tank = FuelTank::create([
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id,
            'code' => 'FCT-2-'.uniqid(), 'name' => 'خزان 2', 'capacity_milliliters' => 10000000, 'safe_capacity_milliliters' => 9000000,
        ]);
        $pump = FuelPump::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => 'FCP-2-'.uniqid()]);
        $nozzle = FuelNozzle::create([
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuelProduct->id, 'nozzle_number' => 'FCN-2-'.uniqid(),
        ]);
        app(FuelCostBasisService::class)->assertReady($fuelProduct, $warehouse);
        $movement = app(InventoryService::class)->applyReceipt($f['product'], 1000000, 100, [
            'warehouse_id' => $warehouse->id, 'source_type' => FuelProduct::class, 'source_id' => $fuelProduct->id,
            'notes' => 'رصيد اختبار 2', InventoryService::FUEL_POOL_META => true,
        ], 100000000);
        app(FuelCostBasisService::class)->recordReceipt($fuelProduct, $warehouse, $movement, 1000000, 100000000);
        app(FuelStationProductPriceService::class)->create([
            'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id, 'price_per_liter_minor' => 230,
            'effective_from' => now()->subMinute()->toIso8601String(),
        ], $actor);
        app(FuelStationSettingsService::class)->putStationValues($station, [
            'fuel_sales_allowed_payment_method_ids' => [$f['cash']->id, $f['bank']->id],
            'fuel_sales_allow_deferred_payment' => false,
            'shift_opening_meter_reading_required' => false, 'shift_closing_meter_reading_required' => false,
            'shift_opening_tank_reading_required' => false, 'shift_closing_tank_reading_required' => false,
            'shift_mandatory_staff_assignment' => false, 'shift_supervisor_approval_required' => false,
            'shift_allow_close_with_pending_cash_variance' => true,
            'shift_expected_cash_basis' => 'declared_collection',
        ], $actor, 'تهيئة محطة ثانية');
        app(FuelStationWalkInPartnerService::class)->assign($station, $actor);
        app(FuelStationSettingsService::class)->putStationValues($station, ['shift_settlement_mode' => 'post_on_close'], $actor, 'تفعيل اختبار');
        $this->travel(3)->seconds();

        $this->f['station'] = $station;
        $this->f['nozzle'] = $nozzle;
        try {
            return $this->closedShift($key, $openingMeter);
        } finally {
            $this->f['station'] = $f['station'];
            $this->f['nozzle'] = $f['nozzle'];
            app(\App\Tenancy\BranchContext::class)->set($original);
        }
    }

    /**
     * @param  list<callable():mixed>  $jobs
     * @return list<array<string,mixed>>
     */
    private function concurrently(array $jobs): array
    {
        $barrier = $this->dir.'/barrier_'.uniqid();
        $files = [];
        $pids = [];
        foreach ($jobs as $i => $job) {
            $files[$i] = $this->dir.'/result_'.uniqid()."_{$i}";
            $pid = pcntl_fork();
            $this->assertNotSame(-1, $pid, 'فشل pcntl_fork');
            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    file_put_contents($files[$i], json_encode(['ok' => true, 'value' => $job()]));
                } catch (\Throwable $e) {
                    file_put_contents($files[$i], json_encode(['ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage()]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }
        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }
        $out = [];
        foreach ($files as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $out[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $out;
    }

    #[Test]
    public function concurrent_posts_of_one_shift_yield_one_posting_and_replays(): void
    {
        $shift = $this->closedShift('race1', 1_000_000);

        $jobs = [];
        foreach (range(1, 5) as $n) {
            $jobs[] = fn () => app(FuelShiftSettlementPostingService::class)->post(FuelShift::findOrFail($shift->id), $this->f['actor'])->outcome;
        }
        $results = $this->concurrently($jobs);

        $this->assertSame([], array_values(array_filter($results, fn ($r) => ! $r['ok'])), 'لا استثناءات ولا جمود: '.json_encode($results, JSON_UNESCAPED_UNICODE));
        $outcomes = array_count_values(array_map(fn ($r) => $r['value'], $results));
        $this->assertSame(1, $outcomes['posted'] ?? 0, 'ترحيل واحد فقط: '.json_encode($outcomes));
        $this->assertSame(4, $outcomes['replayed'] ?? 0);
        $this->assertSame(1, DB::table('fuel_shift_settlements')->where('fuel_shift_id', $shift->id)->count());
        $this->assertSame(1, DB::table('fuel_sales')->where('fuel_shift_id', $shift->id)->where('source', 'settlement')->count());
        $this->assertSame(1, DB::table('invoices')->where('notes', 'like', '%'.$shift->number.'%')->count(), 'فاتورة واحدة للفوهة');
    }

    #[Test]
    public function the_engine_and_a_live_erp_sale_on_the_same_nozzle_never_deadlock(): void
    {
        foreach (range(1, 3) as $i) {
            $closed = $this->closedShift("mix{$i}", 1_000_000 + $i * 100_000);
            $live = $this->open("mix-live{$i}");

            $results = $this->concurrently([
                fn () => app(FuelShiftSettlementPostingService::class)->post(FuelShift::findOrFail($closed->id), $this->f['actor'])->outcome,
                function () use ($live, $i) {
                    $service = app(FuelSaleService::class);
                    $sale = $service->finalize($service->createDraft([
                        'fuel_station_id' => $this->f['station']->id, 'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_shift_id' => $live->id,
                        'partner_id' => $this->f['customer']->id, 'quantity_milliliters' => 1000, 'idempotency_key' => "mix-erp-{$i}",
                    ], $this->f['actor']), $this->f['actor']);

                    return $sale->status;
                },
            ]);

            $this->assertSame([], array_values(array_filter($results, fn ($r) => ! $r['ok'])), "التكرار {$i}: ".json_encode($results, JSON_UNESCAPED_UNICODE));
            $this->assertSame('posted', $results[0]['value']);
            $this->assertSame('finalized', $results[1]['value']);

            // الوردية الحيّة تُغلق ليُفتح بعدها غيرها في التكرار التالي (قراءات اصطناعية مكتملة).
            foreach (['opening' => 5_000_000 + $i * 100_000, 'closing' => 5_000_000 + $i * 100_000 + 1_000] as $stage => $ml) {
                app(FuelShiftService::class)->recordMeter($live->fresh(), [
                    'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "mix-live-{$live->id}-{$stage}",
                ], $this->f['actor']);
            }
            app(FuelShiftCollectionService::class)->declare($live->fresh(), [
                'idempotency_key' => $live->id.'decl', 'base_revision' => 0,
                'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 230], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
            ], $this->f['actor']);
            app(FuelShiftService::class)->close($live->fresh(), self::FLOAT + 230, null, $this->f['actor']);
        }
        $this->assertSame(3, DB::table('fuel_sales')->where('source', 'settlement')->count());
        $this->assertSame(3, DB::table('fuel_sales')->where('source', 'station')->count());
    }

    #[Test]
    public function two_stations_of_one_tenant_posting_at_once_never_deadlock(): void
    {
        foreach (range(1, 3) as $i) {
            $a = $this->closedShift("two-a{$i}", 1_000_000 + $i * 100_000);
            $b = $this->closedShiftOnSecondStation("two-b{$i}", 2_000_000 + $i * 100_000);

            $results = $this->concurrently([
                fn () => app(FuelShiftSettlementPostingService::class)->post(FuelShift::findOrFail($a->id), $this->f['actor'])->outcome,
                fn () => app(FuelShiftSettlementPostingService::class)->post(FuelShift::findOrFail($b->id), $this->f['actor'])->outcome,
            ]);

            $this->assertSame([], array_values(array_filter($results, fn ($r) => ! $r['ok'])), "التكرار {$i}: ".json_encode($results, JSON_UNESCAPED_UNICODE));
            $this->assertSame(['posted', 'posted'], [$results[0]['value'], $results[1]['value']]);
        }
    }

    #[Test]
    public function two_stations_in_different_branches_posting_at_once_never_deadlock(): void
    {
        foreach (range(1, 3) as $i) {
            $a = $this->closedShift("xb-a{$i}", 1_000_000 + $i * 100_000);
            $b = $this->closedShiftOnSecondStation("xb-b{$i}", 2_000_000 + $i * 100_000, true);

            $results = $this->concurrently([
                function () use ($a) {
                    app(\App\Tenancy\BranchContext::class)->forget();

                    return app(FuelShiftSettlementPostingService::class)->post(FuelShift::findOrFail($a->id), $this->f['actor'])->outcome;
                },
                function () use ($b) {
                    app(\App\Tenancy\BranchContext::class)->forget();

                    return app(FuelShiftSettlementPostingService::class)->post(FuelShift::findOrFail($b->id), $this->f['actor'])->outcome;
                },
            ]);

            $this->assertSame([], array_values(array_filter($results, fn ($r) => ! $r['ok'])), "التكرار {$i}: ".json_encode($results, JSON_UNESCAPED_UNICODE));
            $this->assertSame(['posted', 'posted'], [$results[0]['value'], $results[1]['value']]);
        }
    }

    #[Test]
    public function the_engine_and_a_manual_erp_collection_on_the_same_walk_in_invoice_never_double_pay_or_deadlock(): void
    {
        $walkIn = app(\App\Services\FuelShiftSettlementReadiness::class)->walkInPartner($this->f['station']);
        foreach (range(1, 3) as $i) {
            $shift = $this->open("mc{$i}");
            $base = 3_000_000 + $i * 100_000;
            foreach (['opening' => $base, 'closing' => $base + 20_000] as $stage => $ml) {
                app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                    'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "mc-{$shift->id}-{$stage}",
                ], $this->f['actor']);
            }
            $service = app(FuelSaleService::class);
            $erpSale = $service->finalize($service->createDraft([
                'fuel_station_id' => $this->f['station']->id, 'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_shift_id' => $shift->id,
                'partner_id' => $walkIn->id, 'quantity_milliliters' => 1000, 'idempotency_key' => "mc-erp-{$i}",
            ], $this->f['actor']), $this->f['actor']);
            app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
                'idempotency_key' => $shift->id.'decl', 'base_revision' => 0,
                'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 4600], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
            ], $this->f['actor']);
            $closed = app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + 4600, null, $this->f['actor']);
            $live = $this->open("mc-live{$i}");

            $results = $this->concurrently([
                fn () => app(FuelShiftSettlementPostingService::class)->post(FuelShift::findOrFail($closed->id), $this->f['actor'])->outcome,
                function () use ($erpSale, $live, $i) {
                    // تحصيل يدوي لكامل فاتورة ERP للعميل النقدي في الوقت نفسه (يسبق التسوية أو يلحقها).
                    try {
                        app(FuelSaleService::class)->collectPayment($erpSale->fresh(), [
                            'payment_method_id' => $this->f['cash']->id, 'amount_minor' => 230, 'idempotency_key' => "mc-manual-{$i}",
                        ], $this->f['actor']);

                        return 'collected';
                    } catch (\RuntimeException $e) {
                        return 'rejected';
                    }
                },
            ]);

            $this->assertSame([], array_values(array_filter($results, fn ($r) => ! $r['ok'])), "التكرار {$i}: ".json_encode($results, JSON_UNESCAPED_UNICODE));
            $invoice = \App\Models\Invoice::findOrFail($erpSale->invoice_id);
            $this->assertLessThanOrEqual((int) $invoice->total, (int) $invoice->paid_amount, 'لا دفع زائد على الفاتورة');
            if ($results[0]['value'] === 'posted') {
                $this->assertSame(230, (int) $invoice->paid_amount, 'مدفوعة مرة واحدة فقط');
            } else {
                $this->assertContains($results[0]['value'], ['blocked'], 'التسوية إما ترحَّل أو تُحجب بسبب تغيّر الحالة، لا استثناء');
            }

            foreach (['opening' => 6_000_000 + $i * 100_000, 'closing' => 6_000_000 + $i * 100_000 + 1_000] as $stage => $ml) {
                app(FuelShiftService::class)->recordMeter($live->fresh(), [
                    'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "mc-live-{$live->id}-{$stage}",
                ], $this->f['actor']);
            }
            app(FuelShiftCollectionService::class)->declare($live->fresh(), [
                'idempotency_key' => $live->id.'decl', 'base_revision' => 0,
                'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 230], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
            ], $this->f['actor']);
            app(FuelShiftService::class)->close($live->fresh(), self::FLOAT + 230, null, $this->f['actor']);
        }
    }

    #[Test]
    public function the_engine_and_a_generic_cash_invoice_on_the_same_branch_never_deadlock(): void
    {
        foreach (range(1, 3) as $i) {
            $closed = $this->closedShift("gc{$i}", 1_000_000 + $i * 100_000);

            $results = $this->concurrently([
                fn () => app(FuelShiftSettlementPostingService::class)->post(FuelShift::findOrFail($closed->id), $this->f['actor'])->outcome,
                function () use ($i) {
                    $service = app(\App\Services\Accounting\InvoiceService::class);
                    $invoice = $service->post($service->create([
                        'partner_id' => $this->f['customer']->id, 'branch_id' => $this->f['branch']->id, 'payment_type' => 'cash', 'invoice_date' => now()->toDateString(),
                        'created_by' => $this->f['actor']->id,
                    ], [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]), null, $this->f['actor']);

                    return $invoice->status;
                },
            ]);

            $this->assertSame([], array_values(array_filter($results, fn ($r) => ! $r['ok'])), "التكرار {$i}: ".json_encode($results, JSON_UNESCAPED_UNICODE));
            $this->assertSame('posted', $results[0]['value']);
            $this->assertSame('posted', $results[1]['value']);
        }
    }

    #[Test]
    public function many_workers_running_the_job_runner_for_one_shift_post_it_exactly_once(): void
    {
        $shift = $this->closedShift('jr1', 1_000_000);
        $jobs = [];
        foreach (range(1, 5) as $n) {
            $jobs[] = fn () => app(\App\Services\FuelShiftSettlementJobRunner::class)->run(null, "w{$n}");
        }
        $results = $this->concurrently($jobs);

        $this->assertSame([], array_values(array_filter($results, fn ($r) => ! $r['ok'])), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(1, array_sum(array_map(fn ($r) => (int) $r['value']['claimed'], $results)), 'مطالبة واحدة فقط');
        $this->assertSame(1, array_sum(array_map(fn ($r) => (int) $r['value']['posted'], $results)));
        $this->assertSame(1, DB::table('fuel_shift_settlements')->where('fuel_shift_id', $shift->id)->count());
        $this->assertSame(1, DB::table('payments')->where('notes', 'like', '%'.$shift->number.'%')->count());
        $job = DB::table('fuel_shift_settlement_jobs')->where('fuel_shift_id', $shift->id)->first();
        $this->assertSame('completed', $job->status);
        $this->assertSame('posted', $job->last_outcome);
    }

    #[Test]
    public function an_eight_nozzle_shift_posts_atomically_and_its_duration_is_recorded(): void
    {
        $f = $this->f;
        $nozzles = [$f['nozzle']];
        foreach (range(2, 8) as $n) {
            $nozzles[] = FuelNozzle::create([
                'tenant_id' => $f['tenant_id'], 'branch_id' => $f['branch']->id, 'fuel_station_id' => $f['station']->id, 'fuel_pump_id' => $f['nozzle']->fuel_pump_id,
                'fuel_tank_id' => $f['nozzle']->fuel_tank_id, 'fuel_product_id' => $f['fuelProduct']->id, 'nozzle_number' => 'FCN-8-'.$n,
            ]);
        }
        $shift = $this->open('n8');
        foreach ($nozzles as $i => $nozzle) {
            foreach (['opening' => 1_000_000 + $i * 100_000, 'closing' => 1_000_000 + $i * 100_000 + 20_000] as $stage => $ml) {
                app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                    'fuel_nozzle_id' => $nozzle->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "n8-{$shift->id}-{$i}-{$stage}",
                ], $f['actor']);
            }
        }
        $total = 8 * 4600;
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => $shift->id.'decl', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $f['cash']->id, 'amount_minor' => 2 * 4600], ['payment_method_id' => $f['bank']->id, 'amount_minor' => $total - 2 * 4600]],
        ], $f['actor']);
        $closed = app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + 2 * 4600, null, $f['actor']);

        $started = microtime(true);
        $result = app(FuelShiftSettlementPostingService::class)->post($closed, $f['actor']);
        $elapsed = microtime(true) - $started;
        file_put_contents(sys_get_temp_dir().'/awj_8nozzle_post_seconds.txt', sprintf("%.3f\n", $elapsed));

        $this->assertSame('posted', $result->outcome, json_encode($result->reasons));
        $this->assertSame(8, $result->postedLines);
        $this->assertSame(8, DB::table('invoices')->where('notes', 'like', '%'.$shift->number.'%')->count());
        $this->assertSame($total, (int) DB::table('fuel_shift_settlement_collections')->where('fuel_shift_settlement_id', $result->settlementId)->sum('amount_minor'), 'كل المحصَّل مخصَّص');
        $this->assertSame(0, DB::table('fuel_shift_settlement_variances')->where('fuel_shift_settlement_id', $result->settlementId)->count());
        $this->assertLessThan(30.0, $elapsed, 'مدة معاملة 8 فوهات ضمن حدّ معقول (الإيجار 300ث)');
    }
}
