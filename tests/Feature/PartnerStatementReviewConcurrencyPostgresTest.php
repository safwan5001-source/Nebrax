<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementReviewDecision;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\PartnerStatementImportService;
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
 * IMP-PS-A3a — مراجعة نتائج المطابقة تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): وحدة واحدة يتسابق عليها عدة أسطر ⇒ فائز واحد والبقية `unit_already_decided` بلا خطأ قاعدة؛
 * طلبات متطابقة ⇒ نسخة واحدة والبقية `replayed`؛ قرارات مختلفة لسطر واحد ⇒ نسخ متسلسلة بلا ثقوب؛ أسطر ووحدات مختلفة ⇒ كلها تنجح (لا حجب كاذب). على SQLite يُتجاهل؛
 * غياب pcntl على PostgreSQL **فشل لا تخطٍّ**. تشغيل: php artisan test --filter=PartnerStatementReviewConcurrencyPostgresTest
 */
class PartnerStatementReviewConcurrencyPostgresTest extends TestCase
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

        $this->dir = sys_get_temp_dir().'/ps_a3a_race_'.uniqid();
        mkdir($this->dir);
        $auth = $this->registerTenant('ps-a3a-race-'.substr(md5((string) microtime(true)), 0, 8), 'ps'.uniqid().'@race-a3a.test');
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

    /** @param list<int> $unitPrices أسعار فواتير آجلة (هللات قبل الضريبة) @param list<string> $credits سطور الكشف الدائنة @return array{0: string, 1: string, 2: list<string>, 3: list<string>} */
    private function prepare(array $unitPrices, array $credits): array
    {
        $invoices = app(InvoiceService::class);
        $units = [];
        foreach ($unitPrices as $i => $price) {
            $invoice = $invoices->post($invoices->create(['partner_id' => $this->partnerId, 'payment_type' => 'credit', 'invoice_date' => '2026-09-0'.($i + 1)], [['quantity' => 1, 'unit_price' => $price, 'tax_rate' => 15]]));
            $units[] = 'invoice#'.$invoice->id;
        }
        $path = $this->dir.'/stmt.csv';
        file_put_contents($path, SpreadsheetWriter::csv(['التاريخ', 'رقم المستند', 'مدين', 'دائن'], array_map(fn (string $c): array => ['2026-09-20', '', '', $c], $credits)));
        $id = app(PartnerStatementImportService::class)->apply(
            new UploadedFile($path, 'stmt.csv', 'text/csv', null, true),
            ['partner_id' => $this->partnerId, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30'],
            $this->userId,
        )['reconciliation_id'];
        auth()->setUser(User::query()->findOrFail($this->userId));
        $run = app(PartnerStatementMatchService::class)->run(User::query()->findOrFail($this->userId), $id);
        $lines = PartnerStatementLine::query()->where('reconciliation_id', $id)->orderBy('ordinal')->pluck('id')->all();

        return [$id, $run['id'], $units, $lines];
    }

    /** @param array<string, mixed> $payload */
    private function decideJob(string $reconciliationId, array $payload): callable
    {
        return function () use ($reconciliationId, $payload) {
            app(TenantContext::class)->set($this->tenantId);
            $user = User::query()->findOrFail($this->userId);
            auth()->setUser($user);

            // نافذة المعاملة عريضة عمداً ليتداخل المتسابقون فعلاً.
            return DB::transaction(function () use ($user, $reconciliationId, $payload) {
                $result = app(PartnerStatementReviewService::class)->decide($user, $reconciliationId, $payload);
                usleep(60_000);

                return ['revision' => $result['decision']['revision'] ?? null, 'replayed' => $result['replayed']];
            });
        };
    }

    /** @param array<int, array<string, mixed>> $results @return list<array<string, mixed>> */
    private function successes(array $results): array
    {
        return array_values(array_map(fn ($r) => $r['value'], array_filter($results, fn ($r) => ($r['ok'] ?? false) === true)));
    }

    /** @param array<int, array<string, mixed>> $results @return list<array<string, mixed>> */
    private function failures(array $results): array
    {
        return array_values(array_filter($results, fn ($r) => ($r['ok'] ?? false) !== true));
    }

    /** @test */
    public function several_lines_racing_for_one_unit_yield_one_winner_and_clean_refusals(): void
    {
        [$id, $runId, $units, $lines] = $this->prepare([100000], ['1150.00', '1150.00', '1150.00']);

        $jobs = [];
        foreach (range(0, 5) as $i) {
            $jobs[] = $this->decideJob($id, ['run_id' => $runId, 'line_id' => $lines[$i % 3], 'action' => 'override', 'unit_keys' => [$units[0]], 'reason' => 'سباق الوحدة']);
        }
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($this->tenantId);
        $this->assertSame(1, PartnerStatementReviewDecision::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        // المحاولات على سطر الفائز نفسه (متطابقة) تُعاد replayed أو تنجح؛ على الأسطر الأخرى تُرفض بـunit_already_decided. لا خطأ قاعدة إطلاقاً.
        foreach ($this->failures($results) as $failure) {
            $this->assertSame(PartnerStatementReviewException::class, $failure['error_class'] ?? null, json_encode($failure, JSON_UNESCAPED_UNICODE));
        }
        $created = array_filter($this->successes($results), fn ($v) => $v['replayed'] === false);
        $this->assertCount(1, $created, 'فائزٌ واحد فقط يُنشئ.');
        $winnerLine = PartnerStatementReviewDecision::query()->value('line_id');
        $this->assertContains($winnerLine, $lines);
    }

    /** @test */
    public function identical_racing_requests_create_one_revision_and_replay_the_rest(): void
    {
        [$id, $runId, $units, $lines] = $this->prepare([100000], ['1150.00']);

        $jobs = array_fill(0, 6, $this->decideJob($id, ['run_id' => $runId, 'line_id' => $lines[0], 'action' => 'override', 'unit_keys' => [$units[0]], 'reason' => 'طلب متطابق']));
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($this->tenantId);
        $this->assertCount(6, $this->successes($results), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(1, PartnerStatementReviewDecision::query()->count());
        $this->assertCount(1, array_filter($this->successes($results), fn ($v) => $v['replayed'] === false));
    }

    /** @test */
    public function different_decisions_racing_on_one_line_get_gapless_linear_revisions(): void
    {
        [$id, $runId, $units, $lines] = $this->prepare([10000, 20000, 30000, 40000], ['1150.00']);

        $jobs = [];
        foreach ($units as $i => $unit) {
            $jobs[] = $this->decideJob($id, ['run_id' => $runId, 'line_id' => $lines[0], 'action' => 'override', 'unit_keys' => [$unit], 'reason' => 'سباق النسخ '.$i, 'accept_difference' => true]);
        }
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($this->tenantId);
        $this->assertCount(4, $this->successes($results), json_encode($results, JSON_UNESCAPED_UNICODE));
        $revisions = PartnerStatementReviewDecision::query()->where('line_id', $lines[0])->orderBy('revision')->pluck('revision')->all();
        $this->assertSame([1, 2, 3, 4], $revisions, 'نسخ متسلسلة بلا ثقوب ولا تكرار.');
    }

    /** @test */
    public function distinct_lines_and_units_all_succeed_without_false_blocking(): void
    {
        [$id, $runId, $units, $lines] = $this->prepare([10000, 20000, 30000], ['115.00', '230.00', '345.00']);

        $jobs = [];
        foreach ($lines as $i => $lineId) {
            $jobs[] = $this->decideJob($id, ['run_id' => $runId, 'line_id' => $lineId, 'action' => 'override', 'unit_keys' => [$units[$i]], 'reason' => 'أسطر مستقلة']);
        }
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($this->tenantId);
        $this->assertCount(3, $this->successes($results), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(3, PartnerStatementReviewDecision::query()->count());
        $this->assertCount(3, array_filter($this->successes($results), fn ($v) => $v['replayed'] === false));
    }

    /**
     * Codex #1915 P2: ترحيل/عكس يُثبَّت **أثناء انتظار** قفل المراجعة لا يُتجاوز بلقطة سابقة للقفل. ثلاثة عمليات متزامنة: ماسك للقفل نفسه (1.6 ث)، ومراجِع يبدأ فوراً
     * ويقف على القفل، وعاكس يعكس فاتورة الوحدة المختارة ويلتزم أثناء الانتظار ⇒ المراجِع يرى الدفتر بعد القفل فيُرفض `run_stale` ولا يُسجَّل قرار على وحدة معكوسة.
     *
     * @test
     */
    public function a_reversal_committed_while_the_review_waits_for_the_lock_makes_the_decision_stale(): void
    {
        [$id, $runId, $units, $lines] = $this->prepare([100000], ['1150.00']);
        $invoiceId = substr($units[0], strlen('invoice#'));

        $holder = function () use ($id) {
            app(TenantContext::class)->set($this->tenantId);

            return DB::transaction(function () use ($id) {
                DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['partner-statement-review:'.$this->tenantId.':'.$id]);
                usleep(1_600_000);

                return 'held';
            });
        };
        $reviewer = function () use ($id, $runId, $lines, $units) {
            app(TenantContext::class)->set($this->tenantId);
            $user = User::query()->findOrFail($this->userId);
            auth()->setUser($user);
            usleep(150_000);

            return app(PartnerStatementReviewService::class)->decide($user, $id, ['run_id' => $runId, 'line_id' => $lines[0], 'action' => 'override', 'unit_keys' => [$units[0]], 'reason' => 'أثناء الانتظار'])['replayed'];
        };
        $reverser = function () use ($invoiceId) {
            app(TenantContext::class)->set($this->tenantId);
            auth()->setUser(User::query()->findOrFail($this->userId));
            usleep(700_000);
            $entry = JournalEntry::query()->where('source_type', Invoice::class)->where('source_id', $invoiceId)->firstOrFail();

            return app(LedgerService::class)->reverse($entry, '2026-09-06', 'إلغاء أثناء المراجعة')->id;
        };

        $results = $this->runConcurrently([$holder, $reviewer, $reverser]);

        app(TenantContext::class)->set($this->tenantId);
        $this->assertTrue($results[0]['ok'] ?? false, json_encode($results[0], JSON_UNESCAPED_UNICODE));
        $this->assertTrue($results[2]['ok'] ?? false, 'العكس التزم: '.json_encode($results[2], JSON_UNESCAPED_UNICODE));
        $this->assertFalse($results[1]['ok'] ?? true, 'المراجِع يجب أن يُرفض: '.json_encode($results[1], JSON_UNESCAPED_UNICODE));
        $this->assertSame(PartnerStatementReviewException::class, $results[1]['error_class'] ?? null, json_encode($results[1], JSON_UNESCAPED_UNICODE));
        $this->assertSame(0, PartnerStatementReviewDecision::query()->count(), 'لا قرار على وحدة معكوسة.');
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
