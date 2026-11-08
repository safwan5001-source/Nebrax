<?php

namespace Tests\Feature;

use App\Models\AccountingPeriodLock;
use App\Models\FuelShift;
use App\Models\FuelShiftSettlementJob;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use App\Services\FuelShiftSettlementEngineHandler;
use App\Services\FuelShiftSettlementJobRunner;
use App\Services\FuelShiftSettlementJobService;
use App\Services\FuelShiftSettlementPostingService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelStationWalkInPartnerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

/**
 * P1-3b-2d — توصيل المحرك بمعالج المهمة: الإنهاء الذرّي مع الترحيل، حاجز الإيجار، الفاعل = من أغلق الوردية، وعدم تفعيل المحرك ما لم يُعلَن التفصيل `per_nozzle`.
 * بيئة معزولة وبيانات اختبار؛ لا مستأجر حقيقي.
 */
class FuelShiftSettlementEngineJobTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'fuel_stations.shift_settlement_enabled' => true,
            'fuel_stations.shift_settlement_tax_opinion_ref' => 'TAX-OPINION-TEST-ENGINE-JOBS',
            'fuel_stations.shift_settlement_invoice_granularity' => 'per_nozzle',
            'fuel_stations.shift_collection_declaration_enabled' => true,
            'fuel_stations.shift_cash_receipts_enabled' => true,
        ]);
        $this->f = $this->fixture();
        $this->setBasis('declared_collection');
        app(FuelStationWalkInPartnerService::class)->assign($this->f['station'], $this->f['actor']);
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل اختبار');
        $this->travel(3)->seconds();
        $this->app->forgetInstance(FuelShiftSettlementJobRunner::class);
    }

    private function closedShift(string $key, int $openingMeter = 1_000_000): FuelShift
    {
        $shift = $this->open($key);
        foreach (['opening' => $openingMeter, 'closing' => $openingMeter + 20_000] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "ej-{$shift->id}-{$stage}",
            ], $this->f['actor']);
        }
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => $shift->id.'decl', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 4600], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
        ], $this->f['actor']);

        return app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + 4600, null, $this->f['actor']);
    }

    private function jobOf(FuelShift $shift): FuelShiftSettlementJob
    {
        return FuelShiftSettlementJob::query()->withoutGlobalScopes()->where('fuel_shift_id', $shift->id)->firstOrFail();
    }

    /** @return array<string,int> */
    private function counts(): array
    {
        return collect(['invoices', 'journal_entries', 'payments', 'stock_movements', 'fuel_sales', 'fuel_shift_settlements', 'fuel_shift_settlement_collections', 'zatca_chain_entries'])
            ->mapWithKeys(fn ($t) => [$t => DB::table($t)->count()])->all();
    }

    /** @test */
    public function closing_then_running_the_worker_posts_the_settlement_and_completes_the_job_atomically(): void
    {
        $shift = $this->closedShift('j1');
        $job = $this->jobOf($shift);
        $this->assertSame('queued', $job->status);
        $before = $this->counts();

        $summary = app(FuelShiftSettlementJobRunner::class)->run();

        $this->assertSame(1, $summary['claimed']);
        $this->assertSame(1, $summary['posted']);
        $job = $this->jobOf($shift);
        $this->assertSame('completed', $job->status);
        $this->assertSame('posted', $job->last_outcome);
        $this->assertNull($job->locked_by);
        $after = $this->counts();
        $this->assertSame($before['fuel_shift_settlements'] + 1, $after['fuel_shift_settlements']);
        $this->assertSame($before['invoices'] + 1, $after['invoices']);
        $this->assertSame($before['payments'] + 1, $after['payments']);
        $this->assertSame(0, app(FuelShiftSettlementJobRunner::class)->run()['claimed'], 'المهمة المنتهية لا تُطالَب ثانيةً');
        $this->assertSame($after, $this->counts());
    }

    /** @test */
    public function the_engine_handler_is_used_only_when_the_granularity_is_declared(): void
    {
        config(['fuel_stations.shift_settlement_invoice_granularity' => '']);
        $shift = $this->closedShift('j2');
        $this->app->forgetInstance(FuelShiftSettlementJobRunner::class);
        $before = $this->counts();

        $summary = app(FuelShiftSettlementJobRunner::class)->run();

        $this->assertSame(1, $summary['awaiting_engine'], 'بلا إعلان التفصيل يبقى المعالج الخامل');
        $this->assertSame(0, $summary['posted']);
        $this->assertSame($before, $this->counts());
        $this->assertSame('queued', $this->jobOf($shift)->status);
    }

    /** @test */
    public function a_locked_period_blocks_the_job_without_any_write_and_it_posts_after_the_period_opens(): void
    {
        $shift = $this->closedShift('j3');
        $lock = AccountingPeriodLock::create([
            'tenant_id' => $this->f['tenant_id'], 'start_date' => now()->subDays(30)->toDateString(), 'end_date' => now()->addDays(30)->toDateString(),
            'status' => 'active', 'reason' => 'إقفال',
        ]);
        $before = $this->counts();

        $summary = app(FuelShiftSettlementJobRunner::class)->run();

        $this->assertSame(1, $summary['blocked']);
        $job = $this->jobOf($shift);
        $this->assertSame('queued', $job->status);
        $this->assertSame('blocked', $job->last_outcome);
        $this->assertContains('FUEL_SETTLEMENT_PERIOD_LOCKED', $job->blocked_reasons);
        $this->assertSame($before, $this->counts());

        $lock->update(['status' => 'released']);
        DB::table('fuel_shift_settlement_jobs')->where('id', $job->id)->update(['next_attempt_at' => now()->subMinute()]);
        $this->assertSame(1, app(FuelShiftSettlementJobRunner::class)->run()['posted']);
        $this->assertSame('completed', $this->jobOf($shift)->status);
    }

    /** @test */
    public function a_zombie_that_lost_its_lease_writes_nothing(): void
    {
        $shift = $this->closedShift('j4');
        $jobs = app(FuelShiftSettlementJobService::class);
        $job = $jobs->claimNext('worker-old');
        $this->assertNotNull($job);
        // عامل آخر استردّ المهمة بعد انتهاء إيجار الأول.
        DB::table('fuel_shift_settlement_jobs')->where('id', $job->id)->update(['locked_by' => 'worker-new']);
        $before = $this->counts();

        $e = $this->thrown(fn () => app(FuelShiftSettlementEngineHandler::class)->handle($job), 'الزومبي يفشل', RuntimeException::class);

        $this->assertStringContainsString('FUEL_SETTLEMENT_JOB_LEASE_LOST', $e->getMessage());
        $this->assertSame($before, $this->counts(), 'تراجع كامل: لا تسوية ولا فاتورة ولا سند');
        $this->assertSame('running', $this->jobOf($shift)->status, 'المهمة بيد العامل الجديد');
    }

    /** @test */
    public function a_worker_killed_after_the_engine_committed_is_recovered_by_a_replay_without_duplicates(): void
    {
        $shift = $this->closedShift('j5');
        // محاكاة: الترحيل التزم لكن العامل سقط قبل تسجيل نتيجة المهمة (المهمة ما زالت queued).
        $this->assertSame('posted', app(FuelShiftSettlementPostingService::class)->post($shift, $this->f['actor'])->outcome);
        $afterPost = $this->counts();
        $this->assertSame('queued', $this->jobOf($shift)->status);

        $summary = app(FuelShiftSettlementJobRunner::class)->run();

        $this->assertSame(1, $summary['posted']);
        $this->assertSame('completed', $this->jobOf($shift)->status);
        $this->assertSame($afterPost, $this->counts(), 'إعادة بلا أي أثر جديد');
    }

    /** @test */
    public function a_closer_who_is_no_longer_active_blocks_the_job_without_posting_under_another_identity(): void
    {
        $shift = $this->closedShift('j6');
        DB::table('users')->where('id', $this->f['actor']->id)->update(['is_active' => false]);
        $before = $this->counts();

        $summary = app(FuelShiftSettlementJobRunner::class)->run();

        $this->assertSame(1, $summary['blocked']);
        $this->assertSame(['FUEL_SETTLEMENT_ACTOR_UNAVAILABLE'], $this->jobOf($shift)->blocked_reasons);
        $this->assertSame($before, $this->counts());
    }
}
