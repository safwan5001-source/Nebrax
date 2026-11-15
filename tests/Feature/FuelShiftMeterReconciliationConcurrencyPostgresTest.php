<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelShiftNozzleReconciliation;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\FuelTankerOwner;
use App\Models\User;
use App\Services\FuelShiftMeterReconciliationService;
use App\Services\FuelShiftService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelTankerFillException;
use App\Services\FuelTankerFillService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * TANKER-PR8 — مطابقة العدّادات ومراجعة الفروق تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`):
 *  - تعبئة صهريج ↔ إغلاق الوردية: كل سند مسجَّل يدخل اللقطة المجمَّدة (لا سند «ضائع» بين التسجيل والإغلاق)، ولا جمود.
 *  - مراجعات متزامنة لفرق الفوهة نفسه ⇒ قرار واحد ثابت (الباقي إعادة آمنة أو رفض «روجع بالفعل»)، ولا جمود.
 * يُتخطّى على SQLite فقط؛ غياب pcntl على PostgreSQL فشل لا تخطٍّ.
 */
class FuelShiftMeterReconciliationConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

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
        config(['fuel_stations.shift_meter_reconciliation_enabled' => true]);
        $this->dir = sys_get_temp_dir() . '/fuel_meter_recon_' . uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir . '/*') ?: [] as $file) {
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

    /** @test */
    public function a_tanker_fill_racing_the_close_is_either_in_the_frozen_snapshot_or_rejected_never_lost(): void
    {
        $f = $this->fixture();
        $jobs = [
            fn () => $this->recordFill($f, 5_000, 'race-fill-1'),
            fn () => $this->recordFill($f, 3_000, 'race-fill-2'),
            fn () => $this->closeShift($f),
        ];
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $recorded = (int) DB::table('fuel_tanker_fills')->where('tenant_id', $f['tenant_id'])->where('status', 'recorded')->sum('quantity_milliliters');
        $snapshot = DB::table('fuel_shift_nozzle_reconciliations')->where('tenant_id', $f['tenant_id'])->where('fuel_shift_id', $f['shift_id'])->first();
        $this->assertNotNull($snapshot, json_encode($results));
        $this->assertSame($recorded, (int) $snapshot->tanker_fill_milliliters, 'كل سند مسجَّل يدخل اللقطة بالضبط: ' . json_encode($results));
        $this->assertSame(1, (int) DB::table('fuel_shift_nozzle_reconciliations')->where('fuel_shift_id', $f['shift_id'])->count());
        // لا سند يُسجَّل بعد لحظة الإغلاق.
        $this->assertSame(0, (int) DB::table('fuel_tanker_fills')->where('fuel_shift_id', $f['shift_id'])->where('recorded_at', '>', DB::table('fuel_shifts')->where('id', $f['shift_id'])->value('closed_at'))->count());
    }

    /** @test */
    public function concurrent_reviews_of_one_nozzle_leave_a_single_immutable_decision(): void
    {
        $f = $this->fixture();
        $this->enter($f);
        $this->recordFill($f, 2_000, 'pre-fill');
        $this->closeShift($f);
        $this->assertSame('variance', DB::table('fuel_shift_nozzle_reconciliations')->where('fuel_shift_id', $f['shift_id'])->value('status'));

        $jobs = [];
        foreach (['reading_error', 'reading_error', 'calibration_test', 'internal_use'] as $classification) {
            $jobs[] = fn () => $this->review($f, $classification);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(1, (int) DB::table('fuel_shift_meter_variance_reviews')->where('fuel_shift_id', $f['shift_id'])->count(), json_encode($results));
        $winner = DB::table('fuel_shift_meter_variance_reviews')->where('fuel_shift_id', $f['shift_id'])->value('classification');
        foreach (array_column($results, 'value') as $value) {
            $this->assertTrue($value === 'ok:' . $winner || $value === 'rejected:already_reviewed', $value . ' / ' . $winner);
        }
    }

    // ───────── TANKER-PR8-S: تثبيت متطلب المراجعة تحت التزامن ─────────

    /** @test */
    public function approval_racing_the_review_never_approves_an_unreviewed_snapshot_even_with_the_gate_closed_in_the_approver(): void
    {
        foreach (range(1, 3) as $round) {
            $f = $this->fixture();
            $this->relaxApproverRules($f);
            $this->closeShift($f);                                         // فرق 10 L غير مفسَّر + متطلب مثبَّت
            $this->assertSame('required_before_approval', DB::table('fuel_shift_nozzle_reconciliations')->where('fuel_shift_id', $f['shift_id'])->value('review_requirement'));

            $results = $this->runConcurrently([
                fn () => $this->approveShift($f),
                fn () => $this->approveShift($f, gateOpen: false),            // معتمِد تُغلق عنده بوابة النشر
                fn () => $this->review($f, 'reading_error'),
                fn () => $this->approveShift($f),
            ]);

            $this->assertAllCompleted($results);
            $status = DB::table('fuel_shifts')->where('id', $f['shift_id'])->value('status');
            $reviews = (int) DB::table('fuel_shift_meter_variance_reviews')->where('fuel_shift_id', $f['shift_id'])->count();
            if ($status === 'approved') {
                $this->assertSame(1, $reviews, "جولة {$round}: اعتمدت وردية بلا مراجعة: " . json_encode($results));
                $this->assertLessThanOrEqual(
                    strtotime((string) DB::table('fuel_shifts')->where('id', $f['shift_id'])->value('approved_at')),
                    strtotime((string) DB::table('fuel_shift_meter_variance_reviews')->where('fuel_shift_id', $f['shift_id'])->value('reviewed_at')),
                    'الاعتماد بعد التزام المراجعة',
                );
            }
            foreach ($results as $result) {
                $value = (string) ($result['value'] ?? '');
                $this->assertTrue(in_array($value, ['approved', 'ok:reading_error', 'rejected:review_required', 'rejected:not_closed', 'rejected:already_reviewed'], true), "جولة {$round}: " . $value);
            }
            // بعد استقرار المراجعة يُعتمد حتماً (لا جمود).
            if ($status !== 'approved') {
                $this->assertSame(1, $reviews, json_encode($results));
                $this->assertSame('approved', $this->approveShift($f, gateOpen: false));
            }
        }
    }

    /** @test */
    public function disabling_the_setting_racing_the_close_leaves_either_no_snapshot_or_a_snapshot_with_a_frozen_requirement(): void
    {
        foreach (range(1, 3) as $round) {
            $f = $this->fixture();
            $this->relaxApproverRules($f);
            $results = $this->runConcurrently([
                fn () => $this->closeShift($f),
                fn () => $this->setReconciliation($f, false),
            ]);

            $this->assertAllCompleted($results);
            $this->assertSame('closed', $results[0]['value'], json_encode($results));
            $snapshots = DB::table('fuel_shift_nozzle_reconciliations')->where('fuel_shift_id', $f['shift_id'])->get();
            if ($snapshots->isEmpty()) {
                // التعطيل سبق قراءة الإعداد وقت الإغلاق ⇒ لا متطلب، والاعتماد يمرّ.
                $this->assertSame('approved', $this->approveShift($f), json_encode($results));
            } else {
                $this->assertSame(['required_before_approval'], $snapshots->pluck('review_requirement')->unique()->values()->all());
                $this->assertSame('rejected:review_required', $this->approveShift($f), 'المتطلب ثابت رغم أن الإعداد أصبح معطَّلاً');
                $this->assertSame('ok:reading_error', $this->review($f, 'reading_error'));
                $this->assertSame('approved', $this->approveShift($f));
            }
        }
    }

    /** @test */
    public function concurrent_approvals_after_the_review_approve_exactly_once_and_a_blocked_approval_leaves_no_trace(): void
    {
        $f = $this->fixture();
        $this->relaxApproverRules($f);
        $this->closeShift($f);
        $blocked = $this->runConcurrently([fn () => $this->approveShift($f), fn () => $this->approveShift($f, gateOpen: false)]);
        $this->assertAllCompleted($blocked);
        foreach ($blocked as $result) {
            $this->assertSame('rejected:review_required', $result['value']);
        }
        $this->assertSame('closed', DB::table('fuel_shifts')->where('id', $f['shift_id'])->value('status'));
        $this->assertNull(DB::table('fuel_shifts')->where('id', $f['shift_id'])->value('approved_at'));
        $this->assertSame(0, (int) DB::table('fuel_shift_events')->where('fuel_shift_id', $f['shift_id'])->where('type', 'approved_locked')->count());

        $this->assertSame('ok:reading_error', $this->review($f, 'reading_error'));
        $after = $this->runConcurrently([fn () => $this->approveShift($f), fn () => $this->approveShift($f, gateOpen: false), fn () => $this->approveShift($f)]);
        $this->assertAllCompleted($after);
        $this->assertSame(1, count(array_filter(array_column($after, 'value'), fn ($v) => $v === 'approved')), json_encode($after));
        $this->assertSame(1, (int) DB::table('fuel_shift_events')->where('fuel_shift_id', $f['shift_id'])->where('type', 'approved_locked')->count());
    }

    // ───────── أدوات ─────────

    /** @param array<string,string> $f */
    private function recordFill(array $f, int $ml, string $key): string
    {
        $this->enter($f);
        try {
            $result = app(FuelTankerFillService::class)->record([
                'fuel_station_id' => $f['station_id'], 'fuel_nozzle_id' => $f['nozzle_id'], 'fuel_tanker_owner_id' => $f['tanker_owner_id'],
                'fuel_shift_id' => $f['shift_id'], 'voucher_number' => 'V-' . $key, 'quantity_milliliters' => $ml, 'idempotency_key' => $key,
            ], User::findOrFail($f['actor_id']));

            return 'ok:' . $result['fill']->id;
        } catch (FuelTankerFillException $exception) {
            return 'rejected:' . $exception->reason;
        }
    }

    /** @param array<string,string> $f */
    private function closeShift(array $f): string
    {
        $this->enter($f);
        try {
            app(FuelShiftService::class)->close(FuelShift::findOrFail($f['shift_id']), 0, null, User::findOrFail($f['actor_id']));

            return 'closed';
        } catch (\RuntimeException $exception) {
            return 'rejected:' . $exception->getMessage();
        }
    }

    /** @param array<string,string> $f */
    private function review(array $f, string $classification): string
    {
        $this->enter($f);
        try {
            app(FuelShiftMeterReconciliationService::class)->review(FuelShift::findOrFail($f['shift_id']), $f['nozzle_id'], $classification, null, User::findOrFail($f['actor_id']));

            return 'ok:' . $classification;
        } catch (\RuntimeException $exception) {
            return str_contains($exception->getMessage(), 'METER_VARIANCE_ALREADY_REVIEWED') ? 'rejected:already_reviewed' : 'rejected:' . $exception->getMessage();
        }
    }

    /** @param array<string,string> $f */
    private function approveShift(array $f, bool $gateOpen = true): string
    {
        $this->enter($f);
        $previousGate = config('fuel_stations.shift_meter_reconciliation_enabled');
        config(['fuel_stations.shift_meter_reconciliation_enabled' => $gateOpen]);
        try {
            app(FuelShiftService::class)->approve(FuelShift::findOrFail($f['shift_id']), null, User::findOrFail($f['actor_id']));

            return 'approved';
        } catch (\RuntimeException $exception) {
            $message = $exception->getMessage();

            return match (true) {
                str_contains($message, 'FUEL_METER_VARIANCE_REVIEW_REQUIRED') => 'rejected:review_required',
                str_contains($message, 'مغلقة') => 'rejected:not_closed',
                default => 'rejected:' . $message,
            };
        } finally {
            config(['fuel_stations.shift_meter_reconciliation_enabled' => $previousGate]);   // لا يتسرّب إغلاق البوابة إلى بقية الاختبار في العملية الأم.
        }
    }

    /** @param array<string,string> $f */
    private function setReconciliation(array $f, bool $on): string
    {
        $this->enter($f);
        app(\App\Services\FuelStationSettingsService::class)->putTenant(['shift_meter_reconciliation_enabled' => $on], User::findOrFail($f['actor_id']), 'تزامن');

        return $on ? 'on' : 'off';
    }

    /** المعتمِد هو فاتح الوردية في هذا الـfixture: يُعطَّل شرط «مشرف مختلف» كي يعزل الاختبار سباق المراجعة/الاعتماد وحده. @param array<string,string> $f */
    private function relaxApproverRules(array $f): void
    {
        $this->enter($f);
        app(\App\Services\FuelStationSettingsService::class)->putStationValues(FuelStation::findOrFail($f['station_id']), ['shift_supervisor_approval_required' => false], User::findOrFail($f['actor_id']), 'تهيئة');
    }

    /** @param array<string,string> $f */
    private function enter(array $f): void
    {
        app(TenantContext::class)->set($f['tenant_id']);
        app(BranchContext::class)->set($f['branch_id']);
    }

    /** @return array<string,string> */
    private function fixture(bool $withSecondStation = false): array
    {
        $auth = $this->registerTenant('fuel-t4-pg-' . Str::random(6), 'owner-' . Str::random(6) . '@fuel-t4-pg.test');
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();
        // PR8-S: المطابقة اشتراك اختياري؛ تُفعَّل للمؤسسة صراحةً.
        app(\App\Services\FuelStationSettingsService::class)->putTenant(['shift_meter_reconciliation_enabled' => true], $actor, 'اختبار');

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود T4 mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-T4', 'name' => 'وقود T4']);

        $equipment = function (string $suffix) use ($branch, $fuel, $actor) {
            $station = FuelStation::create(['branch_id' => $branch->id, 'code' => 'FS-' . $suffix, 'name' => 'محطة ' . $suffix]);
            $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-' . $suffix, 'name' => 'خزان', 'capacity_milliliters' => 900_000_000, 'safe_capacity_milliliters' => 800_000_000]);
            $pump = FuelPump::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => '02', 'name' => 'مضخة']);
            $nozzle = FuelNozzle::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'nozzle_number' => '1']);
            $shift = FuelShift::create([
                'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'number' => 'FSH-' . $suffix, 'status' => FuelShift::STATUS_OPEN, 'opening_float_minor' => 0,
                'idempotency_key' => 'shift-' . $suffix, 'opened_by' => $actor->id, 'opened_at' => now(),
            ]);

            return [$station, $nozzle, $shift];
        };
        [$station, $nozzle, $shift] = $equipment('PG1');
        $owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active']);

        $f = [
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'actor_id' => $actor->id, 'station_id' => $station->id, 'nozzle_id' => $nozzle->id,
            'shift_id' => $shift->id, 'tanker_owner_id' => $owner->id,
        ];
        app(FuelStationSettingsService::class)->putStationValues($station, [
            'shift_opening_meter_reading_required' => false, 'shift_closing_meter_reading_required' => false,
            'shift_opening_tank_reading_required' => false, 'shift_closing_tank_reading_required' => false,
            'shift_mandatory_staff_assignment' => false, 'shift_allow_close_with_pending_cash_variance' => true,
            'shift_allow_close_with_unresolved_operational_variance' => true,
        ], $actor, 'تهيئة اختبار المطابقة');
        foreach (['opening' => 1_000_000, 'closing' => 1_010_000] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift, ['fuel_nozzle_id' => $nozzle->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "mr-{$shift->id}-{$stage}"], $actor);
        }
        if ($withSecondStation) {
            [$station2, $nozzle2] = $equipment('PG2');
            $f += ['station2_id' => $station2->id, 'nozzle2_id' => $nozzle2->id];
        }

        return $f;
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
