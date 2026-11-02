<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementReconciliation;
use App\Models\PartnerStatementReconciliationEvent;
use App\Models\PartnerStatementUnitClaim;
use App\Models\Role;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\PartnerStatementClaimService;
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
 * IMP-PS-A3d — الإغلاق النهائي تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): إغلاقان متزامنان لمقارنة واحدة ⇒ حدث واحد والباقي replay؛ نهائيان متداخلان يتشاركان حركة ⇒ فائز واحد والخاسر `unit_conflict`
 * (بلا أخطاء قاعدة بيانات)؛ نهائيان منفصلا الحركات ⇒ ينجحان معاً (لا حجب كاذب)؛ إغلاق مقابل إعادة فتح ⇒ حالة نهائية متسقة؛ **ترحيل أستاذ جارٍ لا يفوت الإغلاقَ** (الإغلاق ينتظر مِرساة المستأجر ثم يرى القيد فتُرفض
 * التشغيلة `run_stale`)؛ وقفل المِرساة نفسه الذي يأخذه الإغلاق يحجب `LedgerService` فعلاً. على SQLite يُتجاهل؛ غياب pcntl على PostgreSQL **فشل لا تخطٍّ**.
 * تشغيل: php artisan test --filter=PartnerStatementCloseConcurrencyPostgresTest
 */
class PartnerStatementCloseConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $ownerId;

    /** @var list<string> */
    private array $closerIds = [];

    private string $partnerId;

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'), 'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');

        $this->dir = sys_get_temp_dir().'/ps_a3d_race_'.uniqid();
        mkdir($this->dir);
        $auth = $this->registerTenant('ps-a3d-race-'.substr(md5((string) microtime(true)), 0, 8), 'ps'.uniqid().'@race-a3d.test');
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        $this->ownerId = (string) User::query()->where('tenant_id', $this->tenantId)->value('id');
        $this->partnerId = Partner::create(['type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل التزامن', 'is_active' => true])->id;
        Role::create(['slug' => 'ps-race-closer', 'name' => 'ps-race-closer', 'permissions' => ['partner_statements.view', 'partner_statements.close', 'partners.view'], 'is_system' => false]);
        foreach (['a', 'b', 'c'] as $suffix) {
            $this->closerIds[] = (string) User::create([
                'tenant_id' => $this->tenantId, 'name' => "closer-{$suffix}", 'email' => "closer-{$suffix}-".uniqid().'@race-a3d.test', 'password' => 'password123', 'role' => 'ps-race-closer',
            ])->id;
        }
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

    private function invoice(string $date, int $price): Invoice
    {
        $invoices = app(InvoiceService::class);

        return $invoices->post($invoices->create(['partner_id' => $this->partnerId, 'payment_type' => 'credit', 'invoice_date' => $date], [['quantity' => 1, 'unit_price' => $price, 'tax_rate' => 15]]));
    }

    /**
     * مقارنة بسطر لكل فاتورة (يُسنَد بالتجاوز) على فترة، ثم تشغيلة ومراجعة بالمالك ⇒ `reviewed` جاهزة للإغلاق.
     *
     * @param  list<Invoice>  $invoices
     * @return array{0: string, 1: string} [reconciliationId, runId]
     */
    private function reviewed(array $invoices, string $from, string $to): array
    {
        $rows = array_map(fn (Invoice $i): array => [$i->invoice_date->toDateString(), '', '', '', number_format(((int) $i->total) / 100, 2, '.', '')], $invoices);
        $path = $this->dir.'/stmt_'.uniqid().'.csv';
        file_put_contents($path, SpreadsheetWriter::csv(['التاريخ', 'رقم المستند', 'مرجعنا', 'مدين', 'دائن'], $rows));
        $id = app(PartnerStatementImportService::class)->apply(
            new UploadedFile($path, 'stmt.csv', 'text/csv', null, true),
            ['partner_id' => $this->partnerId, 'role' => 'customer', 'period_from' => $from, 'period_to' => $to],
            $this->ownerId,
        )['reconciliation_id'];
        $owner = User::query()->findOrFail($this->ownerId);
        auth()->setUser($owner);
        $run = app(PartnerStatementMatchService::class)->run($owner, $id);
        $lines = PartnerStatementLine::query()->where('reconciliation_id', $id)->orderBy('ordinal')->pluck('id')->all();
        foreach ($lines as $i => $lineId) {
            app(PartnerStatementReviewService::class)->decide($owner, $id, ['run_id' => $run['id'], 'line_id' => $lineId, 'action' => 'override', 'unit_keys' => ['invoice#'.$invoices[$i]->id], 'reason' => 'قرار صريح']);
        }
        app(PartnerStatementLifecycleService::class)->markReviewed($owner, $id, $run['id'], null);

        return [$id, $run['id']];
    }

    /** @param callable(User): mixed $fn */
    private function jobAs(string $userId, callable $fn): callable
    {
        return function () use ($userId, $fn) {
            app(TenantContext::class)->set($this->tenantId);
            $user = User::query()->findOrFail($userId);
            auth()->setUser($user);

            return $fn($user);
        };
    }

    private function closeJob(int $closerIndex, string $id, string $runId, array $ack = [], int $delayMicros = 0): callable
    {
        return $this->jobAs($this->closerIds[$closerIndex], function (User $u) use ($id, $runId, $ack, $delayMicros) {
            usleep($delayMicros);
            $started = microtime(true);
            $r = app(PartnerStatementLifecycleService::class)->close($u, $id, ['run_id' => $runId, 'acknowledge_overlap' => $ack]);

            return ['replayed' => $r['replayed'], 'elapsed' => microtime(true) - $started];
        });
    }

    private function rowStatus(string $id): string
    {
        app(TenantContext::class)->set($this->tenantId);

        return (string) PartnerStatementReconciliation::query()->findOrFail($id)->status;
    }

    private function claimsOf(string $id): int
    {
        app(TenantContext::class)->set($this->tenantId);

        return PartnerStatementUnitClaim::query()->where('reconciliation_id', $id)->count();
    }

    /** @return list<string> */
    private function actions(string $id): array
    {
        app(TenantContext::class)->set($this->tenantId);

        return PartnerStatementReconciliationEvent::query()->where('reconciliation_id', $id)->orderBy('seq')->pluck('action')->all();
    }

    /** @param array<int, array<string, mixed>> $results @return list<array<string, mixed>> */
    private function successes(array $results): array
    {
        return array_values(array_map(fn ($r) => $r['value'], array_filter($results, fn ($r) => ($r['ok'] ?? false) === true)));
    }

    /** @param array<int, array<string, mixed>> $results @return list<string> رموز أسباب الإخفاقات */
    private function failures(array $results): array
    {
        $reasons = [];
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                // لا أخطاء قاعدة بيانات (جمود/تفرّد): الإخفاق الوحيد المقبول استثناء عمل بسببٍ ثابت.
                $this->assertSame(PartnerStatementReviewException::class, $r['error_class'] ?? null, json_encode($r, JSON_UNESCAPED_UNICODE));
                $reasons[] = (string) ($r['reason'] ?? '');
            }
        }
        sort($reasons);

        return $reasons;
    }

    // ═══════════════════════════════ السباقات ═══════════════════════════════

    /** @test */
    public function racing_closes_of_one_reconciliation_create_one_close_event_and_replay_the_rest(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        $b = $this->invoice('2026-09-02', 20000);
        [$id, $runId] = $this->reviewed([$a, $b], '2026-09-01', '2026-09-30');

        $results = $this->runConcurrently([$this->closeJob(0, $id, $runId), $this->closeJob(1, $id, $runId), $this->closeJob(2, $id, $runId), $this->closeJob(0, $id, $runId), $this->closeJob(1, $id, $runId)]);

        $this->assertCount(5, $this->successes($results), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertCount(1, array_filter($this->successes($results), fn ($v) => $v['replayed'] === false), 'فائزٌ واحد فقط يكتب المطالبات والحدث.');
        $this->assertSame('closed', $this->rowStatus($id));
        $this->assertSame(2, $this->claimsOf($id));
        $this->assertSame(['mark_reviewed', 'close'], $this->actions($id));
    }

    /** @test */
    public function two_overlapping_finals_sharing_a_movement_are_serialised_one_wins_and_the_loser_gets_a_clean_unit_conflict(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        $b = $this->invoice('2026-09-05', 20000);
        [$one, $runOne] = $this->reviewed([$a, $b], '2026-09-01', '2026-09-30');
        [$two, $runTwo] = $this->reviewed([$a], '2026-09-01', '2026-09-15');

        $results = $this->runConcurrently([$this->closeJob(0, $one, $runOne), $this->closeJob(1, $two, $runTwo), $this->closeJob(2, $one, $runOne), $this->closeJob(0, $two, $runTwo)]);

        $statuses = [$this->rowStatus($one), $this->rowStatus($two)];
        $this->assertCount(1, array_keys($statuses, 'closed', true), 'نهائي واحد فقط: '.json_encode([$statuses, $results], JSON_UNESCAPED_UNICODE));
        $this->assertSame('unit_conflict', $this->failures($results)[0] ?? 'none', 'الخاسر يرى مطالبة الفائز بعد الالتزام: '.json_encode($results, JSON_UNESCAPED_UNICODE));
        $winner = $statuses[0] === 'closed' ? $one : $two;
        $loser = $winner === $one ? $two : $one;
        $this->assertSame(0, $this->claimsOf($loser));
        $this->assertGreaterThan(0, $this->claimsOf($winner));
        app(TenantContext::class)->set($this->tenantId);
        $this->assertSame(PartnerStatementUnitClaim::query()->count(), PartnerStatementUnitClaim::query()->distinct()->count('journal_entry_id'), 'لا قيد بمطالبتين.');
    }

    /** @test */
    public function two_finals_with_disjoint_movements_close_concurrently_without_false_blocking(): void
    {
        $s = $this->invoice('2026-09-10', 100000);
        $o = $this->invoice('2026-10-10', 20000);
        [$sep, $runSep] = $this->reviewed([$s], '2026-09-01', '2026-09-30');
        [$oct, $runOct] = $this->reviewed([$o], '2026-10-01', '2026-10-31');

        $results = $this->runConcurrently([$this->closeJob(0, $sep, $runSep), $this->closeJob(1, $oct, $runOct)]);

        $this->assertCount(2, $this->successes($results), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(['closed', 'closed', 1, 1], [$this->rowStatus($sep), $this->rowStatus($oct), $this->claimsOf($sep), $this->claimsOf($oct)]);
    }

    /** @test */
    public function a_close_racing_a_reopen_leaves_one_consistent_final_state(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$id, $runId] = $this->reviewed([$a], '2026-09-01', '2026-09-30');
        $reopen = $this->jobAs($this->ownerId, fn (User $u) => app(PartnerStatementLifecycleService::class)->reopen($u, $id, 'سباق مع الإغلاق') !== null);

        $results = $this->runConcurrently([$this->closeJob(0, $id, $runId), $reopen, $this->closeJob(1, $id, $runId), $reopen]);

        $this->failures($results);   // لا أخطاء قاعدة بيانات
        $status = $this->rowStatus($id);
        $actions = $this->actions($id);
        if ($status === 'closed') {
            $this->assertSame(['mark_reviewed', 'close'], $actions, 'الإغلاق سبق: لا إعادة فتح بعد مطالبات.');
            $this->assertSame(1, $this->claimsOf($id));
        } else {
            $this->assertSame('draft', $status);
            $this->assertSame('reopen', end($actions));
            $this->assertSame(0, $this->claimsOf($id), 'إعادة الفتح سبقت: لا مطالبات.');
            $this->assertNotContains('close', $actions);
        }
    }

    /** @test */
    public function a_ledger_posting_in_flight_is_never_missed_the_close_waits_for_the_tenant_anchor_then_sees_it_and_refuses_the_stale_run(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$id, $runId] = $this->reviewed([$a], '2026-09-01', '2026-09-30');

        // المرحِّل: قيد جديد داخل الفترة داخل معاملة تحتفظ بمِرساة المستأجر (التي يقفلها LedgerService) ~2ث قبل الالتزام.
        $poster = $this->jobAs($this->ownerId, function (User $u) {
            return DB::transaction(function () {
                $invoice = $this->invoice('2026-09-20', 5000);
                usleep(2_000_000);

                return $invoice->id !== null;
            });
        });
        $results = $this->runConcurrently([$poster, $this->closeJob(0, $id, $runId, [], 600_000)]);

        $this->assertTrue($results[0]['ok'] ?? false, 'المرحِّل ينجح: '.json_encode($results[0], JSON_UNESCAPED_UNICODE));
        $this->assertFalse($results[1]['ok'] ?? true, 'الإغلاق لا يمرّ على لقطة دفتر قديمة: '.json_encode($results[1], JSON_UNESCAPED_UNICODE));
        $this->assertSame(PartnerStatementReviewException::class, $results[1]['error_class'] ?? null);
        $this->assertSame('run_stale', $results[1]['reason'] ?? null, 'القيد المرحَّل أثناء الانتظار يُرى بعد المِرساة فتُرفض التشغيلة القديمة.');
        $this->assertSame(['reviewed', 0], [$this->rowStatus($id), $this->claimsOf($id)]);
        $this->assertSame(['mark_reviewed'], $this->actions($id));
    }

    /** @test */
    public function the_anchor_lock_the_close_takes_really_blocks_ledger_postings_until_it_commits(): void
    {
        // «الإغلاق» يُمثَّل بالقفل نفسه (الطريقة نفسها) ثم نومٍ داخل معاملته؛ المرحِّل يبدأ بعد 0.4ث ويجب أن ينتظر الالتزام.
        $holder = $this->jobAs($this->ownerId, function (User $u) {
            return DB::transaction(function () {
                app(PartnerStatementClaimService::class)->lockLedgerAnchor();
                usleep(1_800_000);

                return true;
            });
        });
        $poster = $this->jobAs($this->ownerId, function (User $u) {
            usleep(400_000);
            $started = microtime(true);
            $this->invoice('2026-09-21', 3000);

            return ['elapsed' => microtime(true) - $started];
        });
        $results = $this->runConcurrently([$holder, $poster]);

        $this->assertTrue($results[0]['ok'] ?? false, json_encode($results[0], JSON_UNESCAPED_UNICODE));
        $this->assertTrue($results[1]['ok'] ?? false, json_encode($results[1], JSON_UNESCAPED_UNICODE));
        $this->assertGreaterThan(0.9, $results[1]['value']['elapsed'], 'ترحيل الأستاذ ينتظر مِرساة المستأجر التي يحجزها الإغلاق (دون تعديل LedgerService).');
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
                    file_put_contents($resultFiles[$i], json_encode([
                        'ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage(), 'reason' => $e instanceof PartnerStatementReviewException ? $e->reason : null,
                    ]));
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
