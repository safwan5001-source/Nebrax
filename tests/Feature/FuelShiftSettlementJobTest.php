<?php

namespace Tests\Feature;

use App\Models\AccountingPeriodLock;
use App\Models\FuelShift;
use App\Models\FuelShiftSettlementJob;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use App\Services\FuelShiftSettlementJobRunner;
use App\Services\FuelShiftSettlementJobService;
use App\Services\FuelShiftSettlementPendingService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelStationWalkInPartnerService;
use App\Support\FuelStaffTemplates;
use App\Support\Rbac;
use App\Support\SettlementJobHandler;
use App\Support\SettlementJobOutcome;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * P1-3b-1 — مهام تسوية الورديات المسجَّلة (D-S2): بنية موثوقة **بلا أي أثر محاسبي**.
 *
 * الحاكم: لا فاتورة ولا سند ولا قيد ولا حركة مخزون ولا صف تسوية من أي مسار هنا (تعدّ الاختبارات صفوف الجداول قبل وبعد). المحرك الفعلي في P1-3b-2 بموافقة جديدة.
 * تغطي: التسجيل الذرّي مع الإغلاق، البوابة المغلقة (الإغلاق مطابق لما قبل)، منع الازدواج، الاسترداد بعد سقوط العامل والحاجز، إعادة المحاولة بعد أخطاء الاتصال/الجمود،
 * الفترة المقفلة، العتبات (2/24 ساعة)، الصلاحية المحجوزة، وحراس القاعدة.
 */
class FuelShiftSettlementJobTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->openGates();
        $this->f = $this->fixture();
        $this->setBasis('declared_collection');
        app(FuelStationWalkInPartnerService::class)->assign($this->f['station'], $this->f['actor']);
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل اختبار');
        $this->travel(3)->seconds();
    }

    private function openGates(): void
    {
        config([
            'fuel_stations.shift_settlement_enabled' => true,
            'fuel_stations.shift_settlement_tax_opinion_ref' => 'TAX-OPINION-TEST-JOBS',
            'fuel_stations.shift_collection_declaration_enabled' => true,
            'fuel_stations.shift_cash_receipts_enabled' => true,
        ]);
    }

    // ───────── مساعدات ─────────

    /** يتوقّع رفض القاعدة داخل savepoint كي لا تُجهَض معاملة PostgreSQL المحيطة بالاختبار. */
    private function rejects(callable $operation): \Throwable
    {
        try {
            DB::transaction($operation);
        } catch (\Throwable $e) {
            if ($e instanceof \PHPUnit\Framework\AssertionFailedError) {
                throw $e;
            }

            return $e;
        }

        $this->fail('كان يجب أن تُرفض هذه العملية.');
    }

    /** وردية مغلقة فعلاً بالمسار الحقيقي (عدّاد 20 لتراً + إقرار نقد 46.00 + عدّ 246.00 = عهدة 200.00). */
    private function closedShift(string $key, int $openingMeter = 1_000_000): FuelShift
    {
        $shift = $this->open($key);
        foreach (['opening' => $openingMeter, 'closing' => $openingMeter + 20_000] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "job-{$shift->id}-{$stage}",
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

    private function jobFor(FuelShift $shift): ?FuelShiftSettlementJob
    {
        return FuelShiftSettlementJob::query()->withoutGlobalScopes()->where('fuel_shift_id', $shift->id)->first();
    }

    private function fresh(FuelShiftSettlementJob $job): FuelShiftSettlementJob
    {
        return FuelShiftSettlementJob::query()->withoutGlobalScopes()->findOrFail($job->id);
    }

    /** @return array<string,int> */
    private function writeCounts(): array
    {
        $tables = ['invoices', 'invoice_lines', 'journal_entries', 'journal_lines', 'payments', 'payment_allocations', 'stock_movements', 'fuel_sales',
            'fuel_sale_payment_receipts', 'fuel_inventory_cost_states', 'fuel_inventory_cost_movements', 'fuel_operational_ledgers', 'partners',
            'fuel_shift_settlements', 'fuel_shift_settlement_lines', 'fuel_shift_settlement_collections', 'fuel_shift_settlement_variances',
            'fuel_shift_settlement_resolutions', 'fuel_cost_pool_open_histories', 'fuel_station_walk_in_partners', 'zatca_chain_entries'];

        return collect($tables)->mapWithKeys(fn ($t) => [$t => DB::table($t)->count()])->all();
    }

    private function useHandler(callable $fn): void
    {
        $this->app->instance(SettlementJobHandler::class, new class($fn) implements SettlementJobHandler {
            public int $calls = 0;

            public function __construct(private $fn) {}

            public function handle(FuelShiftSettlementJob $job): SettlementJobOutcome
            {
                $this->calls++;

                return ($this->fn)($job, $this->calls);
            }
        });
        // المشغّل يُحلّ من جديد ليلتقط المعالج المربوط.
        $this->app->forgetInstance(FuelShiftSettlementJobRunner::class);
    }

    private function connectionLost(): QueryException
    {
        $pdo = new \PDOException('SQLSTATE[08006] [7] connection to server on socket failed');
        $pdo->errorInfo = ['08006', 7, 'connection failure'];

        return new QueryException('pgsql', 'select 1', [], $pdo);
    }

    private function deadlock(): QueryException
    {
        $pdo = new \PDOException('SQLSTATE[40P01]: Deadlock detected');
        $pdo->errorInfo = ['40P01', 7, 'deadlock detected'];

        return new QueryException('pgsql', 'select 1', [], $pdo);
    }

    // ═══════════ 1) الإغلاق التشغيلي والتسجيل الذرّي ═══════════

    /** @test */
    public function with_the_gate_closed_close_is_untouched_and_the_jobs_table_is_never_queried(): void
    {
        config(['fuel_stations.shift_settlement_enabled' => false]);
        $queries = [];
        DB::listen(function ($q) use (&$queries) {
            $queries[] = $q->sql;
        });

        $shift = $this->closedShift('g1');

        $this->assertSame('closed', $shift->status);
        $this->assertSame([], array_values(array_filter($queries, fn ($sql) => str_contains($sql, 'fuel_shift_settlement_jobs'))), 'البوابة مغلقة ⇒ لا استعلام عن المهام');
        $this->assertSame(0, DB::table('fuel_shift_settlement_jobs')->count());
    }

    /** @test */
    public function with_the_gate_open_and_policy_on_close_registers_exactly_one_job_and_posts_nothing(): void
    {
        $before = $this->writeCounts();

        $shift = $this->closedShift('g2');

        $this->assertSame('closed', $shift->status);
        $this->assertSame(1, DB::table('fuel_shift_settlement_jobs')->count());
        $job = $this->jobFor($shift);
        $this->assertSame('queued', $job->status);
        $this->assertSame($this->f['tenant_id'], $job->tenant_id);
        $this->assertSame($shift->branch_id, $job->branch_id);
        $this->assertSame($this->f['station']->id, $job->fuel_station_id);
        $this->assertSame($this->f['actor']->id, $job->triggered_by_user_id);
        $this->assertSame(0, $job->attempts);
        $this->assertSame(5, $job->max_attempts);
        $this->assertNull($job->last_outcome);
        $this->assertNull($job->locked_by);
        // التسجيل ليس ترحيلاً: لا مستند ولا قيد ولا حركة ولا صف تسوية.
        $this->assertSame($before, $this->writeCounts());
    }

    /** @test */
    public function a_station_with_policy_none_registers_no_job(): void
    {
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => null], $this->f['actor'], 'none');

        $this->closedShift('g3');

        $this->assertSame(0, DB::table('fuel_shift_settlement_jobs')->count());
    }

    /** @test */
    public function registering_twice_returns_the_same_job_and_the_database_rejects_a_second_row(): void
    {
        $shift = $this->closedShift('g4');
        $first = $this->jobFor($shift);

        $again = app(FuelShiftSettlementJobService::class)->enqueue($shift->fresh(), $this->f['actor']);

        $this->assertSame($first->id, $again->id);
        $this->assertSame(1, DB::table('fuel_shift_settlement_jobs')->where('fuel_shift_id', $shift->id)->count());
        $error = $this->rejects(fn () => DB::table('fuel_shift_settlement_jobs')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $first->tenant_id, 'branch_id' => $first->branch_id, 'fuel_station_id' => $first->fuel_station_id,
            'fuel_shift_id' => $shift->id, 'status' => 'queued', 'next_attempt_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]));
        $this->assertNotNull($error);
    }

    /** @test */
    public function a_registration_failure_never_fails_the_close(): void
    {
        $this->app->instance(FuelShiftSettlementJobService::class, new class(app(\App\Services\FuelShiftSettlementReadiness::class)) extends FuelShiftSettlementJobService {
            public function enqueue(FuelShift $shift, ?\App\Models\User $actor = null): FuelShiftSettlementJob
            {
                throw new \RuntimeException('simulated enqueue failure');
            }
        });

        $shift = $this->closedShift('g5');

        $this->assertSame('closed', $shift->fresh()->status, 'الإغلاق التشغيلي ينجح ولو فشل التسجيل');
        $this->assertSame(0, DB::table('fuel_shift_settlement_jobs')->count());
    }

    // ═══════════ 2) التشغيل والفترة المقفلة (مراجعة دورة الإغلاق) ═══════════

    /** @test */
    public function a_locked_period_keeps_the_job_blocked_with_a_reason_then_clears_when_the_period_opens_and_nothing_is_posted(): void
    {
        $shift = $this->closedShift('p1');
        $job = $this->jobFor($shift);
        $lock = AccountingPeriodLock::create([
            'tenant_id' => $this->f['tenant_id'], 'start_date' => now()->subDays(30)->toDateString(), 'end_date' => now()->addDays(30)->toDateString(),
            'status' => 'active', 'reason' => 'إقفال اختبار',
        ]);
        $before = $this->writeCounts();

        $summary = app(FuelShiftSettlementJobRunner::class)->run();

        $this->assertSame(1, $summary['claimed']);
        $this->assertSame(1, $summary['blocked']);
        $job = $this->fresh($job);
        $this->assertSame('queued', $job->status);
        $this->assertSame('blocked', $job->last_outcome);
        $this->assertSame(['FUEL_SETTLEMENT_PERIOD_LOCKED'], $job->blocked_reasons);
        $this->assertSame(1, $job->checks);
        $this->assertSame(0, $job->attempts, 'الحجب ليس فشلاً: لا يستهلك ميزانية الإعادة');
        $this->assertEqualsWithDelta(now()->addMinutes(10)->timestamp, $job->next_attempt_at->timestamp, 5);
        $this->assertSame($before, $this->writeCounts(), 'التقييم لا يكتب مستنداً');

        // غير مستحقة بعد: لا تُطالَب ثانيةً.
        $this->assertSame(0, app(FuelShiftSettlementJobRunner::class)->run()['claimed']);

        // فتح الفترة رسمياً ثم حلول موعد الفحص التالي ⇒ لا مانع، وتبقى معلقة بانتظار المحرك (لا ادّعاء إنجاز).
        $lock->update(['status' => 'released']);
        $this->travel(11)->minutes();
        $summary = app(FuelShiftSettlementJobRunner::class)->run();

        $this->assertSame(1, $summary['awaiting_engine']);
        $job = $this->fresh($job);
        $this->assertSame('awaiting_engine', $job->last_outcome);
        $this->assertNull($job->blocked_reasons);
        $this->assertSame('queued', $job->status, 'لا محرك ترحيل بعد فتبقى معلقة صادقةً');
        $this->assertSame(2, $job->checks);
        $this->assertSame($before, $this->writeCounts());
    }

    /** @test */
    public function a_shift_crossing_a_month_boundary_and_a_missing_declaration_are_reported_as_stable_reasons(): void
    {
        $shift = $this->closedShift('p2');
        // عبور شهر: فتح الوردية في الشهر السابق بتقويم المحطة.
        DB::table('fuel_shifts')->where('id', $shift->id)->update(['opened_at' => now()->subMonths(2)]);
        DB::table('fuel_shift_collection_declarations')->where('fuel_shift_id', $shift->id)->delete();

        $reasons = app(\App\Services\FuelShiftSettlementPreviewService::class)->closedShiftPrechecks($shift->fresh());

        $this->assertContains('FUEL_SETTLEMENT_PERIOD_BOUNDARY', $reasons);
        $this->assertContains('FUEL_SETTLEMENT_DECLARATION_MISSING', $reasons);
        $this->assertSame($reasons, array_values(array_unique($reasons)));
    }

    /** @test */
    public function closing_the_gate_after_registration_leaves_the_job_untouched_and_the_runner_idle(): void
    {
        $shift = $this->closedShift('p3');
        $job = $this->jobFor($shift);
        config(['fuel_stations.shift_settlement_enabled' => false]);

        $summary = app(FuelShiftSettlementJobRunner::class)->run();

        $this->assertSame('gate_closed', $summary['skipped']);
        $this->assertSame(0, $summary['claimed']);
        $this->assertSame('queued', $this->fresh($job)->status);
    }

    /** @test */
    public function turning_the_policy_off_after_registration_completes_the_job_as_disabled_with_no_effect(): void
    {
        $shift = $this->closedShift('p4');
        $job = $this->jobFor($shift);
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => null], $this->f['actor'], 'إيقاف');
        $before = $this->writeCounts();

        $summary = app(FuelShiftSettlementJobRunner::class)->run();

        $this->assertSame(1, $summary['disabled']);
        $job = $this->fresh($job);
        $this->assertSame('completed', $job->status);
        $this->assertSame('disabled', $job->last_outcome);
        $this->assertNotNull($job->completed_at);
        $this->assertSame($before, $this->writeCounts());
        $this->assertSame(0, app(FuelShiftSettlementJobRunner::class)->run()['claimed'], 'المهمة المنتهية لا تُطالَب ثانيةً');
    }

    // ═══════════ 3) سقوط العامل والاسترداد والحاجز ═══════════

    /** @test */
    public function a_job_whose_worker_died_is_recovered_by_another_worker_after_the_lease_and_the_zombie_cannot_write(): void
    {
        $shift = $this->closedShift('w1');
        $service = app(FuelShiftSettlementJobService::class);

        $a = $service->claimNext('worker-A', 60);
        $this->assertNotNull($a);
        $this->assertSame('running', $this->fresh($a)->status);
        $this->assertNull($service->claimNext('worker-B', 60), 'الإيجار ساري ⇒ لا يطالب به عامل آخر');

        // العامل A يسقط (لا إنهاء). ينتهي الإيجار فيستردّها B ويُحسب الاسترداد تنفيذاً فاشلاً.
        $this->travel(61)->seconds();
        $b = $service->claimNext('worker-B', 60);
        $this->assertNotNull($b);
        $this->assertSame($a->id, $b->id, 'المهمة نفسها لا مهمة ثانية');
        $this->assertSame(1, $this->fresh($b)->attempts);
        $this->assertSame('worker-B', $this->fresh($b)->makeVisible('locked_by')->locked_by);

        // العامل المتأخر A (زومبي) يحاول كتابة نتيجته: مرفوض بالحاجز ولا يغيّر شيئاً.
        $this->assertFalse($service->record($a, 'worker-A', SettlementJobOutcome::awaitingEngine()));
        $this->assertFalse($service->recordError($a, 'worker-A', 'unexpected'));
        $stale = $this->fresh($b);
        $this->assertSame('running', $stale->status);
        $this->assertSame(1, $stale->attempts);
        $this->assertSame(0, $stale->checks);

        // B يُنهي بنجاح.
        $this->assertTrue($service->record($b, 'worker-B', SettlementJobOutcome::awaitingEngine()));
        $done = $this->fresh($b);
        $this->assertSame('queued', $done->status);
        $this->assertSame(1, $done->checks);
        $this->assertNull($done->locked_until);
    }

    /** @test */
    public function repeated_worker_loss_exhausts_the_retry_budget_and_ends_visibly_failed(): void
    {
        config(['fuel_stations.settlement_job.max_attempts' => 2]);
        $shift = $this->closedShift('w2');
        $job = $this->jobFor($shift);
        $this->assertSame(2, $job->max_attempts);
        $service = app(FuelShiftSettlementJobService::class);

        $this->assertNotNull($service->claimNext('w1', 30));      // يسقط
        $this->travel(31)->seconds();
        $this->assertNotNull($service->claimNext('w2', 30));      // استرداد 1 (attempts=1) ثم يسقط
        $this->travel(31)->seconds();
        $this->assertNull($service->claimNext('w3', 30), 'الاسترداد الثالث يستنفد الميزانية فلا يُسلَّم لعامل');

        $job = $this->fresh($job);
        $this->assertSame('failed', $job->status);
        $this->assertSame('worker_lost', $job->last_error_code);
        $this->assertNotNull($job->completed_at);
        $this->assertNull($service->claimNext('w4', 30), 'الفاشلة لا تُعاد تلقائياً');

        $pending = app(FuelShiftSettlementPendingService::class)->list();
        $this->assertSame('escalated', $pending[0]['alert_level'], 'الفشل النهائي يظهر مصعَّداً دون انتظار العتبة');
        $this->assertSame('worker_lost', $pending[0]['last_error_code']);
    }

    // ═══════════ 4) انقطاع الاتصال وأخطاء القاعدة وإعادة المحاولة ═══════════

    /** @test */
    public function a_connection_loss_during_processing_is_retried_with_backoff_then_succeeds_without_any_side_effect(): void
    {
        $shift = $this->closedShift('c1');
        $job = $this->jobFor($shift);
        $this->useHandler(function ($j, int $call) {
            if ($call === 1) {
                throw $this->connectionLost();
            }

            return SettlementJobOutcome::awaitingEngine();
        });
        $before = $this->writeCounts();

        $summary = app(FuelShiftSettlementJobRunner::class)->run();
        $this->assertSame(1, $summary['errors']);
        $job = $this->fresh($job);
        $this->assertSame('queued', $job->status);
        $this->assertSame(1, $job->attempts);
        $this->assertSame('connection_lost', $job->last_error_code);
        $this->assertEqualsWithDelta(now()->addMinute()->timestamp, $job->next_attempt_at->timestamp, 5, 'أول تراجع دقيقة');
        $this->assertNull($job->locked_by);

        $this->assertSame(0, app(FuelShiftSettlementJobRunner::class)->run()['claimed'], 'لا إعادة قبل موعد التراجع');

        $this->travel(61)->seconds();
        $summary = app(FuelShiftSettlementJobRunner::class)->run();
        $this->assertSame(1, $summary['awaiting_engine']);
        $job = $this->fresh($job);
        $this->assertSame(1, $job->attempts, 'النجاح لا يزيد المحاولات الفاشلة');
        $this->assertSame(1, $job->checks);
        $this->assertSame($before, $this->writeCounts());
    }

    /** @test */
    public function deadlocks_and_unexpected_errors_get_stable_codes_and_exhaustion_ends_failed_and_visible(): void
    {
        config(['fuel_stations.settlement_job.max_attempts' => 3]);
        $shift = $this->closedShift('c2');
        $job = $this->jobFor($shift);
        $this->useHandler(function ($j, int $call) {
            throw match ($call) {
                1 => $this->deadlock(),
                2 => new \RuntimeException('secret detail that must never be stored'),
                default => $this->connectionLost(),
            };
        });

        $codes = [];
        foreach ([0, 61, 301] as $seconds) {
            $this->travel($seconds)->seconds();
            app(FuelShiftSettlementJobRunner::class)->run();
            $codes[] = $this->fresh($job)->last_error_code;
        }

        $job = $this->fresh($job);
        $this->assertSame(['deadlock', 'unexpected', 'connection_lost'], $codes);
        $this->assertSame('failed', $job->status);
        $this->assertSame(3, $job->attempts);
        $this->assertNotNull($job->completed_at);
        $this->assertStringNotContainsString('secret', json_encode($job->toArray()), 'نص الاستثناء لا يُخزَّن');
        $this->assertSame(0, app(FuelShiftSettlementJobRunner::class)->run()['claimed']);
    }

    /** @test */
    public function the_error_classifier_maps_known_database_failures_to_stable_codes(): void
    {
        $this->assertSame('deadlock', FuelShiftSettlementJobRunner::classify($this->deadlock()));
        $this->assertSame('connection_lost', FuelShiftSettlementJobRunner::classify($this->connectionLost()));
        $lockTimeout = new \PDOException('SQLSTATE[55P03]: Lock not available');
        $lockTimeout->errorInfo = ['55P03', 7, 'lock not available'];
        $this->assertSame('lock_timeout', FuelShiftSettlementJobRunner::classify(new QueryException('pgsql', 'x', [], $lockTimeout)));
        $this->assertSame('unexpected', FuelShiftSettlementJobRunner::classify(new \RuntimeException('anything')));
    }

    // ═══════════ 5) منع ازدواج التنفيذ ═══════════

    /** @test */
    public function two_runners_in_a_row_process_a_due_job_once(): void
    {
        $shift = $this->closedShift('d1');
        $this->useHandler(fn () => SettlementJobOutcome::awaitingEngine());

        $first = app(FuelShiftSettlementJobRunner::class)->run();
        $second = app(FuelShiftSettlementJobRunner::class)->run();

        $this->assertSame(1, $first['claimed']);
        $this->assertSame(0, $second['claimed'], 'بعد التقييم تنتظر موعد الفحص التالي ولا تُنفَّذ ثانيةً');
        $this->assertSame(1, $this->jobFor($shift)->checks);
    }

    // ═══════════ 6) العتبات (D-S3) ═══════════

    /** @test */
    public function alert_and_escalation_levels_follow_the_approved_two_and_twenty_four_hour_defaults(): void
    {
        $this->assertSame('none', FuelShiftSettlementPendingService::levelFor(119, 2, 24));
        $this->assertSame('alert', FuelShiftSettlementPendingService::levelFor(120, 2, 24));
        $this->assertSame('alert', FuelShiftSettlementPendingService::levelFor(1439, 2, 24));
        $this->assertSame('escalated', FuelShiftSettlementPendingService::levelFor(1440, 2, 24));
        // تعارض وراثي (تصعيد ≤ تنبيه): لا يسبق التصعيدُ التنبيهَ.
        $this->assertSame('none', FuelShiftSettlementPendingService::levelFor(179, 3, 1));
        $this->assertSame('escalated', FuelShiftSettlementPendingService::levelFor(180, 3, 1));
    }

    /** @test */
    public function the_pending_list_shows_reason_and_age_from_the_shift_close_and_honors_configured_thresholds(): void
    {
        $shift = $this->closedShift('t1');
        $lock = AccountingPeriodLock::create([
            'tenant_id' => $this->f['tenant_id'], 'start_date' => now()->subDays(30)->toDateString(), 'end_date' => now()->addDays(30)->toDateString(),
            'status' => 'active', 'reason' => 'إقفال',
        ]);
        app(FuelShiftSettlementJobRunner::class)->run();
        $pending = app(FuelShiftSettlementPendingService::class);

        $row = $pending->list()[0];
        $this->assertSame(['FUEL_SETTLEMENT_PERIOD_LOCKED'], $row['reasons']);
        $this->assertSame('none', $row['alert_level']);

        $this->travel(120)->minutes();
        $row = $pending->list()[0];
        $this->assertSame(120, $row['age_minutes']);
        $this->assertSame('alert', $row['alert_level']);

        $this->travel(1440 - 120)->minutes();
        $this->assertSame('escalated', $pending->list()[0]['alert_level']);

        // العتبتان قابلتان للضبط: تنبيه بعد ساعة وتصعيد بعد 3 ساعات.
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], [
            'shift_settlement_alert_after_hours' => 1, 'shift_settlement_escalation_after_hours' => 3,
        ], $this->f['actor'], 'عتبات');
        $this->assertSame('escalated', $pending->list()[0]['alert_level']);
        $lock->update(['status' => 'released']);
    }

    /** @test */
    public function threshold_settings_default_validate_and_stay_ordered(): void
    {
        $settings = app(FuelStationSettingsService::class);
        $effective = $settings->forStation($this->f['station']);
        $this->assertSame(2, $effective['shift_settlement_alert_after_hours']);
        $this->assertSame(24, $effective['shift_settlement_escalation_after_hours']);

        foreach ([[0, 24], [721, 24], [2, 0], [2, 2161], ['2', 24]] as [$alert, $escalation]) {
            $this->assertNotNull($this->rejects(fn () => $settings->putStationValues($this->f['station'], [
                'shift_settlement_alert_after_hours' => $alert, 'shift_settlement_escalation_after_hours' => $escalation,
            ], $this->f['actor'], 'x')), json_encode([$alert, $escalation]));
        }
        // التنبيه يسبق التصعيد دائماً (على القيم الفعّالة).
        $error = $this->rejects(fn () => $settings->putStationValues($this->f['station'], [
            'shift_settlement_alert_after_hours' => 30, 'shift_settlement_escalation_after_hours' => 30,
        ], $this->f['actor'], 'x'));
        $this->assertStringContainsString('FUEL_SETTLEMENT_THRESHOLDS_ORDER', (string) $error?->getMessage());
        $this->assertNotNull($this->rejects(fn () => $settings->putTenant(['shift_settlement_alert_after_hours' => 48], $this->f['actor'], 'x')), 'تنبيه 48 مقابل تصعيد 24');

        $settings->putStationValues($this->f['station'], ['shift_settlement_alert_after_hours' => 6, 'shift_settlement_escalation_after_hours' => 48], $this->f['actor'], 'ok');
        $this->assertSame(6, $settings->forStation($this->f['station'])['shift_settlement_alert_after_hours']);
        $this->assertSame(48, $settings->forStation($this->f['station'])['shift_settlement_escalation_after_hours']);
    }

    // ═══════════ 7) الصلاحية المحجوزة (D-S1) ═══════════

    /** @test */
    public function the_settlement_post_permission_is_reserved_to_owner_and_admin_only(): void
    {
        $this->assertContains('fuel.settlement.post', Rbac::PERMISSIONS);
        foreach (Rbac::MATRIX as $role => $permissions) {
            $this->assertNotContains('fuel.settlement.post', (array) $permissions, "الدور {$role}");
        }
        $this->assertContains('fuel.settlement.post', FuelStaffTemplates::RESERVED);
        foreach ([FuelStaffTemplates::SELLER, FuelStaffTemplates::SUPERVISOR, FuelStaffTemplates::STATION_MANAGER] as $template) {
            $this->assertNotContains('fuel.settlement.post', FuelStaffTemplates::permissions($template), "القالب {$template}");
        }
        $this->assertTrue($this->f['actor']->hasPermission('fuel.settlement.post'), 'owner عبر *');
        $this->assertFalse($this->f['seller']->hasPermission('fuel.settlement.post'));
        $this->assertFalse($this->f['supervisor']->hasPermission('fuel.settlement.post'));
    }

    // ═══════════ 8) حراس القاعدة ═══════════

    /** @test */
    public function database_guards_reject_invalid_values_identity_changes_deletes_and_changes_after_completion(): void
    {
        $shift = $this->closedShift('db1');
        $job = $this->jobFor($shift);
        $table = fn () => DB::table('fuel_shift_settlement_jobs')->where('id', $job->id);

        $this->assertNotNull($this->rejects(fn () => $table()->update(['status' => 'bogus'])), 'حالة غير صالحة');
        $this->assertNotNull($this->rejects(fn () => $table()->update(['last_outcome' => 'bogus'])), 'نتيجة غير صالحة');
        $this->assertNotNull($this->rejects(fn () => $table()->update(['attempts' => -1])), 'عدّاد سالب');
        $this->assertNotNull($this->rejects(fn () => $table()->update(['status' => 'running'])), 'running بلا قفل');
        $this->assertNotNull($this->rejects(fn () => $table()->update(['status' => 'completed'])), 'completed بلا completed_at');
        $this->assertNotNull($this->rejects(fn () => $table()->update(['fuel_shift_id' => (string) \Illuminate\Support\Str::uuid()])), 'هوية الوردية ثابتة');
        $this->assertNotNull($this->rejects(fn () => $table()->update(['tenant_id' => $this->f['foreign_tenant_id']])), 'هوية المستأجر ثابتة');
        $this->assertNotNull($this->rejects(fn () => $table()->delete()), 'لا حذف');

        // إدراج لمستأجر آخر بوردية هذا المستأجر مرفوض (اتساق الهوية).
        $this->assertNotNull($this->rejects(fn () => DB::table('fuel_shift_settlement_jobs')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $this->f['foreign_tenant_id'], 'branch_id' => $job->branch_id, 'fuel_station_id' => $job->fuel_station_id,
            'fuel_shift_id' => $shift->id, 'status' => 'queued', 'next_attempt_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ])), 'اتساق المستأجر مع الوردية');

        // completed نهائية.
        $table()->update(['status' => 'completed', 'completed_at' => now(), 'last_outcome' => 'disabled']);
        $this->assertNotNull($this->rejects(fn () => $table()->update(['status' => 'queued', 'completed_at' => null])), 'completed نهائية');
    }

    // ═══════════ 9) حراس معمارية: لا أثر محاسبي ولا كاتب ثانٍ ═══════════

    /** @test */
    public function the_job_layer_never_references_the_accounting_services_and_only_the_job_service_writes_the_table(): void
    {
        $layer = ['FuelShiftSettlementJobService', 'FuelShiftSettlementJobRunner', 'FuelShiftSettlementPrecheckHandler', 'FuelShiftSettlementPendingService'];
        foreach ($layer as $class) {
            $code = (string) file_get_contents(app_path("Services/{$class}.php"));
            foreach (['InvoiceService', 'PaymentService', 'LedgerService', 'InventoryService', 'FuelSaleService', 'FuelCostBasisService', 'ZatcaService', 'journal_entries', 'journal_lines', 'stock_movements'] as $forbidden) {
                $this->assertStringNotContainsString($forbidden, $code, "{$class} لا يمسّ {$forbidden}");
            }
        }
        foreach (['FuelShiftSettlementJobRunner', 'FuelShiftSettlementPrecheckHandler', 'FuelShiftSettlementPendingService'] as $reader) {
            $code = (string) file_get_contents(app_path("Services/{$reader}.php"));
            $this->assertStringNotContainsString('->update(', $code, "{$reader} لا يكتب على المهام");
            $this->assertStringNotContainsString('forceFill', $code, $reader);
        }
        $this->assertStringContainsString('SettlementJobHandler', (string) file_get_contents(app_path('Services/FuelShiftSettlementPrecheckHandler.php')));
        // لا كتابة خام على الجدول خارج الهجرة.
        foreach (glob(app_path('{Services,Http/Controllers/Api,Console/Commands}/*.php'), GLOB_BRACE) ?: [] as $file) {
            $this->assertStringNotContainsString("DB::table('fuel_shift_settlement_jobs')", (string) file_get_contents($file), basename($file));
        }
        // الإغلاق يستدعي التسجيل مرة واحدة فقط، ولا يستدعي طبقة التسوية الأخرى.
        $close = (string) file_get_contents(app_path('Services/FuelShiftService.php'));
        $this->assertSame(1, substr_count($close, 'FuelShiftSettlementJobService'));
        $this->assertSame(0, substr_count(str_replace('FuelShiftSettlementJobService', '', $close), 'FuelShiftSettlement'));
    }
}
