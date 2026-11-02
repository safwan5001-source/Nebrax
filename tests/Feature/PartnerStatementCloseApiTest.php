<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementReconciliation;
use App\Models\PartnerStatementReconciliationEvent;
use App\Models\PartnerStatementUnitClaim;
use App\Models\Role;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Models\PartnerStatementReviewDecision;
use App\Services\PartnerStatementClaimService;
use App\Services\PartnerStatementImportService;
use App\Services\PartnerStatementLifecycleService;
use App\Support\PartnerStatementReviewException;
use App\Services\TenantApplicationService;
use App\Support\Rbac;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use LogicException;
use Tests\TestCase;

/**
 * IMP-PARTNER-STATEMENTS PS-A3d — الإغلاق النهائي `reviewed → closed` بمطالبات الحركات: الصلاحية المستقلة `partner_statements.close` وفصل المهام (المُغلِق ≠ المراجِع)، الذرّية،
 * المطالبة بالقيود (قيود الفترة + قيود خارجها استعملتها القرارات، وعضو link_pair المختار وحده)، التعارض الحقيقي `unit_conflict`، تداخل الفترات بإقرار مطابق (D-PS-14)، النطاق (مؤسسة/فرع)،
 * حداثة التشغيلة والدفتر، إعادة الطلب الآمنة، حراس القاعدة ضد SQL خام، وعدم الأثر المالي. التزامن الحقيقي على PostgreSQL في PartnerStatementCloseConcurrencyPostgresTest.
 * تشغيل: php artisan test --filter=PartnerStatementCloseApiTest
 */
class PartnerStatementCloseApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private array $auth;

    private User $owner;

    private Partner $both;

    private string $closer;

    private string $closerId;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->auth = $this->registerTenant('ps-a3d', 'owner@ps-a3d.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->owner = User::query()->where('email', 'owner@ps-a3d.test')->firstOrFail();
        $this->both = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف الإغلاق', 'is_active' => true]);
        $this->closer = $this->role('ps-closer', ['partner_statements.view', 'partner_statements.close', 'partners.view'], 'closer@ps-a3d.test');
        $this->closerId = (string) User::query()->where('email', 'closer@ps-a3d.test')->value('id');
    }

    // ═══════════════════════════════ أدوات ═══════════════════════════════

    private function invoice(string $date, int $unitPrice, ?string $branchId = null): Invoice
    {
        $service = app(InvoiceService::class);
        $context = app(BranchContext::class);
        $branchId !== null ? $context->set($branchId) : $context->forget();
        try {
            return $service->post($service->create(
                ['partner_id' => $this->both->id, 'payment_type' => 'credit', 'invoice_date' => $date],
                [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
            ));
        } finally {
            $context->forget();
        }
    }

    private function entryOf(Invoice $invoice): JournalEntry
    {
        return JournalEntry::query()->where('source_type', Invoice::class)->where('source_id', $invoice->id)->firstOrFail();
    }

    /** @param list<array<string, mixed>> $rows @param array<string, mixed> $over */
    private function statement(array $rows, array $over = []): string
    {
        $money = fn (?int $minor): string => $minor === null ? '' : number_format($minor / 100, 2, '.', '');
        $csv = SpreadsheetWriter::csv(['التاريخ', 'رقم المستند', 'مرجعنا', 'مدين', 'دائن'], array_map(fn (array $r): array => [
            $r['date'], $r['ref'] ?? '', $r['our'] ?? '', $money($r['debit'] ?? null), $money($r['credit'] ?? null),
        ], $rows));
        $file = UploadedFile::fake()->createWithContent('s'.uniqid().'.csv', $csv);
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->actingAs($this->owner);

        return app(PartnerStatementImportService::class)->apply($file, $over + [
            'partner_id' => $this->both->id, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30',
        ], (string) $this->owner->id)['reconciliation_id'];
    }

    private function match(string $token, string $id): array
    {
        return $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/match")->assertSuccessful()->json('data');
    }

    private function lineId(string $id, int $ordinal): string
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return (string) PartnerStatementLine::query()->where('reconciliation_id', $id)->where('ordinal', $ordinal)->value('id');
    }

    private function decide(string $token, string $id, array $payload)
    {
        return $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/decisions", $payload);
    }

    private function review(string $token, string $id, string $runId)
    {
        return $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/review", ['run_id' => $runId]);
    }

    private function close(string $token, string $id, string $runId, ?array $ack = null, ?string $note = null)
    {
        return $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/close", array_filter([
            'run_id' => $runId, 'acknowledge_overlap' => $ack, 'note' => $note,
        ], fn ($v) => $v !== null));
    }

    private function lcStatus(string $token, string $id)
    {
        return $this->withToken($token)->getJson("/api/partner-statement-reconciliations/{$id}/status");
    }

    private function events(string $token, string $id)
    {
        return $this->withToken($token)->getJson("/api/partner-statement-reconciliations/{$id}/events");
    }

    private function role(string $slug, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($this->auth['tenant_id'], $slug, $email);
    }

    private function reconciliation(string $id): PartnerStatementReconciliation
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return PartnerStatementReconciliation::query()->findOrFail($id);
    }

    /** @return list<string> قيود المطالبات لمقارنة (مرتبة). */
    private function claimed(string $id): array
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return PartnerStatementUnitClaim::query()->where('reconciliation_id', $id)->orderBy('journal_entry_id')->pluck('journal_entry_id')->map(fn ($v) => (string) $v)->all();
    }

    private function eventCount(string $id): int
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return PartnerStatementReconciliationEvent::query()->where('reconciliation_id', $id)->count();
    }

    private function claimCount(): int
    {
        return DB::table('partner_statement_unit_claims')->count();
    }

    private function counts(): array
    {
        $tables = ['journal_entries', 'journal_lines', 'account_balances', 'invoices', 'payments', 'purchases', 'stock_movements', 'credit_notes', 'return_documents'];

        return array_map(fn (string $t): int => DB::table($t)->count(), array_combine($tables, $tables));
    }

    /**
     * يستورد كشفاً ويطابقه ويقرّر كل بند (`act` في الصف: confirm الافتراضي | dismiss | override | link_pair) ثم يراجعه بالمالك.
     *
     * @param  list<array<string, mixed>>  $rows
     * @param  array<string, mixed>  $over
     * @return array{0: string, 1: array<string, mixed>}
     */
    private function ready(array $rows, array $over = []): array
    {
        $token = $this->auth['token'];
        $id = $this->statement($rows, $over);
        $run = $this->match($token, $id);
        foreach (array_values($rows) as $i => $row) {
            $payload = ['run_id' => $run['id'], 'line_id' => $this->lineId($id, $i + 2), 'action' => $row['act'] ?? 'confirm', 'reason' => 'مراجعة اختبار'];
            if (isset($row['units'])) {
                $payload['unit_keys'] = $row['units'];
            }
            if (isset($row['member'])) {
                $payload['pair_member'] = $row['member'];
            }
            $this->decide($token, $id, $payload)->assertCreated();
        }
        $this->review($token, $id, $run['id'])->assertCreated();

        return [$id, $run];
    }

    private function assertRejected(callable $fn, string $why): void
    {
        try {
            DB::transaction($fn);
            $this->fail($why);
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
    }

    // ═══════════════════════════════ الإغلاق الناجح ═══════════════════════════════

    /** @test */
    public function closing_writes_claims_event_and_status_atomically_with_no_financial_effect_and_a_replay_is_safe(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        $b = $this->invoice('2026-09-05', 20000);
        $outside = $this->invoice('2026-10-02', 5000);   // خارج الفترة وخارج نافذة التسامح: لا يُطالَب به
        [$id, $run] = $this->ready([
            ['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000],
            ['date' => '2026-09-25', 'credit' => 23000, 'act' => 'override', 'units' => ['invoice#'.$b->id]],
            ['date' => '2026-09-28', 'credit' => 99900, 'act' => 'dismiss'],
        ]);
        $before = $this->counts();

        $closed = $this->close($this->closer, $id, $run['id'], null, 'إغلاق الشهر')->assertCreated();
        $this->assertFalse($closed->json('replayed'));
        $data = $closed->json('data');
        $this->assertSame(['closed', $this->owner->id, $this->closerId, 'org'], [$data['reconciliation']['status'], $data['reconciliation']['reviewed_by'], $data['reconciliation']['closed_by'], $data['reconciliation']['scope_key']]);
        $this->assertSame(['available' => false, 'blocked_reason' => 'already_closed'], $data['close']);
        $this->assertSame(2, $data['final']['claims_count']);

        $expected = collect([$this->entryOf($a)->id, $this->entryOf($b)->id])->sort()->values()->all();
        $this->assertSame($expected, $this->claimed($id), 'قيدا الفترة المُسندان بقرارات فقط؛ فاتورة أكتوبر البعيدة غير مطالَب بها.');
        $this->assertNotContains($this->entryOf($outside)->id, $this->claimed($id));
        $this->assertSame(['decision', 'decision'], DB::table('partner_statement_unit_claims')->where('reconciliation_id', $id)->pluck('basis')->all());

        $events = $this->events($this->closer, $id)->assertOk()->json('data');
        $close = collect($events)->firstWhere('action', 'close');
        $this->assertSame([2, 'reviewed', 'closed', $run['id']], [$close['seq'], $close['from_status'], $close['to_status'], $close['run_id']]);
        $this->assertSame([$this->closerId, $this->owner->id, 2], [$close['created_by'], $close['reviewer_id'], $close['claims_count']], 'هويتا المُغلِق والمراجِع وعدد المطالبات في السجل المعروض.');
        $this->assertSame(['org', 2, 'إغلاق الشهر'], [$close['summary']['scope_key'], $close['summary']['claims']['total'], $close['reason']]);
        $this->assertSame($this->owner->id, DB::table('partner_statement_reconciliation_events')->where('reconciliation_id', $id)->where('action', 'close')->value('reviewer_id'), 'هوية المراجِع موثَّقة بالحدث.');
        $this->assertSame(2, (int) DB::table('partner_statement_reconciliation_events')->where('reconciliation_id', $id)->where('action', 'close')->value('claims_count'));
        $this->assertSame($before, $this->counts(), 'لا قيد ولا مستند ولا رصيد ولا مخزون يتغيّر بالإغلاق.');

        // إعادة الطلب نفسه: 200 `replayed` بلا حدث ولا مطالبات جديدة.
        $again = $this->close($this->closer, $id, $run['id'])->assertOk();
        $this->assertTrue($again->json('replayed'));
        $this->assertSame([2, 2], [$this->eventCount($id), $this->claimCount()]);

        // الحالة طرفية: لا قرارات ولا مراجعة ولا إعادة فتح ولا إغلاق بتشغيلة أخرى.
        $this->assertSame('reconciliation_not_editable', $this->decide($this->auth['token'], $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear'])->assertStatus(409)->json('reason'));
        $this->assertSame('reconciliation_not_draft', $this->review($this->auth['token'], $id, $run['id'])->assertStatus(409)->json('reason'));
        $this->assertSame('reconciliation_not_reviewed', $this->withToken($this->auth['token'])->postJson("/api/partner-statement-reconciliations/{$id}/reopen", ['reason' => 'محاولة'])->assertStatus(409)->json('reason'));
        $this->assertSame('closed', $this->reconciliation($id)->status);
    }

    // ═══════════════════════════════ الصلاحية وفصل المهام ═══════════════════════════════

    /** @test */
    public function closing_needs_its_own_permission_view_partner_scope_and_a_closer_who_is_not_the_reviewer(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$id, $run] = $this->ready([['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000]]);

        // المراجِع نفسه (مالك بكل الصلاحيات) ⇒ فصل المهام.
        $same = $this->close($this->auth['token'], $id, $run['id'])->assertStatus(403);
        $this->assertSame('closer_must_differ_from_reviewer', $same->json('reason'));
        $this->assertSame(['reviewed', 0], [$this->reconciliation($id)->status, count($this->claimed($id))]);
        $this->assertSame('closer_must_differ_from_reviewer', $this->lcStatus($this->auth['token'], $id)->json('data.close.blocked_reason'));
        $this->assertSame(['available' => true, 'blocked_reason' => null], $this->lcStatus($this->closer, $id)->json('data.close'));

        // صلاحيات ناقصة: reconcile وحدها لا تُغلق؛ close بلا view لا تُغلق؛ بلا partners.view رفض موحَّد؛ viewer لا يُغلق.
        $reconcileOnly = $this->role('ps-d-r', ['partner_statements.reconcile', 'partner_statements.view', 'partners.view'], 'dr@ps-a3d.test');
        $this->close($reconcileOnly, $id, $run['id'])->assertForbidden();
        $closeNoView = $this->role('ps-d-nv', ['partner_statements.close', 'partners.view'], 'dnv@ps-a3d.test');
        $this->close($closeNoView, $id, $run['id'])->assertForbidden();
        $viewer = $this->role('ps-d-v', ['partner_statements.view', 'partners.view'], 'dv@ps-a3d.test');
        $this->close($viewer, $id, $run['id'])->assertForbidden();
        $noPartners = $this->role('ps-d-np', ['partner_statements.view', 'partner_statements.close'], 'dnp@ps-a3d.test');
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->close($noPartners, $id, $run['id'])->assertStatus(422)->json('message'));
        $this->assertSame(['reviewed', 0], [$this->reconciliation($id)->status, count($this->claimed($id))]);

        // الصلاحية لا تُمنح ضمنياً: غائبة عن المصفوفة الثابتة وعن كل دور نظام عدا owner/admin بالنجمة.
        $this->assertContains('partner_statements.close', Rbac::PERMISSIONS);
        $this->assertNotContains('partner_statements.close', array_merge(...array_values(Rbac::MATRIX)));
        foreach (array_diff(array_keys(Rbac::MATRIX), ['owner', 'admin']) as $role) {
            $this->assertFalse(Rbac::allows($role, 'partner_statements.close'), $role);
        }
        $this->assertTrue(Rbac::allows('owner', 'partner_statements.close'));

        // مُغلِق ثانٍ بصلاحية close+reconcile لكنه ليس المراجِع ⇒ يُغلق؛ والمراجِع الذي يحمل الصلاحيتين لا يُغلق.
        $both = $this->role('ps-d-b', ['partner_statements.view', 'partner_statements.close', 'partners.view'], 'db@ps-a3d.test');
        $this->close($both, $id, $run['id'])->assertCreated();
    }

    /** @test */
    public function a_reviewer_holding_the_close_permission_cannot_close_what_they_reviewed(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        $dual = $this->role('ps-dual', ['partner_statements.view', 'partner_statements.reconcile', 'partner_statements.close', 'partners.view'], 'dual@ps-a3d.test');
        $id = $this->statement([['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000]]);
        $run = $this->match($dual, $id);
        $this->decide($dual, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();
        $this->review($dual, $id, $run['id'])->assertCreated();

        $this->assertSame('closer_must_differ_from_reviewer', $this->close($dual, $id, $run['id'])->assertStatus(403)->json('reason'));
        $this->close($this->closer, $id, $run['id'])->assertCreated();   // آخر ⇒ يُغلق
        $this->assertSame(1, $this->claimCount());
    }

    // ═══════════════════════════════ الحداثة والأهلية ═══════════════════════════════

    /** @test */
    public function closing_is_refused_for_a_draft_a_wrong_run_a_stale_ledger_or_a_changed_statement_and_leaves_no_trace(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        $id = $this->statement([['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000]]);
        $run = $this->match($this->auth['token'], $id);
        $this->decide($this->auth['token'], $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();

        // مسودة.
        $this->assertSame('reconciliation_not_reviewed', $this->close($this->closer, $id, $run['id'])->assertStatus(409)->json('reason'));
        $this->review($this->auth['token'], $id, $run['id'])->assertCreated();

        // تشغيلة أخرى (حتى لو صحيحة) ليست تشغيلة المراجعة.
        $this->invoice('2026-09-20', 1000);
        $second = $this->match($this->auth['token'], $id);
        $this->assertNotSame($run['id'], $second['id']);
        $this->assertSame('run_is_not_the_reviewed_run', $this->close($this->closer, $id, $second['id'])->assertStatus(409)->json('reason'));

        // الدفتر تغيّر بعد المراجعة ⇒ تشغيلة المراجعة قديمة.
        $stale = $this->close($this->closer, $id, $run['id'])->assertStatus(409);
        $this->assertSame(['run_stale', ['ledger_fingerprint']], [$stale->json('reason'), $stale->json('details.causes')]);
        $this->assertSame('run_stale', $this->lcStatus($this->closer, $id)->json('data.close.blocked_reason'));

        // مُعرِّف تشغيلة مجهول/بلا تشغيلة ⇒ رفض موحَّد/تحقق.
        $this->close($this->closer, $id, (string) Str::uuid())->assertStatus(422);
        $this->withToken($this->closer)->postJson("/api/partner-statement-reconciliations/{$id}/close", ['run_id' => 'x'])->assertStatus(422);

        // سطور الكشف عُدِّلت خارج التطبيق ⇒ لا إغلاق (بعد إعادة المراجعة على دفتر حاضر).
        $this->withToken($this->auth['token'])->postJson("/api/partner-statement-reconciliations/{$id}/reopen", ['reason' => 'تحديث الدفتر'])->assertOk();
        $fresh = $this->match($this->auth['token'], $id);
        $this->decide($this->auth['token'], $id, ['run_id' => $fresh['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();
        $this->review($this->auth['token'], $id, $fresh['id'])->assertCreated();
        DB::table('partner_statement_lines')->where('reconciliation_id', $id)->where('ordinal', 2)->update(['credit_minor' => 115001]);
        $this->assertSame('statement_changed', $this->close($this->closer, $id, $fresh['id'])->assertStatus(409)->json('reason'));

        $this->assertSame(0, $this->claimCount());
        $this->assertSame('reviewed', $this->reconciliation($id)->status);
        $this->assertSame(0, DB::table('partner_statement_reconciliation_events')->where('action', 'close')->count());
    }

    // ═══════════════════════════════ المطالبات: التعارض والتداخل ═══════════════════════════════

    /** @test */
    public function a_movement_already_claimed_by_another_final_is_a_real_conflict_even_across_different_periods(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        $b = $this->invoice('2026-09-05', 20000);
        [$one, $runOne] = $this->ready([
            ['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000],
            ['date' => '2026-09-05', 'our' => $b->number, 'credit' => 23000],
        ]);
        $this->close($this->closer, $one, $runOne['id'])->assertCreated();
        $this->assertCount(2, $this->claimed($one));

        // فترة مختلفة (1–15) تتداخل وتشارك فاتورة a ⇒ تعارض حركة حقيقي (لا يُحلّه إقرار التداخل).
        [$two, $runTwo] = $this->ready([['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000]], ['period_from' => '2026-09-01', 'period_to' => '2026-09-15']);
        $conflict = $this->close($this->closer, $two, $runTwo['id'], [$one])->assertStatus(409);
        $this->assertSame('unit_conflict', $conflict->json('reason'));
        $this->assertSame([$one], $conflict->json('details.reconciliation_ids'));
        $this->assertSame($this->entryOf($a)->number, $conflict->json('details.sample.0.number'));
        $this->assertSame($this->entryOf($a)->id, $conflict->json('details.sample.0.entry_id'));

        // بلا أي أثر للمحاولة الفاشلة.
        $this->assertSame(['reviewed', [], 1], [$this->reconciliation($two)->status, $this->claimed($two), $this->eventCount($two)]);
        $this->assertSame(2, $this->claimCount());

        // الشبكة الأخيرة: إدراج مطالبة ثانية فعّالة لقيد مُطالَب به يُرفض في القاعدة (تجاوز الخدمة)، ومطالبة حرة تُقبل (ضابط إيجابي).
        $entry = $this->entryOf($a);
        $row = fn (string $reconciliation, string $line, string $entryId): array => [
            'id' => (string) Str::uuid(), 'tenant_id' => $this->auth['tenant_id'], 'reconciliation_id' => $reconciliation, 'partner_id' => $this->both->id, 'role' => 'customer',
            'journal_entry_id' => $entryId, 'basis' => 'decision', 'line_id' => $line, 'claimed_at' => now(), 'released_at' => null,
        ];
        // المطالبة بقيد a (ضمن هوية قرار rec2 نفسها) لكنه مُطالَب به فعلاً من rec1 ⇒ الفهرس الفريد وحده يمنعه.
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->insert($row($two, $this->lineId($two, 2), $entry->id)), 'مطالبة فعّالة مزدوجة');
        // ضابط إيجابي: مقارنة ثالثة بقيد حرّ تقبل مطالبتها (الفهرس لا يحجب كاذباً).
        $free = $this->invoice('2026-12-01', 1000);
        [$three, $runThree] = $this->ready([['date' => '2026-12-01', 'our' => $free->number, 'credit' => 1150]], ['period_from' => '2026-12-01', 'period_to' => '2026-12-31']);
        DB::beginTransaction();
        DB::table('partner_statement_unit_claims')->insert($row($three, $this->lineId($three, 2), $this->entryOf($free)->id));
        $this->assertSame(1, DB::table('partner_statement_unit_claims')->where('reconciliation_id', $three)->count());
        DB::rollBack();
    }

    /** @test */
    public function overlapping_periods_without_a_shared_movement_need_an_exact_acknowledgement_and_are_not_a_conflict(): void
    {
        $x = $this->invoice('2026-08-10', 100000);
        $y = $this->invoice('2026-09-10', 50000);
        $z = $this->invoice('2026-11-05', 10000);
        [$a, $runA] = $this->ready([['date' => '2026-08-10', 'our' => $x->number, 'credit' => 115000]], ['period_from' => '2026-08-01', 'period_to' => '2026-08-31']);
        [$b, $runB] = $this->ready([['date' => '2026-09-10', 'our' => $y->number, 'credit' => 57500]], ['period_from' => '2026-08-15', 'period_to' => '2026-09-30']);
        [$c, $runC] = $this->ready([['date' => '2026-11-05', 'our' => $z->number, 'credit' => 11500]], ['period_from' => '2026-11-01', 'period_to' => '2026-11-30']);

        $this->close($this->closer, $a, $runA['id'])->assertCreated();   // لا تداخل بعد: بلا إقرار

        // ب تتداخل مع أ (15–31 أغسطس) بلا حركة مشتركة: يجب إقرار القائمة نفسها.
        $required = $this->close($this->closer, $b, $runB['id'])->assertStatus(409);
        $this->assertSame('overlap_ack_required', $required->json('reason'));
        $this->assertSame([$a], array_column($required->json('details.overlaps'), 'id'));
        $this->assertSame(['2026-08-01', '2026-08-31', 'org'], [$required->json('details.overlaps.0.period_from'), $required->json('details.overlaps.0.period_to'), $required->json('details.overlaps.0.scope_key')]);
        $this->assertSame('overlap_ack_stale', $this->close($this->closer, $b, $runB['id'], [(string) Str::uuid()])->assertStatus(409)->json('reason'), 'إقرار بقائمة مختلفة.');
        $this->assertSame('overlap_ack_stale', $this->close($this->closer, $b, $runB['id'], [$a, (string) Str::uuid()])->assertStatus(409)->json('reason'), 'إقرار بقائمة أوسع.');
        $this->assertSame(0, count($this->claimed($b)));

        $ok = $this->close($this->closer, $b, $runB['id'], [$a], 'تداخل معلوم')->assertCreated();
        $this->assertSame('closed', $ok->json('data.reconciliation.status'));
        $summary = collect($this->events($this->closer, $b)->json('data'))->firstWhere('action', 'close')['summary'];
        $this->assertSame([$a], $summary['overlap_acknowledged'], 'الإقرار والقائمة محفوظان بالحدث.');
        $this->assertSame([$this->entryOf($y)->id], $this->claimed($b));

        // لا تداخل ⇒ إقرار بقائمة ما ⇒ قديم (ظهر/اختفى نهائي منذ تحميل الواجهة).
        $this->assertSame('overlap_ack_stale', $this->close($this->closer, $c, $runC['id'], [$a])->assertStatus(409)->json('reason'));
        $this->close($this->closer, $c, $runC['id'])->assertCreated();
        $this->assertSame([$this->entryOf($z)->id], $this->claimed($c));
    }

    /** @test */
    public function adjacent_periods_do_not_conflict_through_the_tolerance_window_unless_the_run_actually_used_the_entry(): void
    {
        $s1 = $this->invoice('2026-09-29', 100000);   // داخل أيلول، داخل نافذة تسامح أكتوبر (3 أيام)
        $o1 = $this->invoice('2026-10-05', 40000);
        [$sep, $runSep] = $this->ready([['date' => '2026-09-29', 'our' => $s1->number, 'credit' => 115000]]);
        [$oct, $runOct] = $this->ready([['date' => '2026-10-05', 'our' => $o1->number, 'credit' => 46000]], ['period_from' => '2026-10-01', 'period_to' => '2026-10-31']);

        $this->close($this->closer, $sep, $runSep['id'])->assertCreated();
        $this->close($this->closer, $oct, $runOct['id'])->assertCreated();   // متجاورتان: بلا إقرار ولا تعارض
        $this->assertSame([$this->entryOf($s1)->id], $this->claimed($sep));
        $this->assertSame([$this->entryOf($o1)->id], $this->claimed($oct), 'مرشّح النافذة غير المستعمل (s1) لا يُطالَب به من أكتوبر.');
    }

    /** @test */
    public function an_outside_period_entry_used_by_a_decision_is_claimed_and_conflicts_with_the_earlier_final(): void
    {
        $s1 = $this->invoice('2026-09-29', 100000);
        [$sep, $runSep] = $this->ready([['date' => '2026-09-29', 'our' => $s1->number, 'credit' => 115000]]);
        $this->close($this->closer, $sep, $runSep['id'])->assertCreated();

        // سطر أكتوبر يطابق s1 (تاريخها خارج الفترة داخل التسامح) ⇒ قيد مستعمل ⇒ يُطالَب به ⇒ تعارض حقيقي.
        [$oct, $runOct] = $this->ready([['date' => '2026-10-01', 'our' => $s1->number, 'credit' => 115000]], ['period_from' => '2026-10-01', 'period_to' => '2026-10-31']);
        $conflict = $this->close($this->closer, $oct, $runOct['id'])->assertStatus(409);
        $this->assertSame(['unit_conflict', [$sep]], [$conflict->json('reason'), $conflict->json('details.reconciliation_ids')]);
        $this->assertSame([], $this->claimed($oct));
    }

    /** @test */
    public function link_pair_claims_only_the_chosen_member_so_the_pair_can_be_split_across_two_finals_but_never_claimed_twice(): void
    {
        $p = $this->invoice('2026-09-29', 100000);
        $original = $this->entryOf($p);
        app(LedgerService::class)->reverse($original, '2026-10-02', 'إلغاء');
        $reversal = JournalEntry::query()->where('reversal_of', $original->id)->firstOrFail();
        $unit = 'invoice#'.$p->id;

        [$sep, $runSep] = $this->ready([['date' => '2026-09-29', 'credit' => 115000, 'act' => 'link_pair', 'units' => [$unit], 'member' => 'original']]);
        [$oct, $runOct] = $this->ready([['date' => '2026-10-02', 'debit' => 115000, 'act' => 'link_pair', 'units' => [$unit], 'member' => 'reversal']], ['period_from' => '2026-10-01', 'period_to' => '2026-10-31']);
        $this->close($this->closer, $sep, $runSep['id'])->assertCreated();
        $this->close($this->closer, $oct, $runOct['id'])->assertCreated();
        $this->assertSame([$original->id], $this->claimed($sep), 'أيلول يطالب بالأصل (العضو المختار) وحده؛ العكس خارج فترته ولم يُختر.');
        $this->assertSame([$reversal->id], $this->claimed($oct), 'أكتوبر يطالب بالعكس وحده؛ الأصل خارج فترته ولم يُختر.');
        $this->assertSame(['decision', 'decision'], [DB::table('partner_statement_unit_claims')->where('reconciliation_id', $sep)->value('basis'), DB::table('partner_statement_unit_claims')->where('reconciliation_id', $oct)->value('basis')]);
    }

    /** @test */
    public function linking_the_same_pair_member_in_two_finals_is_a_conflict_and_nothing_is_reversed_automatically(): void
    {
        $p = $this->invoice('2026-09-29', 100000);
        $original = $this->entryOf($p);
        app(LedgerService::class)->reverse($original, '2026-10-02', 'إلغاء');
        $unit = 'invoice#'.$p->id;
        $entries = fn () => DB::table('journal_entries')->count();
        [$sep, $runSep] = $this->ready([['date' => '2026-09-29', 'credit' => 115000, 'act' => 'link_pair', 'units' => [$unit], 'member' => 'original']]);
        $this->close($this->closer, $sep, $runSep['id'])->assertCreated();
        $count = $entries();

        // أكتوبر يربط الأصل نفسه (مبلغ سطر دائن 115000 ⇒ يقابل صافي الأصل) ⇒ تعارض؛ لا قيد عكس جديد (D-PS-15).
        [$oct, $runOct] = $this->ready([['date' => '2026-10-02', 'credit' => 115000, 'act' => 'link_pair', 'units' => [$unit], 'member' => 'original']], ['period_from' => '2026-10-01', 'period_to' => '2026-10-31']);
        $this->assertSame('unit_conflict', $this->close($this->closer, $oct, $runOct['id'])->assertStatus(409)->json('reason'));
        $this->assertSame($count, $entries());
    }

    // ═══════════════════════════════ سياسة المطالبة: ما استُعمل بقرار فقط ═══════════════════════════════

    /** @test */
    public function an_entry_missing_from_the_statement_is_not_claimed_stays_visible_as_an_exception_and_is_usable_by_the_next_period(): void
    {
        $a = $this->invoice('2026-09-05', 100000);
        $m = $this->invoice('2026-09-29', 40000);   // داخل أيلول، غائب عن كشف سبتمبر، داخل نافذة تسامح أكتوبر
        [$sep, $runSep] = $this->ready([['date' => '2026-09-05', 'our' => $a->number, 'credit' => 115000]]);
        $this->close($this->closer, $sep, $runSep['id'])->assertCreated();

        // لا يُحجز؛ يظهر استثناءً بالعدد والعيّنة في حدث الإغلاق وفي حالة المقارنة.
        $this->assertSame([$this->entryOf($a)->id], $this->claimed($sep));
        $summary = collect($this->events($this->closer, $sep)->json('data'))->firstWhere('action', 'close')['summary'];
        $this->assertSame([1, $this->entryOf($m)->id, '2026-09-29'], [$summary['unclaimed_in_period']['count'], $summary['unclaimed_in_period']['sample'][0]['entry_id'], $summary['unclaimed_in_period']['sample'][0]['date']]);
        $this->assertSame(1, $this->lcStatus($this->closer, $sep)->json('data.final.unclaimed_in_period.count'));
        $this->assertSame(1, $summary['ledger_units_missing_in_statement'], 'والمحرّك يعدّه «غائباً عن الكشف» كما كان.');

        // مطابقة أكتوبر تستعمله بقرار صريح فتحجزه بلا تعارض ولا إقرار تداخل (الفترتان متجاورتان).
        [$oct, $runOct] = $this->ready([['date' => '2026-10-01', 'our' => $m->number, 'credit' => 46000]], ['period_from' => '2026-10-01', 'period_to' => '2026-10-31']);
        $this->close($this->closer, $oct, $runOct['id'])->assertCreated();
        $this->assertSame([$this->entryOf($m)->id], $this->claimed($oct));
        $this->assertSame(0, (int) collect($this->events($this->closer, $oct)->json('data'))->firstWhere('action', 'close')['summary']['unclaimed_in_period']['count']);
    }

    /** @test */
    public function the_status_never_shows_unclaimed_entries_of_a_close_run_the_caller_cannot_read(): void
    {
        $inside = Branch::create(['code' => 'VIS', 'name' => 'فرع ظاهر']);
        $other = Branch::create(['code' => 'HID', 'name' => 'فرع آخر']);
        $a = $this->invoice('2026-09-01', 100000, $inside->id);
        $hidden = $this->invoice('2026-09-12', 50000, $other->id);   // قيد فرع آخر غائب عن الكشف ⇒ استثناء بنطاق المؤسسة
        [$id, $run] = $this->ready([['date' => '2026-09-01', 'credit' => 115000, 'act' => 'override', 'units' => ['invoice#'.$a->id]]]);
        $this->close($this->closer, $id, $run['id'])->assertCreated();

        $restricted = $this->role('ps-vis', ['partner_statements.view', 'partners.view'], 'vis@ps-a3d.test');
        User::query()->where('email', 'vis@ps-a3d.test')->firstOrFail()->branches()->sync([$inside->id]);

        // القارئ المطلق (مؤسسة) يرى الاستثناء بعيّنته؛ المقيَّد بفرع لا تُقرأ له تشغيلة المؤسسة فلا عدد ولا عيّنة ولا معرّفات قيود.
        $full = $this->lcStatus($this->closer, $id)->assertOk();
        $this->assertSame(1, $full->json('data.final.unclaimed_in_period.count'));
        $this->assertSame($this->entryOf($hidden)->id, $full->json('data.final.unclaimed_in_period.sample.0.entry_id'));
        $seen = $this->lcStatus($restricted, $id)->assertOk();
        $this->assertSame('closed', $seen->json('data.reconciliation.status'));
        $this->assertNull($seen->json('data.final.unclaimed_in_period'));
        $this->assertNull($seen->json('data.final.claims_count'), 'عدد المطالبات يخصّ نطاق تشغيلة الإغلاق أيضاً (Codex).');
        $this->assertSame([1, $this->closerId, 'org'], [$full->json('data.final.claims_count'), $full->json('data.final.closed_by'), $full->json('data.final.scope_key')]);
        $this->assertSame([$this->closerId, 'org'], [$seen->json('data.final.closed_by'), $seen->json('data.final.scope_key')], 'هوية المُغلِق ونطاقه تبقى ظاهرة لمن يرى المقارنة.');
        $this->assertStringNotContainsString($this->entryOf($hidden)->id, (string) $seen->getContent());
        $this->assertStringNotContainsString($this->entryOf($hidden)->number, (string) $seen->getContent());
        $this->assertSame([], $this->events($restricted, $id)->assertOk()->json('data') === [] ? [] : array_filter($this->events($restricted, $id)->json('data'), fn ($e) => $e['action'] === 'close'));
    }

    /** @test */
    public function dismiss_creates_no_claim_and_an_entry_is_never_claimed_by_similarity_of_amount_or_date(): void
    {
        $d = $this->invoice('2026-09-10', 30000);   // قيد في الفترة؛ سطر الكشف المستبعد بمبلغ وتاريخ مختلفين
        $e = $this->invoice('2026-09-28', 86870);   // 99900.50 ≈ إجمالي e قريب تاريخاً من سطر الاستبعاد: لا تشابه يُحجز به شيء
        [$id, $run] = $this->ready([['date' => '2026-09-28', 'credit' => 99900, 'act' => 'dismiss']]);

        $this->close($this->closer, $id, $run['id'])->assertCreated();
        $this->assertSame([], $this->claimed($id), 'dismiss لا قيد مرتبط ⇒ لا مطالبة.');
        $this->assertSame(0, $this->claimCount());
        $summary = collect($this->events($this->closer, $id)->json('data'))->firstWhere('action', 'close')['summary'];
        $this->assertSame([0, 2], [$summary['claims']['total'], $summary['unclaimed_in_period']['count']], 'قيدا الفترة استثناءان ظاهران لا محجوزان.');
        $this->assertEqualsCanonicalizing([$this->entryOf($d)->id, $this->entryOf($e)->id], array_column($summary['unclaimed_in_period']['sample'], 'entry_id'));
        $this->assertSame(['closed', 0], [$this->reconciliation($id)->status, DB::table('partner_statement_unit_claims')->where('reconciliation_id', $id)->count()]);
    }

    /** @test */
    public function the_claimed_set_needs_a_proven_entry_identity_or_the_close_is_refused(): void
    {
        $service = app(PartnerStatementClaimService::class);
        $entry = fn (string $id, ?string $reversalOf = null, string $status = 'posted') => ['entry_id' => $id, 'number' => 'JE-'.$id, 'date' => '2026-09-05', 'status' => $status, 'reversal_of' => $reversalOf, 'debit_minor' => 100, 'credit_minor' => 0];
        $unit = fn (string $key, array $entries, string $state = 'active') => ['key' => $key, 'state' => $state, 'matchable' => $state === 'active', 'entries' => $entries, 'entry_ids' => array_column($entries, 'entry_id')];
        $decision = fn (string $action, array $units, array $extra = []) => new PartnerStatementReviewDecision(['line_id' => (string) Str::uuid(), 'action' => $action, 'unit_keys' => $units] + $extra);
        $reason = function (array $units, array $decisions) use ($service): ?string {
            try {
                $service->claimSet($units, $decisions);

                return null;
            } catch (PartnerStatementReviewException $e) {
                return $e->reason;
            }
        };

        $active = $unit('invoice#1', [$entry('e1'), $entry('e2')]);
        $pair = $unit('invoice#2', [$entry('o', null, 'reversed'), $entry('r', 'o')], 'neutralised');
        $link = fn (string $member, array $extra = []) => $decision('link_pair', ['invoice#2'], $extra + ['pair_member' => $member, 'pair_original_entry_id' => 'o', 'pair_reversal_entry_id' => 'r']);

        // مطالبات صحيحة.
        $this->assertSame(['e1', 'e2'], array_keys($service->claimSet([$active], ['L1' => $decision('confirm', ['invoice#1'], ['claim_entry_ids' => ['e2', 'e1']])])));
        $this->assertSame(['e1'], array_keys($service->claimSet([$unit('invoice#1', [$entry('e1')])], ['L1' => $decision('override', ['invoice#1'], ['claim_entry_ids' => ['e1']])])));
        $this->assertSame(['o'], array_keys($service->claimSet([$pair], ['L1' => $link('original')])));
        $this->assertSame(['r'], array_keys($service->claimSet([$pair], ['L1' => $link('reversal')])), 'العضو المختار فقط.');
        $this->assertSame([], $service->claimSet([$active, $pair], ['L1' => $decision('dismiss', [])]), 'dismiss لا يطالب بشيء.');
        $this->assertSame([], $service->claimSet([$active], []));

        // هوية غير محددة/غير مثبتة ⇒ رفض (لا تخمين).
        $this->assertSame('claim_identity_unproven', $reason([$active], ['L1' => $decision('confirm', ['invoice#404'])]), 'وحدة غائبة عن الدفتر الحاضر');
        $this->assertSame('claim_identity_unproven', $reason([$active], ['L1' => $decision('override', [])]), 'قرار بلا وحدات');
        $this->assertSame('claim_identity_unproven', $reason([$unit('invoice#1', [])], ['L1' => $decision('confirm', ['invoice#1'])]), 'وحدة بلا قيود');
        $this->assertSame('claim_identity_unproven', $reason([$pair], ['L1' => $decision('confirm', ['invoice#2'])]), 'وحدة معكوسة لا تُطالَب بقرار عادي');
        $this->assertSame('claim_identity_unproven', $reason([$unit('invoice#1', [$entry('e1')], 'incomplete')], ['L1' => $decision('override', ['invoice#1'])]), 'وحدة ناقصة السلسلة');
        $this->assertSame('claim_identity_unproven', $reason([$active], ['L1' => $link('original')]), 'link_pair على وحدة نشطة');
        $this->assertSame('claim_identity_unproven', $reason([$pair], ['L1' => $link('original', ['pair_original_entry_id' => 'zzz'])]), 'معرّف أصل لا يطابق قيود الوحدة');
        $this->assertSame('claim_identity_unproven', $reason([$pair], ['L1' => $link('original', ['pair_reversal_entry_id' => null])]), 'معرّف عكس مفقود');
        $this->assertSame('claim_identity_unproven', $reason([$unit('invoice#2', [$entry('o', null, 'reversed'), $entry('r', 'other')], 'neutralised')], ['L1' => $link('reversal')]), 'العكس لا يشير إلى الأصل');
        $this->assertSame('claim_identity_unproven', $reason([$pair], ['L1' => $link('both')]), 'عضو غير محدد');
        // هوية القيود المسجَّلة مع القرار (Codex P2): مفقودة أو لا تطابق قيود الوحدة المعتمدة ⇒ رفض.
        $this->assertSame('claim_identity_unproven', $reason([$active], ['L1' => $decision('confirm', ['invoice#1'])]), 'قرار قديم بلا هوية مسجَّلة');
        $this->assertSame('claim_identity_unproven', $reason([$active], ['L1' => $decision('confirm', ['invoice#1'], ['claim_entry_ids' => ['e1']])]), 'هوية ناقصة');
        $this->assertSame('claim_identity_unproven', $reason([$active], ['L1' => $decision('confirm', ['invoice#1'], ['claim_entry_ids' => ['e1', 'e2', 'zzz']])]), 'هوية بقيد غريب');
        $this->assertSame('claim_identity_unproven', $reason([$active], ['L1' => $decision('override', ['invoice#1'], ['claim_entry_ids' => []])]), 'هوية فارغة');
        $this->assertSame('claim_entry_used_twice', $reason([$active], ['L1' => $decision('confirm', ['invoice#1'], ['claim_entry_ids' => ['e1', 'e2']]), 'L2' => $decision('override', ['invoice#1'], ['claim_entry_ids' => ['e1', 'e2']])]), 'قيد لسطرين');
    }

    /** @test */
    public function a_failure_after_the_claims_are_written_rolls_the_whole_close_back_and_leaves_no_residue(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$id, $run] = $this->ready([['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000]]);
        $closer = User::query()->findOrFail($this->closerId);
        $this->actingAs($closer);
        app(TenantContext::class)->set($this->auth['tenant_id']);

        // المطالبات تُكتب قبل الحدث: فشل إدراج حدث الإغلاق (مُشغّل قاعدة بيانات مؤقت) يجب أن يُلغي المطالبات أيضاً.
        $pg = DB::connection()->getDriverName() === 'pgsql';
        if ($pg) {
            DB::unprepared("CREATE OR REPLACE FUNCTION tmp_ps_a3d_boom() RETURNS trigger LANGUAGE plpgsql AS \$fn\$ BEGIN IF NEW.action = 'close' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END \$fn\$");
            DB::unprepared('CREATE TRIGGER tmp_ps_a3d_boom AFTER INSERT ON partner_statement_reconciliation_events FOR EACH ROW EXECUTE FUNCTION tmp_ps_a3d_boom()');
        } else {
            DB::unprepared("CREATE TRIGGER tmp_ps_a3d_boom AFTER INSERT ON partner_statement_reconciliation_events WHEN NEW.action = 'close' BEGIN SELECT RAISE(ABORT, 'boom'); END");
        }
        try {
            app(PartnerStatementLifecycleService::class)->close($closer, $id, ['run_id' => $run['id']]);
            $this->fail('كان يجب أن يفشل الإغلاق.');
        } catch (QueryException $e) {
            $this->assertStringContainsString('boom', $e->getMessage());
        } finally {
            DB::unprepared($pg ? 'DROP TRIGGER tmp_ps_a3d_boom ON partner_statement_reconciliation_events' : 'DROP TRIGGER tmp_ps_a3d_boom');
        }
        $this->assertSame(['reviewed', 0, 1], [$this->reconciliation($id)->status, $this->claimCount(), $this->eventCount($id)]);
        $this->assertNull($this->reconciliation($id)->closed_at);

        // لا بقايا: الإغلاق السليم ينجح بعدها بلا تعارض مع مطالبات يتيمة.
        $this->close($this->closer, $id, $run['id'])->assertCreated();
        $this->assertSame([1, 2], [$this->claimCount(), $this->eventCount($id)]);
    }

    // ═══════════════════════════════ هوية القيود في القرار (Codex P2) ═══════════════════════════════

    /** @test */
    public function decisions_record_the_approved_entry_identity_and_an_old_decision_without_it_must_be_redecided(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        $b = $this->invoice('2026-09-05', 20000);
        $token = $this->auth['token'];
        $id = $this->statement([
            ['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000],
            ['date' => '2026-09-25', 'credit' => 23000],
            ['date' => '2026-09-28', 'credit' => 99900],
        ]);
        $run = $this->match($token, $id);
        $line = fn (int $n) => $this->lineId($id, $n);
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line(2), 'action' => 'confirm'])->assertCreated();
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line(3), 'action' => 'override', 'unit_keys' => ['invoice#'.$b->id], 'reason' => 'تحويل مؤرخ لاحقاً'])->assertCreated();
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line(4), 'action' => 'dismiss', 'reason' => 'غير موجودة'])->assertCreated();

        // الهوية مسجَّلة لـconfirm/override وحدهما بمعرّفات قيود الوحدات المعتمدة؛ والإعادة المطابقة replay بلا نسخة جديدة.
        $ids = fn (string $lineId) => json_decode((string) DB::table('partner_statement_review_decisions')->where('line_id', $lineId)->orderByDesc('revision')->value('claim_entry_ids'), true);
        $this->assertSame([$this->entryOf($a)->id], $ids($line(2)));
        $this->assertSame([$this->entryOf($b)->id], $ids($line(3)));
        $this->assertNull(DB::table('partner_statement_review_decisions')->where('line_id', $line(4))->value('claim_entry_ids'));
        $this->assertTrue($this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line(2), 'action' => 'confirm'])->assertOk()->json('replayed'));
        $this->assertSame(3, DB::table('partner_statement_review_decisions')->count());

        // قرار «قديم» بلا هوية (نسخة أحدث بلا claim_entry_ids، كما كان قبل تسجيلها): مانع صريح عند المراجعة، ولا يُطالَب بقيوده.
        $row = (array) DB::table('partner_statement_review_decisions')->where('line_id', $line(2))->orderByDesc('revision')->first();
        DB::table('partner_statement_review_decisions')->insert(['id' => (string) Str::uuid(), 'revision' => $row['revision'] + 1, 'claim_entry_ids' => null] + $row);
        $state = $this->lcStatus($this->auth['token'], $id)->assertOk()->json('data');
        $this->assertSame(['decisions_without_entry_identity', 1], [collect($state['blockers'])->firstWhere('code', 'decisions_without_entry_identity')['code'], collect($state['blockers'])->firstWhere('code', 'decisions_without_entry_identity')['count']]);
        $this->assertSame('decisions_without_entry_identity', $this->review($token, $id, $run['id'])->assertStatus(409)->json('reason'));

        // إعادة القرار نفسه تكتب نسخة جديدة بالهوية (لا replay لقرار بلا هوية) فيزول المانع ويمضي الإغلاق.
        $this->assertFalse($this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line(2), 'action' => 'confirm'])->assertCreated()->json('replayed'));
        $this->assertSame([$this->entryOf($a)->id], $ids($line(2)));
        $this->review($token, $id, $run['id'])->assertCreated();
        $this->close($this->closer, $id, $run['id'])->assertCreated();
        $this->assertEqualsCanonicalizing([$this->entryOf($a)->id, $this->entryOf($b)->id], $this->claimed($id));
    }

    /** @test */
    public function the_database_refuses_a_claim_for_an_entry_that_does_not_belong_to_the_approved_unit_even_by_raw_sql(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        $b = $this->invoice('2026-09-05', 20000);
        $c = $this->invoice('2026-09-09', 30000);   // لعميل الطرف نفسه لكنه ليس ضمن ما اعتُمد
        $x = $this->invoice('2026-09-12', 40000);
        [$id, $run] = $this->ready([
            ['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000],
            ['date' => '2026-09-25', 'credit' => 69000, 'act' => 'override', 'units' => ['invoice#'.$b->id, 'invoice#'.$x->id]],
        ]);
        $confirmedLine = $this->lineId($id, 2);
        $overrideLine = $this->lineId($id, 3);
        $row = fn (string $entryId, string $line) => [
            'id' => (string) Str::uuid(), 'tenant_id' => $this->auth['tenant_id'], 'reconciliation_id' => $id, 'partner_id' => $this->both->id, 'role' => 'customer',
            'journal_entry_id' => $entryId, 'basis' => 'decision', 'line_id' => $line, 'claimed_at' => now(), 'released_at' => null,
        ];

        // سيناريو Codex: قرار يعتمد وحدة a؛ قيد c (لا صلة له بالقرار) يُرفض. وكذلك قيد a على سطر قرار آخر، وc على سطر override.
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->insert($row($this->entryOf($c)->id, $confirmedLine)), 'قيد غير مرتبط بوحدة confirm');
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->insert($row($this->entryOf($a)->id, $overrideLine)), 'قيد وحدة سطر آخر');
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->insert($row($this->entryOf($c)->id, $overrideLine)), 'قيد غير مرتبط بوحدات override');
        $this->assertSame(0, $this->claimCount());

        // ضوابط إيجابية: كل قيد ضمن هوية القرار يُقبل (confirm: a؛ override: b وx).
        foreach ([[$a, $confirmedLine], [$b, $overrideLine], [$x, $overrideLine]] as [$invoice, $line]) {
            DB::beginTransaction();
            DB::table('partner_statement_unit_claims')->insert($row($this->entryOf($invoice)->id, $line));
            $this->assertSame(1, $this->claimCount());
            DB::rollBack();
        }

        // والإغلاق الحقيقي يكتب مطالبات الهوية المعتمدة وحدها.
        $this->close($this->closer, $id, $run['id'])->assertCreated();
        $this->assertEqualsCanonicalizing([$this->entryOf($a)->id, $this->entryOf($b)->id, $this->entryOf($x)->id], $this->claimed($id));
        $this->assertNotContains($this->entryOf($c)->id, $this->claimed($id));
    }

    /** @test */
    public function the_entry_identity_migration_is_additive_refuses_rollback_with_identities_and_reverses_when_empty(): void
    {
        $identity = require base_path('database/migrations/2027_01_02_000100_add_claim_entry_ids_to_partner_statement_review_decisions.php');
        $claims = require base_path('database/migrations/2027_01_02_010000_add_partner_statement_final_claims.php');
        $a = $this->invoice('2026-09-01', 100000);

        // فارغ: يتراجع بترتيب الاعتماد (المطالبات أولاً) ثم يصعد سليماً.
        $claims->down();
        $identity->down();
        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasColumn('partner_statement_review_decisions', 'claim_entry_ids'));
        $identity->up();
        $claims->up();
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumn('partner_statement_review_decisions', 'claim_entry_ids'));

        // الشكل: لا تحمل الهوية إلا confirm/override كمصفوفة غير فارغة.
        [$id, $run] = $this->ready([['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000]]);
        $base = (array) DB::table('partner_statement_review_decisions')->where('reconciliation_id', $id)->first();
        $this->assertRejected(fn () => DB::table('partner_statement_review_decisions')->insert(['id' => (string) Str::uuid(), 'revision' => 9, 'claim_entry_ids' => '[]'] + $base), 'مصفوفة فارغة');
        $this->assertRejected(fn () => DB::table('partner_statement_review_decisions')->insert(['id' => (string) Str::uuid(), 'revision' => 9, 'claim_entry_ids' => '{"a":1}'] + $base), 'ليست مصفوفة');
        $this->assertRejected(fn () => DB::table('partner_statement_review_decisions')->insert(['id' => (string) Str::uuid(), 'revision' => 9, 'claim_entry_ids' => '["x"]', 'action' => 'clear', 'unit_keys' => '[]'] + $base), 'هوية على غير confirm/override');

        // قرار يحمل هوية ⇒ لا تراجع (أثر تدقيق).
        $claims->down();
        try {
            $identity->down();
            $this->fail('لا تراجع بهوية مسجَّلة');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('لا يُتراجع', $e->getMessage());
        }
        $claims->up();
    }

    // ═══════════════════════════════ النطاق: مؤسسة / فرع ═══════════════════════════════

    /** @test */
    public function scope_rules_branch_finals_coexist_but_an_organisation_final_and_the_same_scope_cannot_duplicate_one_period(): void
    {
        $b1 = Branch::create(['code' => 'B1', 'name' => 'فرع 1']);
        $b2 = Branch::create(['code' => 'B2', 'name' => 'فرع 2']);
        $i1 = $this->invoice('2026-09-03', 100000, $b1->id);
        $i2 = $this->invoice('2026-09-04', 50000, $b2->id);

        [$r1, $run1] = $this->ready([['date' => '2026-09-03', 'our' => $i1->number, 'credit' => 115000]], ['branch_id' => $b1->id]);
        [$r2, $run2] = $this->ready([['date' => '2026-09-04', 'our' => $i2->number, 'credit' => 57500]], ['branch_id' => $b2->id]);
        $this->assertSame('branch', $run1['scope']['kind']);
        $this->close($this->closer, $r1, $run1['id'])->assertCreated();
        $this->close($this->closer, $r2, $run2['id'], [])->assertCreated();   // فرعان متباينان بالفترة نفسها: لا حجب كاذب
        $this->assertSame([$b1->id, $b2->id], [$this->reconciliation($r1)->scope_key, $this->reconciliation($r2)->scope_key]);

        // نهائي مؤسسة لنفس الفترة ⇒ مرفوض (الاستبدال شريحة A3e)؛ وفرع 1 ثانٍ بالفترة نفسها ⇒ مرفوض أيضاً.
        // أرقام الفواتير تسلسل لكل فرع (قد تتطابق بين الفرعين) فمرجع الكشف ملتبس على مستوى المؤسسة: يُسنَد صراحةً بالتجاوز.
        [$org, $runOrg] = $this->ready([
            ['date' => '2026-09-03', 'credit' => 115000, 'act' => 'override', 'units' => ['invoice#'.$i1->id]],
            ['date' => '2026-09-04', 'credit' => 57500, 'act' => 'override', 'units' => ['invoice#'.$i2->id]],
        ]);
        $this->assertSame('organization', $runOrg['scope']['kind']);
        $dup = $this->close($this->closer, $org, $runOrg['id'])->assertStatus(409);
        $this->assertSame('final_already_exists', $dup->json('reason'));
        $this->assertEqualsCanonicalizing([$r1, $r2], $dup->json('details.reconciliation_ids'));
        [$again, $runAgain] = $this->ready([['date' => '2026-09-03', 'our' => $i1->number, 'credit' => 115000], ['date' => '2026-09-09', 'credit' => 1, 'act' => 'dismiss']], ['branch_id' => $b1->id]);
        $this->assertSame('final_already_exists', $this->close($this->closer, $again, $runAgain['id'])->assertStatus(409)->json('reason'));
        $this->assertSame(0, count($this->claimed($org)) + count($this->claimed($again)));
    }

    /** @test */
    public function an_organisation_final_and_a_branch_final_conflict_only_through_shared_movements(): void
    {
        $b1 = Branch::create(['code' => 'C1', 'name' => 'فرع']);
        $i1 = $this->invoice('2026-09-03', 100000, $b1->id);
        [$org, $runOrg] = $this->ready([['date' => '2026-09-03', 'our' => $i1->number, 'credit' => 115000]]);
        $this->close($this->closer, $org, $runOrg['id'])->assertCreated();
        $this->assertSame('org', $this->reconciliation($org)->scope_key);

        // فرع بفترة مختلفة (1–15) يشارك القيد ⇒ تعارض حركة (النهائي المؤسسي يطالب بكل حركات الفترة).
        [$br, $runBr] = $this->ready([['date' => '2026-09-03', 'our' => $i1->number, 'credit' => 115000]], ['branch_id' => $b1->id, 'period_from' => '2026-09-01', 'period_to' => '2026-09-15']);
        $this->assertSame('unit_conflict', $this->close($this->closer, $br, $runBr['id'], [$org])->assertStatus(409)->json('reason'));
    }

    /** @test */
    public function a_user_restricted_to_several_branches_has_no_honest_single_scope_and_cannot_close(): void
    {
        $b1 = Branch::create(['code' => 'M1', 'name' => 'فرع']);
        $b2 = Branch::create(['code' => 'M2', 'name' => 'فرع']);
        $i1 = $this->invoice('2026-09-03', 100000, $b1->id);
        $multi = $this->role('ps-multi', ['partner_statements.view', 'partner_statements.reconcile', 'partner_statements.close', 'partners.view'], 'multi@ps-a3d.test');
        User::query()->where('email', 'multi@ps-a3d.test')->firstOrFail()->branches()->sync([$b1->id, $b2->id]);
        $id = $this->statement([['date' => '2026-09-03', 'our' => $i1->number, 'credit' => 115000]]);
        $run = $this->match($multi, $id);
        $this->assertSame('restricted_set', $run['scope']['kind']);
        $this->decide($multi, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();
        $this->review($multi, $id, $run['id'])->assertCreated();

        // مُغلِق بلا قيد فروع يقرأ نطاقاً أوسع من نطاق التشغيلة: التشغيلة قديمة بنطاقها (لا إغلاق بنطاق ليس نطاقه الفعلي).
        $stale = $this->close($this->closer, $id, $run['id'])->assertStatus(409);
        $this->assertSame('run_stale', $stale->json('reason'));
        $this->assertContains('scope', $stale->json('details.causes'));
        $this->assertSame(['reviewed', 0], [$this->reconciliation($id)->status, count($this->claimed($id))]);

        // وإغلاق المقيَّد بمجموعة فروع (مُراجِع آخر) مرفوض بسبب النطاق.
        $multi2 = $this->role('ps-multi2', ['partner_statements.view', 'partner_statements.close', 'partners.view'], 'multi2@ps-a3d.test');
        User::query()->where('email', 'multi2@ps-a3d.test')->firstOrFail()->branches()->sync([$b1->id, $b2->id]);
        $this->assertSame('scope_not_closable', $this->close($multi2, $id, $run['id'])->assertStatus(422)->json('reason'));
    }

    // ═══════════════════════════════ حراس القاعدة (SQL خام) ═══════════════════════════════

    /** @test */
    public function the_database_refuses_every_raw_path_to_a_closed_state_that_skips_the_guarantees(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$id, $run] = $this->ready([['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000]]);
        $recon = fn () => DB::table('partner_statement_reconciliations')->where('id', $id);
        $row = (array) $recon()->first();
        $seq = fn () => 1 + (int) DB::table('partner_statement_reconciliation_events')->where('reconciliation_id', $id)->max('seq');
        $event = fn (array $over = []) => $over + [
            'id' => (string) Str::uuid(), 'tenant_id' => $this->auth['tenant_id'], 'reconciliation_id' => $id, 'seq' => $seq(), 'action' => 'close', 'from_status' => 'reviewed', 'to_status' => 'closed',
            'run_id' => $run['id'], 'ledger_fingerprint' => str_repeat('a', 64), 'statement_digest' => str_repeat('b', 64), 'summary' => '{}', 'reason' => null,
            'created_by' => $this->closerId, 'reviewer_id' => $this->owner->id, 'claims_count' => 0, 'created_at' => now(),
        ];
        $insert = fn (array $over = []) => DB::table('partner_statement_reconciliation_events')->insert($event($over));

        // أحداث إغلاق معيبة (كل واحد مرفوض، لا يبقى شيء).
        $this->assertRejected(fn () => $insert(['created_by' => $this->owner->id]), 'المُغلِق هو المراجِع');
        $this->assertRejected(fn () => $insert(['reviewer_id' => null]), 'بلا مراجِع');
        $this->assertRejected(fn () => $insert(['claims_count' => null]), 'بلا عدد مطالبات');
        $this->assertRejected(fn () => $insert(['claims_count' => 3]), 'عدد المطالبات لا يطابق المسجَّل');
        $this->assertRejected(fn () => $insert(['reviewer_id' => $this->closerId, 'created_by' => $this->owner->id]), 'المراجِع ليس من سجّله حدث المراجعة');
        $this->assertRejected(fn () => $insert(['run_id' => (string) Str::uuid()]), 'تشغيلة لا تطابق تشغيلة المراجعة');
        $this->assertRejected(fn () => $insert(['from_status' => 'draft']), 'حافة من draft');
        $this->assertRejected(fn () => $insert(['ledger_fingerprint' => null]), 'بلا بصمة دفتر');
        $this->assertSame(1, DB::table('partner_statement_reconciliation_events')->where('reconciliation_id', $id)->count());

        // انتقال بلا حدث ⇒ مرفوض؛ مع حدث صحيح لكن بحقول إغلاق معيبة ⇒ مرفوض؛ ثم الصحيح يمرّ (ضابط إيجابي).
        $closedFields = ['status' => 'closed', 'closed_at' => now(), 'closed_by' => $this->closerId, 'scope_key' => 'org'];
        $this->assertRejected(fn () => $recon()->update($closedFields), 'closed بلا حدث إغلاق');
        $insert();
        $this->assertRejected(fn () => $recon()->update(['closed_by' => $this->owner->id] + $closedFields), 'المُغلِق هو المراجِع في الصف');
        $this->assertRejected(fn () => $recon()->update(['closed_by' => (string) Str::uuid()] + $closedFields), 'المُغلِق لا يطابق فاعل حدث الإغلاق');
        $this->assertRejected(fn () => $recon()->update(['scope_key' => null] + $closedFields), 'بلا نطاق');
        $this->assertRejected(fn () => $recon()->update(['reviewed_by' => $this->closerId] + $closedFields), 'تغيير المراجِع عند الإغلاق');
        $this->assertRejected(fn () => $recon()->update(['reviewed_run_id' => (string) Str::uuid()] + $closedFields), 'تغيير تشغيلة المراجعة عند الإغلاق');
        $this->assertRejected(fn () => $recon()->update(['status' => 'draft', 'reviewed_at' => null, 'reviewed_by' => null, 'reviewed_run_id' => null]), 'إعادة فتح بحدث إغلاق');
        $recon()->update($closedFields);
        $this->assertSame('closed', $this->reconciliation($id)->status);

        // الصف المُغلَق طرفي: لا تعديل، ولا مطالبات جديدة (ليست reviewed)، ولا إدراج closed مباشر.
        $this->assertRejected(fn () => $recon()->update(['closed_by' => $this->owner->id]), 'تعديل صف مُغلق');
        $this->assertRejected(fn () => $recon()->update(['status' => 'reviewed', 'closed_at' => null, 'closed_by' => null, 'scope_key' => null]), 'إعادة مُغلق إلى reviewed');
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $this->auth['tenant_id'], 'reconciliation_id' => $id, 'partner_id' => $this->both->id, 'role' => 'customer',
            'journal_entry_id' => $this->entryOf($a)->id, 'basis' => 'period', 'line_id' => null, 'claimed_at' => now(), 'released_at' => null,
        ]), 'مطالبة على مقارنة مُغلقة');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliations')->insert(['id' => (string) Str::uuid(), 'status' => 'closed', 'closed_at' => now(), 'closed_by' => $this->closerId, 'scope_key' => 'org', 'identity_sha256' => str_repeat('c', 64)] + $row), 'إدراج closed');
    }

    /** @test */
    public function claims_are_immutable_and_only_written_for_the_effective_decision_of_a_line_of_a_reviewed_reconciliation(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$id, $run] = $this->ready([['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000]]);
        $this->close($this->closer, $id, $run['id'])->assertCreated();
        $claim = DB::table('partner_statement_unit_claims')->where('reconciliation_id', $id)->first();

        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->where('id', $claim->id)->update(['released_at' => now()]), 'إفراج (A3e)');
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->where('id', $claim->id)->update(['line_id' => $claim->line_id]), 'تعديل');
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->where('id', $claim->id)->delete(), 'حذف');
        $this->assertSame(1, $this->claimCount());
        try {
            PartnerStatementUnitClaim::query()->firstOrFail()->update(['basis' => 'changed']);
            $this->fail('النموذج يمنع التعديل');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }

        // مقارنة reviewed أخرى بسطرين: ٢ مؤكَّد على b، ٣ مستبعد (dismiss).
        $b = $this->invoice('2026-09-02', 20000);
        [$other, $runOther] = $this->ready([
            ['date' => '2026-09-02', 'our' => $b->number, 'credit' => 23000],
            ['date' => '2026-09-25', 'credit' => 99900, 'act' => 'dismiss'],
        ]);
        $confirmed = $this->lineId($other, 2);
        $dismissed = $this->lineId($other, 3);
        $base = fn (array $over = []) => $over + [
            'id' => (string) Str::uuid(), 'tenant_id' => $this->auth['tenant_id'], 'reconciliation_id' => $other, 'partner_id' => $this->both->id, 'role' => 'customer',
            'journal_entry_id' => $this->entryOf($b)->id, 'basis' => 'decision', 'line_id' => $confirmed, 'claimed_at' => now(), 'released_at' => null,
        ];
        $insert = fn (array $over) => DB::table('partner_statement_unit_claims')->insert($base($over));
        $this->assertRejected(fn () => $insert(['journal_entry_id' => (string) Str::uuid()]), 'قيد غير موجود');
        $this->assertRejected(fn () => $insert(['partner_id' => (string) Str::uuid()]), 'طرف لا يطابق المقارنة');
        $this->assertRejected(fn () => $insert(['role' => 'supplier']), 'دور لا يطابق المقارنة');
        $this->assertRejected(fn () => $insert(['role' => 'other']), 'دور مجهول');
        $this->assertRejected(fn () => $insert(['basis' => 'period']), 'مطالبة بالفترة (لا مطالبة إلا بقرار)');
        $this->assertRejected(fn () => $insert(['line_id' => null]), 'بلا سطر');
        $this->assertRejected(fn () => $insert(['line_id' => $this->lineId($id, 2)]), 'سطر من مقارنة أخرى');
        $this->assertRejected(fn () => $insert(['line_id' => $dismissed]), 'سطر مستبعد (dismiss) لا يطالب بشيء');
        $this->assertRejected(fn () => $insert(['released_at' => now()]), 'إفراج عند الإدراج');
        $this->assertRejected(fn () => $insert(['tenant_id' => (string) Str::uuid()]), 'مستأجر آخر');
        $this->assertRejected(fn () => $insert(['basis' => 'weird']), 'basis مجهول');
        $this->assertSame(1, $this->claimCount());

        // ضابط إيجابي: المطالبة المشروعة (سطر مؤكَّد، قيده) تُقبل على مقارنة reviewed.
        DB::beginTransaction();
        $insert([]);
        $this->assertSame(1, DB::table('partner_statement_unit_claims')->where('reconciliation_id', $other)->count());
        DB::rollBack();
    }

    /** @test */
    public function a_cleared_line_and_the_unchosen_pair_member_can_never_be_claimed_even_by_raw_sql(): void
    {
        $p = $this->invoice('2026-09-29', 100000);
        $original = $this->entryOf($p);
        app(LedgerService::class)->reverse($original, '2026-10-02', 'إلغاء');
        $reversal = JournalEntry::query()->where('reversal_of', $original->id)->firstOrFail();
        $unit = 'invoice#'.$p->id;
        $id = $this->statement([['date' => '2026-09-29', 'credit' => 115000], ['date' => '2026-09-30', 'credit' => 7]]);
        $run = $this->match($this->auth['token'], $id);
        $token = $this->auth['token'];
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'link_pair', 'unit_keys' => [$unit], 'pair_member' => 'original', 'reason' => 'ربط الأصل'])->assertCreated();
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 3), 'action' => 'dismiss', 'reason' => 'غير موجود'])->assertCreated();
        $this->review($token, $id, $run['id'])->assertCreated();

        $row = fn (string $entryId, string $line) => [
            'id' => (string) Str::uuid(), 'tenant_id' => $this->auth['tenant_id'], 'reconciliation_id' => $id, 'partner_id' => $this->both->id, 'role' => 'customer',
            'journal_entry_id' => $entryId, 'basis' => 'decision', 'line_id' => $line, 'claimed_at' => now(), 'released_at' => null,
        ];
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->insert($row($reversal->id, $this->lineId($id, 2))), 'العضو غير المختار (العكس)');
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->insert($row($original->id, $this->lineId($id, 3))), 'سطر مستبعد');
        DB::beginTransaction();
        DB::table('partner_statement_unit_claims')->insert($row($original->id, $this->lineId($id, 2)));   // العضو المختار يُقبل
        DB::rollBack();

        // قرار مسحوب (clear) لا يترك مطالبة ممكنة: أعد الفتح، اسحب قرار السطر ٢، ثم راجع من جديد بقرار آخر لسطر ٣ فقط.
        $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/reopen", ['reason' => 'اختبار السحب'])->assertOk();
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear'])->assertCreated();
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->insert($row($original->id, $this->lineId($id, 2))), 'قرار مسحوب');
    }

    /** @test */
    public function the_database_also_refuses_a_second_final_of_an_identical_period_across_scopes_and_the_service_refuses_it_first(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$one, $runOne] = $this->ready([['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000]]);
        $this->close($this->closer, $one, $runOne['id'])->assertCreated();   // org
        [$two, $runTwo] = $this->ready([['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000], ['date' => '2026-09-07', 'credit' => 1, 'act' => 'dismiss']]);
        $this->assertSame('final_already_exists', $this->close($this->closer, $two, $runTwo['id'])->assertStatus(409)->json('reason'));

        // تجاوز الخدمة: حدث إغلاق صحيح ثم تحديث إلى closed بنطاق فرع لفترة النهائي المؤسسي نفسها ⇒ مُشغّل «مؤسسة ⇄ أي نطاق».
        $seq = 1 + (int) DB::table('partner_statement_reconciliation_events')->where('reconciliation_id', $two)->max('seq');
        DB::table('partner_statement_reconciliation_events')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $this->auth['tenant_id'], 'reconciliation_id' => $two, 'seq' => $seq, 'action' => 'close', 'from_status' => 'reviewed', 'to_status' => 'closed',
            'run_id' => $runTwo['id'], 'ledger_fingerprint' => str_repeat('a', 64), 'statement_digest' => str_repeat('b', 64), 'summary' => '{}', 'reason' => null,
            'created_by' => $this->closerId, 'reviewer_id' => $this->owner->id, 'claims_count' => 0, 'created_at' => now(),
        ]);
        foreach (['org', (string) Str::uuid()] as $scope) {
            $this->assertRejected(fn () => DB::table('partner_statement_reconciliations')->where('id', $two)->update(['status' => 'closed', 'closed_at' => now(), 'closed_by' => $this->closerId, 'scope_key' => $scope]), "نهائي ثانٍ بنطاق {$scope}");
        }
        $this->assertSame('reviewed', $this->reconciliation($two)->status);
    }

    /** @test */
    public function the_same_scope_unique_index_refuses_two_finals_of_one_branch_and_period_even_by_raw_sql(): void
    {
        $b1 = Branch::create(['code' => 'U1', 'name' => 'فرع']);
        $i1 = $this->invoice('2026-09-03', 100000, $b1->id);
        [$one, $runOne] = $this->ready([['date' => '2026-09-03', 'our' => $i1->number, 'credit' => 115000]], ['branch_id' => $b1->id]);
        $this->close($this->closer, $one, $runOne['id'])->assertCreated();
        [$two, $runTwo] = $this->ready([['date' => '2026-09-03', 'our' => $i1->number, 'credit' => 115000], ['date' => '2026-09-09', 'credit' => 1, 'act' => 'dismiss']], ['branch_id' => $b1->id]);
        $this->assertSame('final_already_exists', $this->close($this->closer, $two, $runTwo['id'])->assertStatus(409)->json('reason'));

        // تجاوز الخدمة: حدث إغلاق صحيح (0 مطالبات) ثم تحديث إلى closed بنطاق الفرع نفسه ⇒ الفهرس الفريد الجزئي لنفس النطاق/الفترة وحده يمنعه (المُشغّل يخص المؤسسة فقط).
        $seq = 1 + (int) DB::table('partner_statement_reconciliation_events')->where('reconciliation_id', $two)->max('seq');
        DB::table('partner_statement_reconciliation_events')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $this->auth['tenant_id'], 'reconciliation_id' => $two, 'seq' => $seq, 'action' => 'close', 'from_status' => 'reviewed', 'to_status' => 'closed',
            'run_id' => $runTwo['id'], 'ledger_fingerprint' => str_repeat('a', 64), 'statement_digest' => str_repeat('b', 64), 'summary' => '{}', 'reason' => null,
            'created_by' => $this->closerId, 'reviewer_id' => $this->owner->id, 'claims_count' => 0, 'created_at' => now(),
        ]);
        $close = fn (string $scope) => DB::table('partner_statement_reconciliations')->where('id', $two)->update(['status' => 'closed', 'closed_at' => now(), 'closed_by' => $this->closerId, 'scope_key' => $scope]);
        $this->assertRejected(fn () => $close($b1->id), 'نهائي ثانٍ بنطاق الفرع والفترة نفسيهما');
        $this->assertSame('reviewed', $this->reconciliation($two)->status);
        $close((string) Str::uuid());   // ضابط إيجابي: نطاق فرع آخر يمرّ (الفهرس لا يحجب كاذباً)
        $this->assertSame('closed', $this->reconciliation($two)->status);
    }

    // ═══════════════════════════════ البوابات والعزل والوثائق ═══════════════════════════════

    /** @test */
    public function the_application_gate_tenant_isolation_and_strict_input_apply_to_the_close_route(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$id, $run] = $this->ready([['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000]]);
        $other = $this->registerTenant('ps-a3d-other', 'owner@other-a3d.test');
        $message = PartnerStatementImportService::PARTNER_UNAVAILABLE;
        $this->assertSame($message, $this->close($other['token'], $id, $run['id'])->assertStatus(422)->json('message'));
        $this->assertSame(0, $this->claimCount());

        $this->withToken($this->closer)->postJson("/api/partner-statement-reconciliations/{$id}/close", ['run_id' => $run['id'], 'force' => true])->assertStatus(422);
        $this->withToken($this->closer)->postJson("/api/partner-statement-reconciliations/{$id}/close", ['run_id' => $run['id'], 'acknowledge_overlap' => ['nope']])->assertStatus(422);
        $this->withToken($this->closer)->postJson("/api/partner-statement-reconciliations/{$id}/close", ['run_id' => $run['id'], 'note' => str_repeat('x', 501)])->assertStatus(422);
        // لا سقف على قائمة الإقرار (Codex #1941): الإقرار يطابق قائمة الخادم كاملةً مهما طالت؛ 250 معرّفاً تجتاز التحقق وتُرفض لعدم المطابقة (لا 422).
        $many = array_map(fn () => (string) Str::uuid(), range(1, 250));
        $this->assertSame('overlap_ack_stale', $this->close($this->closer, $id, $run['id'], $many)->assertStatus(409)->json('reason'));
        $this->close($this->closer, 'not-a-uuid', $run['id'])->assertNotFound();

        // معلَّقة ⇒ قراءة فقط: الإغلاق 403.
        app(TenantContext::class)->set($this->auth['tenant_id']);   // registerTenant أعاد سياق المستأجر الآخر
        app(TenantApplicationService::class)->disable('accounting.partner_statements', null);   // suspended (بيانات قائمة) أو disabled: الإغلاق كتابة فيُمنع في الحالتين
        $this->close($this->closer, $id, $run['id'])->assertForbidden();
        $this->assertSame('reviewed', $this->reconciliation($id)->status);

        $off = $this->registerTenant('ps-a3d-off', 'owner@off-a3d.test', autoEnableApplications: false);
        $this->close($off['token'], '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000')->assertForbidden();
    }

    /** @test */
    public function the_close_code_references_no_financial_writer_and_writes_only_its_own_tables(): void
    {
        $files = ['app/Services/PartnerStatementClaimService.php', 'app/Services/PartnerStatementLifecycleService.php', 'app/Models/PartnerStatementUnitClaim.php'];
        $forbidden = ['LedgerService', 'JournalEntry', 'JournalLine', 'journal_entries', 'journal_lines', 'InventoryService', 'StockMovement', 'Zatca', 'InvoiceService', 'PaymentService',
            'PurchaseService', 'ExpenseService', 'CreditNoteService', 'ReturnService', 'PartnerService', 'AccountBalance', 'DB::table', '->save(', '->delete(', '->forceDelete('];
        foreach ($files as $file) {
            $source = '';
            foreach (token_get_all((string) file_get_contents(base_path($file))) as $token) {
                if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                    continue;
                }
                $source .= is_array($token) ? $token[1] : $token;
            }
            foreach ($forbidden as $needle) {
                $this->assertStringNotContainsString($needle, $source, "{$file} يذكر {$needle}");
            }
            preg_match_all('/([A-Za-z\\\\]+)::(?:create|insert|forceCreate|updateOrCreate)\(/', $source, $writes);
            foreach ($writes[1] as $target) {
                $this->assertContains($target, ['PartnerStatementReconciliationEvent', 'PartnerStatementUnitClaim'], "{$file} يكتب على {$target}");
            }
        }
        // مِرساة المستأجر تُقفل قبل قراءة الدفتر في الإغلاق (يحرسه اختبار التزامن PostgreSQL أيضاً).
        $source = (string) file_get_contents(base_path('app/Services/PartnerStatementLifecycleService.php'));
        $this->assertLessThan(strpos($source, '$this->matching->source($actor, $fresh);', (int) strpos($source, 'public function close(')), strpos($source, 'lockLedgerAnchor()'), 'قفل المِرساة قبل قراءة الدفتر.');
    }

    /** @test */
    public function the_migration_refuses_rollback_with_claims_or_closed_rows_and_is_reversible_when_empty(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        [$id, $run] = $this->ready([['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000]]);
        $migration = require base_path('database/migrations/2027_01_02_010000_add_partner_statement_final_claims.php');

        // قبل أي إغلاق: لا مطالبات ولا أحداث إغلاق ⇒ يتراجع ثم يصعد سليماً (الحراس تعود).
        $migration->down();
        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasTable('partner_statement_unit_claims'));
        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasColumn('partner_statement_reconciliations', 'closed_by'));
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliations')->where('id', $id)->update(['status' => 'closed']), 'A3c لا يقبل closed');
        $migration->up();
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasTable('partner_statement_unit_claims'));

        $this->close($this->closer, $id, $run['id'])->assertCreated();
        try {
            $migration->down();
            $this->fail('لا تراجع بمطالبات/إغلاق قائم');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('لا يُتراجع', $e->getMessage());
        }
        $this->assertSame(1, $this->claimCount());
    }
}
