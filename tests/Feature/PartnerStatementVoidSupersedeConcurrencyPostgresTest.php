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
 * IMP-PS-A3e — الإبطال والاستبدال تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): إبطالان متزامنان لنهائي واحد ⇒ حدث واحد؛ إبطال مقابل استبدال لنهائي واحد ⇒ فائز واحد وحالة متسقة؛ استبدالان متنافسان لنهائي واحد ⇒ بديلة واحدة
 * فقط (والخاسرة تبقى `reviewed` بلا مطالبات)؛ إبطال مقابل إغلاق بديلة لا تستبدل ⇒ متسلسلان بلا مطالبة مزدوجة؛ **استبدال مقابل ترحيل أستاذ جارٍ** ⇒ ينتظر المِرساة ثم يرى القيد فيُرفض بـ`run_stale` ويتراجع كلياً (الأصل
 * `closed` بمطالباته)؛ الإبطال لا يقرأ الدفتر فلا يتنازع المِرساة؛ والقيد المؤجَّل يرفض التزام استبدال بديلته ليست `closed`. على SQLite يُتجاهل؛ غياب pcntl على PostgreSQL **فشل لا تخطٍّ**.
 * تشغيل: php artisan test --filter=PartnerStatementVoidSupersedeConcurrencyPostgresTest
 */
class PartnerStatementVoidSupersedeConcurrencyPostgresTest extends TestCase
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

        $this->dir = sys_get_temp_dir().'/ps_a3e_race_'.uniqid();
        mkdir($this->dir);
        $auth = $this->registerTenant('ps-a3e-race-'.substr(md5((string) microtime(true)), 0, 8), 'ps'.uniqid().'@race-a3e.test');
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        $this->ownerId = (string) User::query()->where('tenant_id', $this->tenantId)->value('id');
        $this->partnerId = Partner::create(['type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل التزامن', 'is_active' => true])->id;
        Role::create(['slug' => 'ps-race-closer', 'name' => 'ps-race-closer', 'permissions' => ['partner_statements.view', 'partner_statements.close', 'partners.view'], 'is_system' => false]);
        Role::create(['slug' => 'ps-race-retirer', 'name' => 'ps-race-retirer', 'permissions' => ['partner_statements.view', 'partner_statements.close', 'partner_statements.void', 'partners.view'], 'is_system' => false]);
        // «closerIds» هنا مستخدمو الإغلاق/الإبطال/الاستبدال (صلاحيات كاملة للمنفِّذ؛ المراجِع المالك دائماً مختلف عنهم).
        foreach (['a', 'b', 'c'] as $suffix) {
            $this->closerIds[] = (string) User::create([
                'tenant_id' => $this->tenantId, 'name' => "retirer-{$suffix}", 'email' => "retirer-{$suffix}-".uniqid().'@race-a3e.test', 'password' => 'password123', 'role' => 'ps-race-retirer',
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
    private function reviewed(array $invoices, string $from, string $to, ?string $lineDate = null, string $tag = ''): array
    {
        $rows = array_map(fn (Invoice $i): array => [$lineDate ?? $i->invoice_date->toDateString(), $tag, '', '', number_format(((int) $i->total) / 100, 2, '.', '')], $invoices);
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


    /** إغلاق متزامن مع الاختبار نفسه (قبل الفروع) بمنفِّذ يختلف عن المراجِع المالك. */
    private function closeNow(string $id, string $runId): void
    {
        $user = User::query()->findOrFail($this->closerIds[0]);
        auth()->setUser($user);
        app(PartnerStatementLifecycleService::class)->close($user, $id, ['run_id' => $runId]);
    }

    private function voidJob(int $idx, string $id, string $reason = 'سبب الإبطال', int $delayMicros = 0): callable
    {
        return $this->jobAs($this->closerIds[$idx], function (User $u) use ($id, $reason, $delayMicros) {
            usleep($delayMicros);
            $started = microtime(true);
            $r = app(PartnerStatementLifecycleService::class)->void($u, $id, $reason);

            return ['replayed' => $r['replayed'], 'elapsed' => microtime(true) - $started];
        });
    }

    /** @param list<string> $replaces */
    private function replaceJob(int $idx, string $newId, string $runId, array $replaces, int $delayMicros = 0): callable
    {
        return $this->jobAs($this->closerIds[$idx], function (User $u) use ($newId, $runId, $replaces, $delayMicros) {
            usleep($delayMicros);
            $r = app(PartnerStatementLifecycleService::class)->replace($u, $newId, ['run_id' => $runId, 'replaces' => $replaces, 'reason' => 'استبدال متزامن']);

            return ['replayed' => $r['replayed']];
        });
    }

    private function activeClaimsOf(string $id): int
    {
        app(TenantContext::class)->set($this->tenantId);

        return PartnerStatementUnitClaim::query()->where('reconciliation_id', $id)->whereNull('released_at')->count();
    }

    /** لا قيد بمطالبتين نشطتين أبداً، وكل مطالبة نشطة تتبع نهائياً مُغلَقاً فقط (مطالبة نشطة لمُبطَل/مُستبدَل = كسر). */
    private function assertClaimInvariants(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        $active = PartnerStatementUnitClaim::query()->whereNull('released_at')->get();
        $this->assertSame($active->count(), $active->pluck('journal_entry_id')->unique()->count(), 'لا قيد بمطالبتين نشطتين.');
        foreach ($active as $claim) {
            $this->assertSame('closed', $this->rowStatus((string) $claim->reconciliation_id), 'مطالبة نشطة لنهائي غير مُغلَق.');
        }
        foreach (PartnerStatementReconciliation::query()->whereIn('status', ['voided', 'superseded'])->get() as $r) {
            $this->assertSame(0, $this->activeClaimsOf((string) $r->id), 'نهائي مُبطَل/مُستبدَل بلا مطالبات نشطة.');
        }
    }

    // ═══════════════════════════════ السباقات ═══════════════════════════════

    /** @test */
    public function racing_voids_of_one_final_create_one_void_event_and_replay_the_rest(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$id, $runId] = $this->reviewed([$a], '2026-09-01', '2026-09-30');
        $this->closeNow($id, $runId);

        $results = $this->runConcurrently([$this->voidJob(0, $id), $this->voidJob(1, $id), $this->voidJob(2, $id), $this->voidJob(0, $id)]);

        $this->assertCount(4, $this->successes($results), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertCount(1, array_filter($this->successes($results), fn ($v) => $v['replayed'] === false), 'فائز واحد فقط يكتب الحدث.');
        $this->assertSame(['mark_reviewed', 'close', 'void'], $this->actions($id));
        $this->assertSame(['voided', 1, 0], [$this->rowStatus($id), $this->claimsOf($id), $this->activeClaimsOf($id)]);
        $this->assertClaimInvariants();
    }

    /** @test */
    public function racing_voids_with_different_reasons_let_one_win_and_conflict_the_other_without_database_errors(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$id, $runId] = $this->reviewed([$a], '2026-09-01', '2026-09-30');
        $this->closeNow($id, $runId);

        $results = $this->runConcurrently([$this->voidJob(0, $id, 'سبب أول'), $this->voidJob(1, $id, 'سبب ثانٍ')]);

        $this->assertCount(1, $this->successes($results), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(['reconciliation_already_voided'], $this->failures($results));
        $this->assertSame(['mark_reviewed', 'close', 'void'], $this->actions($id));
        $this->assertClaimInvariants();
    }

    /** @test */
    public function a_void_racing_a_replacement_of_the_same_final_has_exactly_one_winner_and_a_consistent_state(): void
    {
        foreach ([0, 150_000, 400_000] as $k => $delay) {
            $m = sprintf('2026-%02d', 1 + $k);   // فترة مستقلة لكل جولة: لا نهائي قائم من الجولة السابقة
            $a = $this->invoice("{$m}-01", 100000);
            $tag = 'T'.$delay;
            [$orig, $runOrig] = $this->reviewed([$a], "{$m}-01", "{$m}-28", null, $tag.'-orig');
            $this->closeNow($orig, $runOrig);
            [$new, $runNew] = $this->reviewed([$a], "{$m}-01", "{$m}-28", null, $tag.'-new');

            $results = $this->runConcurrently([$this->voidJob(1, $orig), $this->replaceJob(2, $new, $runNew, [$orig], $delay)]);

            $origStatus = $this->rowStatus($orig);
            $this->assertContains($origStatus, ['voided', 'superseded']);
            $this->assertCount(1, $this->successes($results), "delay={$delay}: ".json_encode($results, JSON_UNESCAPED_UNICODE));
            if ($origStatus === 'superseded') {
                $this->assertSame(['closed', ['reconciliation_already_superseded']], [$this->rowStatus($new), $this->failures($results)]);
                $this->assertSame(1, $this->activeClaimsOf($new));
            } else {
                $this->assertSame(['reviewed', ['replace_target_not_closed']], [$this->rowStatus($new), $this->failures($results)]);
                $this->assertSame(0, $this->activeClaimsOf($new));
            }
            $this->assertClaimInvariants();
        }
    }

    /** @test */
    public function two_competing_replacements_of_one_final_yield_one_replacement_and_the_loser_stays_reviewed_with_no_claims(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$orig, $runOrig] = $this->reviewed([$a], '2026-09-01', '2026-09-30', null, 'orig');
        $this->closeNow($orig, $runOrig);
        [$b1, $run1] = $this->reviewed([$a], '2026-09-01', '2026-09-30', null, 'b1');
        [$b2, $run2] = $this->reviewed([$a], '2026-09-01', '2026-09-30', null, 'b2');

        $results = $this->runConcurrently([$this->replaceJob(1, $b1, $run1, [$orig]), $this->replaceJob(2, $b2, $run2, [$orig])]);

        $this->assertCount(1, $this->successes($results), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(['replace_target_not_closed'], $this->failures($results));
        $statuses = [$this->rowStatus($b1), $this->rowStatus($b2)];
        sort($statuses);
        $this->assertSame(['closed', 'reviewed'], $statuses);
        $winner = $this->rowStatus($b1) === 'closed' ? $b1 : $b2;
        $loser = $winner === $b1 ? $b2 : $b1;
        app(TenantContext::class)->set($this->tenantId);
        $this->assertSame($winner, PartnerStatementReconciliation::query()->findOrFail($orig)->superseded_by_id);
        $this->assertSame([1, 0, 0], [$this->activeClaimsOf($winner), $this->claimsOf($loser), $this->activeClaimsOf($orig)]);
        $this->assertSame(['mark_reviewed'], $this->actions($loser));
        $this->assertClaimInvariants();
    }

    /** @test */
    public function a_void_racing_the_close_of_a_non_replacing_candidate_is_serialised_without_double_claims(): void
    {
        foreach ([0, 200_000, 500_000] as $k => $delay) {
            $m = sprintf('2026-%02d', 4 + $k);
            $a = $this->invoice("{$m}-01", 100000);
            $tag = 'V'.$delay;
            [$orig, $runOrig] = $this->reviewed([$a], "{$m}-01", "{$m}-28", null, $tag.'-orig');
            $this->closeNow($orig, $runOrig);
            [$cand, $runCand] = $this->reviewed([$a], "{$m}-01", "{$m}-28", null, $tag.'-cand');

            $results = $this->runConcurrently([$this->voidJob(1, $orig), $this->closeJob(2, $cand, $runCand, [], $delay)]);

            $this->assertSame('voided', $this->rowStatus($orig), json_encode($results, JSON_UNESCAPED_UNICODE));
            $candStatus = $this->rowStatus($cand);
            if ($candStatus === 'closed') {
                $this->assertSame(1, $this->activeClaimsOf($cand), 'الإغلاق جاء بعد الإبطال: المطالبة تنتقل للبديلة.');
            } else {
                $this->assertSame(['reviewed', ['final_already_exists']], [$candStatus, $this->failures($results)], 'الإغلاق سبق الإبطال فرُفض بسبب النهائي القائم.');
            }
            $this->assertClaimInvariants();
        }
    }

    /** @test */
    public function a_replacement_racing_an_in_flight_ledger_posting_waits_then_refuses_the_stale_run_and_rolls_everything_back(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$orig, $runOrig] = $this->reviewed([$a], '2026-09-01', '2026-09-30', null, 'orig');
        $this->closeNow($orig, $runOrig);
        [$new, $runNew] = $this->reviewed([$a], '2026-09-01', '2026-09-30', null, 'new');

        $poster = $this->jobAs($this->ownerId, function (User $u) {
            return DB::transaction(function () {
                $invoice = $this->invoice('2026-09-20', 5000);
                usleep(2_000_000);

                return $invoice->id !== null;
            });
        });
        $results = $this->runConcurrently([$poster, $this->replaceJob(1, $new, $runNew, [$orig], 600_000)]);

        $this->assertTrue($results[0]['ok'] ?? false, json_encode($results[0], JSON_UNESCAPED_UNICODE));
        $this->assertFalse($results[1]['ok'] ?? true, json_encode($results[1], JSON_UNESCAPED_UNICODE));
        $this->assertSame('run_stale', $results[1]['reason'] ?? null);
        $this->assertSame(['closed', 'reviewed', 1, 0], [$this->rowStatus($orig), $this->rowStatus($new), $this->activeClaimsOf($orig), $this->claimsOf($new)], 'تراجع كامل: الأصل لم يُستبدَل.');
        $this->assertSame(['mark_reviewed', 'close'], $this->actions($orig));
        $this->assertClaimInvariants();
    }

    /** @test */
    public function a_void_alongside_an_anchor_holding_ledger_transaction_never_deadlocks_and_never_reads_the_ledger(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$id, $runId] = $this->reviewed([$a], '2026-09-01', '2026-09-30');
        $this->closeNow($id, $runId);

        $holder = $this->jobAs($this->ownerId, function (User $u) {
            return DB::transaction(function () {
                app(PartnerStatementClaimService::class)->lockLedgerAnchor();
                usleep(2_000_000);

                return true;
            });
        });
        $results = $this->runConcurrently([$holder, $this->voidJob(1, $id, 'سبب الإبطال', 500_000)]);

        $this->assertTrue($results[1]['ok'] ?? false, json_encode($results[1], JSON_UNESCAPED_UNICODE));
        // الإبطال لا يقفل المِرساة ولا يقرأ الدفتر (لا `run_stale` ولا جمود)؛ قد يصطفّ فقط خلف `FOR UPDATE` على صف المستأجر عند إدراج حدثه (مفتاح أجنبي `tenant_id`، كأي كتابة)، فيكتمل بعد التزام الأستاذ.
        $this->assertTrue($results[0]['ok'] ?? false, json_encode($results[0], JSON_UNESCAPED_UNICODE));
        $this->assertSame(['voided', 0], [$this->rowStatus($id), $this->activeClaimsOf($id)]);
        $this->assertClaimInvariants();
    }

    /** @test */
    public function the_deferred_constraint_refuses_a_supersede_whose_replacement_is_not_closed_at_commit(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$orig, $runOrig] = $this->reviewed([$a], '2026-09-01', '2026-09-30', null, 'orig');
        $this->closeNow($orig, $runOrig);
        [$new] = $this->reviewed([$a], '2026-09-01', '2026-09-30', null, 'new');
        app(TenantContext::class)->set($this->tenantId);
        $now = now()->format('Y-m-d H:i:s');

        try {
            DB::transaction(function () use ($orig, $new, $runOrig, $now): void {
                DB::table('partner_statement_reconciliation_events')->insert([
                    'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $this->tenantId, 'reconciliation_id' => $orig, 'seq' => 3, 'action' => 'supersede', 'from_status' => 'closed', 'to_status' => 'superseded',
                    'run_id' => $runOrig, 'summary' => '{}', 'reason' => 'سبب', 'created_by' => $this->closerIds[0], 'claims_count' => 1, 'related_reconciliation_id' => $new, 'created_at' => $now,
                ]);
                DB::table('partner_statement_reconciliations')->where('id', $orig)->update([
                    'status' => 'superseded', 'voided_at' => $now, 'voided_by' => $this->closerIds[0], 'void_reason' => 'سبب', 'superseded_by_id' => $new,
                ]);
            });
            $this->fail('الالتزام يجب أن يُرفض: البديلة لم تُغلق.');
        } catch (\PHPUnit\Framework\AssertionFailedError $e) {
            throw $e;
        } catch (\Throwable $e) {   // الرفض يقع عند COMMIT (PDOException) لا عند عبارة
            $this->assertStringContainsString('replacement closed', strtolower($e->getMessage()));
        }
        $this->assertSame(['closed', 1], [$this->rowStatus($orig), $this->activeClaimsOf($orig)]);
        $this->assertSame(['mark_reviewed', 'close'], $this->actions($orig));
        $this->assertClaimInvariants();
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
