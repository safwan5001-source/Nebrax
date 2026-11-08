<?php

namespace Tests\Feature;

use App\Models\FuelShift;
use App\Models\FuelShiftSettlementJob;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use App\Services\FuelShiftSettlementJobService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelStationWalkInPartnerService;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * P1-3b-1 — منع ازدواج التنفيذ والتسجيل واسترداد المهمة بعد سقوط العامل، على PostgreSQL حقيقي وبعمليات فعلية (`pcntl_fork`).
 *
 * يكمّل `FuelShiftSettlementJobTest` (حتمي، على المحرّكين) بطبقة تزاحم حقيقي:
 *  1) N عاملاً يتسابقون على مهمة واحدة ⇒ واحد فقط يظفر بالإيجار.
 *  2) N عاملاً على M مهمة ⇒ كل مهمة تُطالَب مرة واحدة بالضبط ولا يتكرر عاملٌ على مهمتين من الدفعة نفسها بلا حاجة.
 *  3) عامل يموت فجأة (`SIGKILL`) وهو حامل الإيجار ⇒ عاملٌ آخر يستردّها بعد انتهائه، ويُحسب الاسترداد محاولة فاشلة، والعامل الميت لو استيقظ لا يكتب نتيجته (الحاجز).
 *  4) N عمليات تسجّل المهمة لوردية واحدة معاً ⇒ صف واحد.
 * لا أثر محاسبي في أي منها (تُعدّ جداول الأثر قبل وبعد). يُتخطّى على SQLite؛ على PostgreSQL غياب `pcntl` فشل لا تخطٍّ.
 */
class FuelShiftSettlementJobPostgresTest extends TestCase
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
        $this->dir = sys_get_temp_dir().'/fuel_settlement_jobs_'.uniqid();
        mkdir($this->dir);

        config([
            'fuel_stations.shift_settlement_enabled' => true,
            'fuel_stations.shift_settlement_tax_opinion_ref' => 'TAX-OPINION-TEST-JOBS-PG',
            'fuel_stations.shift_collection_declaration_enabled' => true,
            'fuel_stations.shift_cash_receipts_enabled' => true,
        ]);
        $this->f = $this->fixture('pgjobs');
        $this->tenants[] = $this->f['tenant_id'];
        $this->tenants[] = $this->f['foreign_tenant_id'];
        $this->setBasis('declared_collection');
        app(FuelStationWalkInPartnerService::class)->assign($this->f['station'], $this->f['actor']);
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل اختبار');
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

    // ───────── مساعدات ─────────

    private function closedShift(string $key, int $openingMeter): FuelShift
    {
        $shift = $this->open($key);
        foreach (['opening' => $openingMeter, 'closing' => $openingMeter + 20_000] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "pgjob-{$shift->id}-{$stage}",
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

    /** @return array<string,int> */
    private function writeCounts(): array
    {
        $tables = ['invoices', 'invoice_lines', 'journal_entries', 'journal_lines', 'payments', 'payment_allocations', 'stock_movements', 'fuel_sales',
            'fuel_sale_payment_receipts', 'fuel_inventory_cost_movements', 'fuel_operational_ledgers', 'fuel_shift_settlements', 'zatca_chain_entries'];

        return collect($tables)->mapWithKeys(fn ($t) => [$t => DB::table($t)->count()])->all();
    }

    private function row(string $jobId): object
    {
        return DB::table('fuel_shift_settlement_jobs')->where('id', $jobId)->first();
    }

    /**
     * يشغّل كل مهمة في عملية فرعية منفصلة بعد حاجز مشترك ويعيد نتائجها المرتَّبة (ok/value أو error).
     *
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

    // ───────── 1) سباق على مهمة واحدة ─────────

    #[Test]
    public function many_workers_racing_for_one_job_yield_exactly_one_claim(): void
    {
        $shift = $this->closedShift('race1', 2_000_000);
        $job = FuelShiftSettlementJob::query()->withoutGlobalScopes()->where('fuel_shift_id', $shift->id)->firstOrFail();
        DB::table('fuel_shift_settlement_jobs')->where('id', $job->id)->update(['next_attempt_at' => now()->subMinute()]);
        $before = $this->writeCounts();

        $jobs = [];
        foreach (range(1, 8) as $n) {
            $jobs[] = fn () => app(FuelShiftSettlementJobService::class)->claimNext("worker-{$n}", 300)?->id;
        }
        $results = $this->concurrently($jobs);

        $this->assertSame([], array_values(array_filter($results, fn ($r) => ! $r['ok'])), 'لا استثناءات: الخاسرون يرون null لا خطأ');
        $claims = array_values(array_filter(array_map(fn ($r) => $r['value'], $results)));
        $this->assertSame([$job->id], $claims, 'مطالبة واحدة بالضبط');

        $row = $this->row($job->id);
        $this->assertSame('running', $row->status);
        $this->assertSame(0, (int) $row->attempts, 'مطالبة أولى لا تحتسب محاولة فاشلة');
        $this->assertStringStartsWith('worker-', $row->locked_by);
        $this->assertSame($before, $this->writeCounts(), 'لا أثر محاسبي أو مخزني');
    }

    // ───────── 2) عمال على عدة مهام ─────────

    #[Test]
    public function many_workers_over_several_jobs_claim_each_job_exactly_once(): void
    {
        $ids = [];
        foreach ([3_000_000, 4_000_000, 5_000_000] as $i => $meter) {
            $shift = $this->closedShift("multi{$i}", $meter);
            $ids[] = FuelShiftSettlementJob::query()->withoutGlobalScopes()->where('fuel_shift_id', $shift->id)->firstOrFail()->id;
        }
        DB::table('fuel_shift_settlement_jobs')->whereIn('id', $ids)->update(['next_attempt_at' => now()->subMinute()]);

        $jobs = [];
        foreach (range(1, 6) as $n) {
            $jobs[] = fn () => app(FuelShiftSettlementJobService::class)->claimNext("multi-{$n}", 300)?->id;
        }
        $results = $this->concurrently($jobs);

        $this->assertSame([], array_values(array_filter($results, fn ($r) => ! $r['ok'])));
        $claimed = array_values(array_filter(array_map(fn ($r) => $r['value'], $results)));
        $this->assertCount(count($claimed), array_unique($claimed), 'لا مهمة تُطالَب مرتين');
        foreach ($claimed as $id) {
            $this->assertContains($id, $ids);
        }
        $running = DB::table('fuel_shift_settlement_jobs')->whereIn('id', $ids)->where('status', 'running')->count();
        $this->assertSame(count($claimed), $running, 'كل مطالبة ناجحة تقابل مهمة running واحدة');
        $this->assertGreaterThanOrEqual(1, $running);
        $this->assertSame(0, (int) DB::table('fuel_shift_settlement_jobs')->whereIn('id', $ids)->sum('attempts'));
    }

    // ───────── 3) سقوط العامل فعلياً ─────────

    #[Test]
    public function a_worker_killed_while_holding_the_lease_is_recovered_and_its_stale_result_is_fenced_out(): void
    {
        $shift = $this->closedShift('crash1', 6_000_000);
        $job = FuelShiftSettlementJob::query()->withoutGlobalScopes()->where('fuel_shift_id', $shift->id)->firstOrFail();
        DB::table('fuel_shift_settlement_jobs')->where('id', $job->id)->update(['next_attempt_at' => now()->subMinute()]);
        $before = $this->writeCounts();

        // العامل الأول يطالب بإيجار قصير (1 ث) ثم يُقتل بلا أي إنهاء.
        $pid = pcntl_fork();
        $this->assertNotSame(-1, $pid);
        if ($pid === 0) {
            DB::purge(config('database.default'));
            $claimed = app(FuelShiftSettlementJobService::class)->claimNext('dead-worker', 1);
            file_put_contents($this->dir.'/claimed', $claimed?->id ?? 'none');
            posix_kill(getmypid(), SIGKILL);
            exit(1);
        }
        pcntl_waitpid($pid, $status);
        $this->assertTrue(pcntl_wifsignaled($status), 'العامل أُنهي بإشارة لا بخروج عادي');
        $this->assertSame($job->id, file_get_contents($this->dir.'/claimed'));

        $service = app(FuelShiftSettlementJobService::class);
        $this->assertSame('running', $this->row($job->id)->status, 'مهمة عالقة running ما دام الإيجار لم ينتهِ');
        $this->assertNull($service->claimNext('early-worker', 300), 'قبل انتهاء الإيجار لا يستردّها أحد');

        sleep(2); // انتهاء الإيجار
        $recovered = $service->claimNext('rescuer', 300);
        $this->assertNotNull($recovered, 'عاملٌ آخر يستردّ المهمة بعد انتهاء الإيجار');
        $this->assertSame($job->id, $recovered->id);
        $row = $this->row($job->id);
        $this->assertSame('rescuer', $row->locked_by);
        $this->assertSame(1, (int) $row->attempts, 'الاسترداد بعد سقوط عامل يُحسب محاولة فاشلة');

        // الزومبي: لو استيقظ العامل الميت وحاول كتابة نتيجته فالحاجز يرفض.
        $stale = FuelShiftSettlementJob::query()->withoutGlobalScopes()->findOrFail($job->id);
        $this->assertFalse($service->record($stale, 'dead-worker', \App\Support\SettlementJobOutcome::blocked(['FUEL_SETTLEMENT_PERIOD_LOCKED'])));
        $this->assertFalse($service->recordError($stale, 'dead-worker', 'connection_lost'));
        $this->assertSame('rescuer', $this->row($job->id)->locked_by, 'إيجار المنقذ سليم');

        // المنقذ يُنهي بنجاح فتعود المهمة للطابور (محجوب) بلا استهلاك إضافي لميزانية الإعادة.
        $this->assertTrue($service->record($recovered, 'rescuer', \App\Support\SettlementJobOutcome::blocked(['FUEL_SETTLEMENT_PERIOD_LOCKED'])));
        $final = $this->row($job->id);
        $this->assertSame('queued', $final->status);
        $this->assertSame(1, (int) $final->attempts);
        $this->assertSame($before, $this->writeCounts(), 'لا أثر محاسبي أو مخزني');
    }

    // ───────── 4) تسجيل متزامن ─────────

    #[Test]
    public function concurrent_registration_for_one_shift_creates_exactly_one_job(): void
    {
        // وردية أُغلقت والبوابة مغلقة ⇒ بلا مهمة؛ ثم تُفتح البوابة ويتسابق المسجِّلون.
        config(['fuel_stations.shift_settlement_enabled' => false]);
        $shift = $this->closedShift('enq1', 7_000_000);
        $this->assertSame(0, DB::table('fuel_shift_settlement_jobs')->where('fuel_shift_id', $shift->id)->count());
        config(['fuel_stations.shift_settlement_enabled' => true]);
        $before = $this->writeCounts();

        $jobs = [];
        foreach (range(1, 8) as $n) {
            $jobs[] = fn () => app(FuelShiftSettlementJobService::class)->enqueue(FuelShift::query()->findOrFail($shift->id))->id;
        }
        $results = $this->concurrently($jobs);

        $this->assertSame([], array_values(array_filter($results, fn ($r) => ! $r['ok'])), 'الخاسرون يعيدون الصف الفائز لا خطأ');
        $this->assertCount(1, array_unique(array_map(fn ($r) => $r['value'], $results)), 'الجميع يعيدون المهمة نفسها');
        $this->assertSame(1, DB::table('fuel_shift_settlement_jobs')->where('fuel_shift_id', $shift->id)->count());
        $this->assertSame($before, $this->writeCounts(), 'لا أثر محاسبي أو مخزني');
    }
}
