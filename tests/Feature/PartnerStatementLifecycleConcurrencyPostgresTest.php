<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementReconciliation;
use App\Models\PartnerStatementReconciliationEvent;
use App\Models\PartnerStatementReviewDecision;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\PartnerStatementImportService;
use App\Services\PartnerStatementLifecycleService;
use App\Services\PartnerStatementMatchService;
use App\Services\PartnerStatementReviewService;
use App\Support\PartnerStatementReviewException;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-PS-A3c — دورة الحالات تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): `review` المتزامن يُنشئ حدثاً واحداً والبقية تعاد؛ `reopen` المتزامن ينجح مرة واحدة؛ القرار مقابل `review`
 * لا يترك حالة `reviewed` ببند بلا قرار؛ `review` مقابل `reopen` يترك تسلسل أحداث بلا ثقوب وحالة تطابق آخر حدث؛ وترحيل الأستاذ لا يحجبه قفل المراجعة (يُرى بعد القفل فتُرفض المراجعة
 * `run_stale`). على SQLite يُتجاهل؛ غياب pcntl على PostgreSQL **فشل لا تخطٍّ**. تشغيل: php artisan test --filter=PartnerStatementLifecycleConcurrencyPostgresTest
 */
class PartnerStatementLifecycleConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $userId;

    private string $partnerId;

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'), 'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');

        $this->dir = sys_get_temp_dir().'/ps_a3c_race_'.uniqid();
        mkdir($this->dir);
        $auth = $this->registerTenant('ps-a3c-race-'.substr(md5((string) microtime(true)), 0, 8), 'ps'.uniqid().'@race-a3c.test');
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        $this->userId = (string) User::query()->where('tenant_id', $this->tenantId)->value('id');
        $this->partnerId = Partner::create(['type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل التزامن', 'is_active' => true])->id;
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir.'/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql' && isset($this->tenantId)) {
            try {
                DB::table('tenants')->where('id', $this->tenantId)->delete();
            } catch (QueryException) {
            }
        }
        parent::tearDown();
    }

    /**
     * مقارنة بسطرين وفاتورتين، تشغيلة، وقرار صريح لكل سطر **إن طُلب**.
     *
     * @return array{0: string, 1: string, 2: list<string>, 3: list<string>} [reconciliationId, runId, lineIds, unitKeys]
     */
    private function prepare(bool $resolve): array
    {
        $invoices = app(InvoiceService::class);
        $units = [];
        foreach ([100000, 20000] as $i => $price) {
            $invoice = $invoices->post($invoices->create(['partner_id' => $this->partnerId, 'payment_type' => 'credit', 'invoice_date' => '2026-09-0'.($i + 1)], [['quantity' => 1, 'unit_price' => $price, 'tax_rate' => 15]]));
            $units[] = 'invoice#'.$invoice->id;
        }
        $path = $this->dir.'/stmt.csv';
        file_put_contents($path, SpreadsheetWriter::csv(['التاريخ', 'رقم المستند', 'مدين', 'دائن'], [['2026-09-01', '', '', '1150.00'], ['2026-09-02', '', '', '230.00']]));
        $id = app(PartnerStatementImportService::class)->apply(
            new UploadedFile($path, 'stmt.csv', 'text/csv', null, true),
            ['partner_id' => $this->partnerId, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30'],
            $this->userId,
        )['reconciliation_id'];
        $user = User::query()->findOrFail($this->userId);
        auth()->setUser($user);
        $run = app(PartnerStatementMatchService::class)->run($user, $id);
        $lines = PartnerStatementLine::query()->where('reconciliation_id', $id)->orderBy('ordinal')->pluck('id')->all();
        if ($resolve) {
            foreach ($lines as $i => $lineId) {
                app(PartnerStatementReviewService::class)->decide($user, $id, ['run_id' => $run['id'], 'line_id' => $lineId, 'action' => 'override', 'unit_keys' => [$units[$i]], 'reason' => 'قرار صريح']);
            }
        }

        return [$id, $run['id'], $lines, $units];
    }

    /** @param callable(User): mixed $fn */
    private function job(callable $fn): callable
    {
        return function () use ($fn) {
            app(TenantContext::class)->set($this->tenantId);
            $user = User::query()->findOrFail($this->userId);
            auth()->setUser($user);

            return $fn($user);
        };
    }

    /** @param array<int, array<string, mixed>> $results @return list<mixed> */
    private function successes(array $results): array
    {
        return array_values(array_map(fn ($r) => $r['value'], array_filter($results, fn ($r) => ($r['ok'] ?? false) === true)));
    }

    /** @param array<int, array<string, mixed>> $results */
    private function assertOnlyDomainFailures(array $results): void
    {
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                $this->assertSame(PartnerStatementReviewException::class, $r['error_class'] ?? null, json_encode($r, JSON_UNESCAPED_UNICODE));
            }
        }
    }

    /** @return list<int> أرقام تسلسل أحداث المقارنة */
    private function seqs(string $id): array
    {
        app(TenantContext::class)->set($this->tenantId);

        return PartnerStatementReconciliationEvent::query()->where('reconciliation_id', $id)->orderBy('seq')->pluck('seq')->all();
    }

    private function rowStatus(string $id): string
    {
        app(TenantContext::class)->set($this->tenantId);

        return (string) PartnerStatementReconciliation::query()->findOrFail($id)->status;
    }

    /** @test */
    public function racing_reviews_of_the_same_run_create_one_event_and_replay_the_rest(): void
    {
        [$id, $runId] = $this->prepare(true);

        $jobs = array_fill(0, 6, $this->job(fn (User $u) => DB::transaction(function () use ($u, $id, $runId) {
            $r = app(PartnerStatementLifecycleService::class)->markReviewed($u, $id, $runId, null);
            usleep(60_000);

            return $r['replayed'];
        })));
        $results = $this->runConcurrently($jobs);

        $this->assertCount(6, $this->successes($results), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertCount(1, array_filter($this->successes($results), fn ($replayed) => $replayed === false), 'فائزٌ واحد فقط يُنشئ الحدث.');
        $this->assertSame([1], $this->seqs($id));
        $this->assertSame('reviewed', $this->rowStatus($id));
    }

    /** @test */
    public function racing_reopens_succeed_once_and_the_event_sequence_stays_gapless(): void
    {
        [$id, $runId] = $this->prepare(true);
        app(PartnerStatementLifecycleService::class)->markReviewed(User::query()->findOrFail($this->userId), $id, $runId, null);

        $jobs = array_fill(0, 4, $this->job(fn (User $u) => app(PartnerStatementLifecycleService::class)->reopen($u, $id, 'سباق إعادة الفتح') !== null));
        $results = $this->runConcurrently($jobs);

        $this->assertCount(1, $this->successes($results), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertOnlyDomainFailures($results);
        $this->assertSame([1, 2], $this->seqs($id));
        $this->assertSame('draft', $this->rowStatus($id));
    }

    /** @test */
    public function a_decision_racing_a_review_never_leaves_a_reviewed_reconciliation_with_an_undecided_line(): void
    {
        [$id, $runId, $lines, $units] = $this->prepare(false);
        $user = User::query()->findOrFail($this->userId);
        app(PartnerStatementReviewService::class)->decide($user, $id, ['run_id' => $runId, 'line_id' => $lines[0], 'action' => 'override', 'unit_keys' => [$units[0]], 'reason' => 'قرار صريح']);

        $decide = $this->job(fn (User $u) => DB::transaction(function () use ($u, $id, $runId, $lines, $units) {
            $r = app(PartnerStatementReviewService::class)->decide($u, $id, ['run_id' => $runId, 'line_id' => $lines[1], 'action' => 'override', 'unit_keys' => [$units[1]], 'reason' => 'قرار صريح']);
            usleep(80_000);

            return $r['replayed'];
        }));
        $review = $this->job(fn (User $u) => app(PartnerStatementLifecycleService::class)->markReviewed($u, $id, $runId, null)['replayed']);
        $results = $this->runConcurrently([$decide, $review, $review, $decide, $review]);

        $this->assertOnlyDomainFailures($results);
        app(TenantContext::class)->set($this->tenantId);
        if ($this->rowStatus($id) === 'reviewed') {
            $this->assertSame(2, count(app(PartnerStatementReviewService::class)->effectiveDecisions($id)), 'reviewed ⇒ كل بند له قرار فعّال.');
        }
        // أياً كان الترتيب: لا حدث مراجعة بلا قرارات مكتملة، وقراران فعّالان على الأكثر.
        $this->assertLessThanOrEqual(2, count(app(PartnerStatementReviewService::class)->effectiveDecisions($id)));
        $this->assertSame(array_keys($this->seqs($id)), array_map(fn ($seq) => $seq - 1, $this->seqs($id)), 'تسلسل بلا ثقوب.');
        // بعد انتهاء السباق تنجح المراجعة (أو هي تمّت): الحالة النهائية دائماً reviewed بعد محاولة أخيرة.
        if ($this->rowStatus($id) === 'draft') {
            app(PartnerStatementLifecycleService::class)->markReviewed($user, $id, $runId, null);
        }
        $this->assertSame('reviewed', $this->rowStatus($id));
    }

    /** @test */
    public function reviews_racing_a_reopen_leave_a_gapless_log_and_a_state_matching_the_last_event(): void
    {
        [$id, $runId] = $this->prepare(true);
        $user = User::query()->findOrFail($this->userId);
        app(PartnerStatementLifecycleService::class)->markReviewed($user, $id, $runId, null);

        $review = $this->job(fn (User $u) => app(PartnerStatementLifecycleService::class)->markReviewed($u, $id, $runId, null)['replayed']);
        $reopen = $this->job(fn (User $u) => app(PartnerStatementLifecycleService::class)->reopen($u, $id, 'سباق مع المراجعة') !== null);
        $results = $this->runConcurrently([$reopen, $review, $review, $review, $reopen]);

        $this->assertOnlyDomainFailures($results);
        $seqs = $this->seqs($id);
        $this->assertSame(range(1, count($seqs)), $seqs, 'تسلسل الأحداث بلا ثقوب ولا تكرار.');
        app(TenantContext::class)->set($this->tenantId);
        $last = PartnerStatementReconciliationEvent::query()->where('reconciliation_id', $id)->orderByDesc('seq')->first();
        $this->assertSame($last->to_status, $this->rowStatus($id), 'الحالة تطابق آخر حدث.');
    }

    /** @test */
    public function a_ledger_posting_is_not_blocked_by_the_review_lock_and_is_seen_after_the_lock_so_the_review_is_refused(): void
    {
        [$id, $runId] = $this->prepare(true);

        $holder = function () use ($id) {
            app(TenantContext::class)->set($this->tenantId);

            return DB::transaction(function () use ($id) {
                DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['partner-statement-review:'.$this->tenantId.':'.$id]);
                usleep(1_600_000);

                return 'held';
            });
        };
        $reviewer = $this->job(function (User $u) use ($id, $runId) {
            usleep(150_000);

            return app(PartnerStatementLifecycleService::class)->markReviewed($u, $id, $runId, null)['replayed'];
        });
        $poster = $this->job(function (User $u) {
            usleep(700_000);
            $invoices = app(InvoiceService::class);

            return $invoices->post($invoices->create(['partner_id' => $this->partnerId, 'payment_type' => 'credit', 'invoice_date' => '2026-09-20'], [['quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 15]]))->id !== null;
        });

        $results = $this->runConcurrently([$holder, $reviewer, $poster]);

        $this->assertTrue($results[0]['ok'] ?? false, json_encode($results[0], JSON_UNESCAPED_UNICODE));
        $this->assertTrue($results[2]['ok'] ?? false, 'الترحيل التزم أثناء القفل — قفل المراجعة لا يحمي الأستاذ ولا يحجبه: '.json_encode($results[2], JSON_UNESCAPED_UNICODE));
        $this->assertFalse($results[1]['ok'] ?? true, 'المراجعة يجب أن تُرفض: '.json_encode($results[1], JSON_UNESCAPED_UNICODE));
        $this->assertSame(PartnerStatementReviewException::class, $results[1]['error_class'] ?? null);
        $this->assertSame('draft', $this->rowStatus($id));
        $this->assertSame([], $this->seqs($id));
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
                DB::connection()->getPdo();
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
            $results[$i] = json_decode(is_file($file) ? (string) file_get_contents($file) : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
