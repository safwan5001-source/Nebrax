<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementReconciliation;
use App\Models\PartnerStatementReconciliationEvent;
use App\Models\PartnerStatementReviewDecision;
use App\Models\Role;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\PartnerStatementDigest;
use App\Services\PartnerStatementImportService;
use App\Services\TenantApplicationService;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * IMP-PARTNER-STATEMENTS PS-A3c — دورة حالات المطابقة `draft ⇄ reviewed` (الإغلاق محجوب حتى PS-A3d)، إجراء `dismiss`، بصمة سطور الكشف، حراس القاعدة، سجل الأحداث append-only،
 * RBAC/عزل/فروع/بوابة القدرة، التشغيلات القديمة، وعدم الأثر المالي. تشغيل: php artisan test --filter=PartnerStatementLifecycleApiTest
 */
class PartnerStatementLifecycleApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private array $auth;

    private User $owner;

    private Partner $both;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->auth = $this->registerTenant('ps-a3c', 'owner@ps-a3c.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->owner = User::query()->where('email', 'owner@ps-a3c.test')->firstOrFail();
        $this->both = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف الدورة', 'is_active' => true]);
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

    /** @param list<array{date: string, ref?: string, our?: string, debit?: int, credit?: int}> $rows @param array<string, mixed> $over */
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

    private function reopen(string $token, string $id, ?string $reason = 'بيانات تحتاج مراجعة')
    {
        return $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/reopen", $reason === null ? [] : ['reason' => $reason]);
    }

    private function lcStatus(string $token, string $id, array $query = [])
    {
        return $this->withToken($token)->getJson("/api/partner-statement-reconciliations/{$id}/status".($query === [] ? '' : '?'.http_build_query($query)));
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

    private function counts(): array
    {
        $tables = ['journal_entries', 'journal_lines', 'account_balances', 'invoices', 'payments', 'purchases', 'stock_movements', 'credit_notes', 'return_documents'];

        return array_map(fn (string $t): int => DB::table($t)->count(), array_combine($tables, $tables));
    }

    private function eventCount(): int
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return PartnerStatementReconciliationEvent::query()->count();
    }

    private function reconciliation(string $id): PartnerStatementReconciliation
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return PartnerStatementReconciliation::query()->findOrFail($id);
    }

    /**
     * ٣ أسطر كشف: ٢ ⇒ مطابق R1، ٣ ⇒ مفقود (فاتورة b بعيدة زمنياً) يُسنَد يدوياً، ٤ ⇒ غير موجود في دفاترنا إطلاقاً.
     *
     * @return array{0: Invoice, 1: Invoice, 2: string, 3: array<string, mixed>}
     */
    private function scenario(): array
    {
        $a = $this->invoice('2026-09-01', 100000);
        $b = $this->invoice('2026-09-05', 20000);
        $id = $this->statement([
            ['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000],   // ٢
            ['date' => '2026-09-25', 'credit' => 23000],                         // ٣ (missing_in_books)
            ['date' => '2026-09-28', 'credit' => 99900],                         // ٤ (missing_in_books)
        ]);

        return [$a, $b, $id, $this->match($this->auth['token'], $id)];
    }

    /** يعالج الأسطر الثلاثة بقرارات صريحة (confirm · override · dismiss). */
    private function resolveAll(string $id, array $run, Invoice $b): void
    {
        $token = $this->auth['token'];
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 3), 'action' => 'override', 'unit_keys' => ['invoice#'.$b->id], 'reason' => 'تحويل مؤرخ لاحقاً'])->assertCreated();
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 4), 'action' => 'dismiss', 'reason' => 'دفعة لم تصل دفاترنا'])->assertCreated();
    }

    // ═══════════════════════════════ الدورة ═══════════════════════════════

    /** @test */
    public function the_lifecycle_moves_draft_to_reviewed_and_back_with_a_full_audit_trail_and_no_financial_effect(): void
    {
        [$a, $b, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        $before = $this->counts();

        // قبل المعالجة: لا جاهزية، والمحاولة المبكرة مرفوضة بلا أي أثر.
        $early = $this->lcStatus($token, $id)->assertOk()->json('data');
        $this->assertSame([false, 3, 3, 0], [$early['readiness']['can_mark_reviewed'], $early['readiness']['lines_total'], $early['readiness']['unresolved'], $early['readiness']['resolved']]);
        $this->assertSame(['unresolved_lines', 3, [2, 3, 4]], [$early['blockers'][0]['code'], $early['blockers'][0]['count'], $early['blockers'][0]['sample_ordinals']]);
        $blocked = $this->review($token, $id, $run['id'])->assertStatus(409);
        $this->assertSame(['unresolved_lines', 3], [$blocked->json('reason'), $blocked->json('details.count')]);
        $this->assertSame(['draft', 0], [$this->reconciliation($id)->status, $this->eventCount()]);

        $this->resolveAll($id, $run, $b);
        $ready = $this->lcStatus($token, $id)->assertOk()->json('data');
        $this->assertEquals([true, 3, 0, ['confirm' => 1, 'dismiss' => 1, 'override' => 1]], [
            $ready['readiness']['can_mark_reviewed'], $ready['readiness']['resolved'], $ready['readiness']['unresolved'], $ready['readiness']['decisions_by_action'],
        ]);
        $this->assertSame(['available' => false, 'blocked_reason' => 'close_blocked_pending_claims'], $ready['close']);

        // draft → reviewed
        $reviewed = $this->review($token, $id, $run['id'])->assertCreated();
        $this->assertFalse($reviewed->json('replayed'));
        $this->assertSame(['reviewed', $this->owner->id, $run['id']], [$reviewed->json('data.reconciliation.status'), $reviewed->json('data.reconciliation.reviewed_by'), $reviewed->json('data.reconciliation.reviewed_run_id')]);
        $this->assertSame([false, false], [$reviewed->json('data.reviewed_state.ledger_changed_since_review'), $reviewed->json('data.reviewed_state.statement_changed_since_review')]);

        $events = $this->events($token, $id)->assertOk()->json('data');
        $this->assertCount(1, $events);
        $this->assertSame(['mark_reviewed', 1, 'draft', 'reviewed', $run['id']], [$events[0]['action'], $events[0]['seq'], $events[0]['from_status'], $events[0]['to_status'], $events[0]['run_id']]);
        $this->assertSame($run['ledger_fingerprint'], $events[0]['ledger_fingerprint']);
        $this->assertSame(app(PartnerStatementDigest::class)->for($id), $events[0]['statement_digest']);
        $this->assertEquals(
            [3, ['confirm' => 1, 'dismiss' => 1, 'override' => 1], 99900, 1],
            [$events[0]['summary']['lines_total'], $events[0]['summary']['decisions_by_action'], $events[0]['summary']['accepted_difference_minor'], $events[0]['summary']['ledger_units_missing_in_statement']],
        );

        // إعادة الطلب نفسه: لا حدث جديد.
        $this->assertTrue($this->review($token, $id, $run['id'])->assertOk()->json('replayed'));
        $this->assertSame(1, $this->eventCount());

        // المراجعة المقفلة لا تقبل قراراً (A3a).
        $this->assertSame('reconciliation_not_editable', $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear'])->assertStatus(409)->json('reason'));

        // reviewed → draft: سبب إلزامي؛ ثم القرارات تعود متاحة والسجل كله باقٍ.
        $this->reopen($token, $id, null)->assertStatus(422);
        $this->assertSame('reason_required', $this->reopen($token, $id, 'ab')->assertStatus(422)->json('reason'));
        $this->assertSame('draft', $this->reopen($token, $id)->assertOk()->json('data.reconciliation.status'));
        $this->assertSame('reconciliation_not_reviewed', $this->reopen($token, $id)->assertStatus(409)->json('reason'));
        $afterReopen = $this->reconciliation($id);
        $this->assertSame([null, null, null], [$afterReopen->reviewed_at, $afterReopen->reviewed_by, $afterReopen->reviewed_run_id]);
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 4), 'action' => 'clear'])->assertCreated();
        $this->assertSame('unresolved_lines', $this->review($token, $id, $run['id'])->assertStatus(409)->json('reason'));

        $log = $this->events($token, $id)->assertOk()->json('data');
        $this->assertSame([['reopen', 2, 'بيانات تحتاج مراجعة'], ['mark_reviewed', 1, null]], array_map(fn ($e) => [$e['action'], $e['seq'], $e['reason']], $log));
        $this->assertSame(4, PartnerStatementReviewDecision::query()->count(), 'القرارات الثلاثة + clear، ولا شيء محذوف.');
        $this->assertSame($before, $this->counts(), 'لا قيد ولا مستند ولا دفعة ولا رصيد ولا مخزون.');
    }

    /** @test */
    public function a_reviewed_reconciliation_is_not_silently_replaced_by_a_review_on_another_run_and_the_ledger_drift_is_announced(): void
    {
        [$a, $b, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        $this->resolveAll($id, $run, $b);
        $this->review($token, $id, $run['id'])->assertCreated();

        $this->invoice('2026-09-20', 1000);          // الدفتر يتحرك بعد المراجعة (قفل المراجعة لا يحمي الأستاذ)
        $second = $this->match($token, $id);
        $this->assertSame('reconciliation_not_draft', $this->review($token, $id, $second['id'])->assertStatus(409)->json('reason'));
        $this->assertSame(1, $this->eventCount());
        $this->assertTrue($this->lcStatus($token, $id)->json('data.reviewed_state.ledger_changed_since_review'), 'تغيّر الدفتر بعد المراجعة يُعلَن.');
        $this->assertFalse($this->lcStatus($token, $id)->json('data.reviewed_state.statement_changed_since_review'));
    }

    /** @test */
    public function closing_is_blocked_by_the_service_the_api_and_the_database(): void
    {
        [$a, $b, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        $this->resolveAll($id, $run, $b);

        // draft وreviewed كلاهما: 409 برمز ثابت وبلا أثر.
        $r = $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/close")->assertStatus(409);
        $this->assertSame('close_blocked_pending_claims', $r->json('reason'));
        $this->review($token, $id, $run['id'])->assertCreated();
        $this->assertSame('close_blocked_pending_claims', $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/close")->assertStatus(409)->json('reason'));
        $this->assertSame('reviewed', $this->reconciliation($id)->status);
        $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/close", ['force' => true])->assertStatus(422);

        // القاعدة نفسها لا تقبل `closed` (ولا غيرها) حتى لو تجاوزنا الخدمة: لا بتحديث ولا بإدراج.
        foreach (['closed', 'voided', 'superseded', 'anything'] as $status) {
            $this->assertRejected(fn () => DB::table('partner_statement_reconciliations')->where('id', $id)->update(['status' => $status]), "تحديث إلى {$status}");
        }
        $row = (array) DB::table('partner_statement_reconciliations')->where('id', $id)->first();
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliations')->insert(['id' => (string) Str::uuid(), 'status' => 'closed', 'identity_sha256' => str_repeat('b', 64)] + $row), 'إدراج بحالة closed');
    }

    /** @test */
    public function review_is_refused_for_a_stale_run_and_for_decisions_made_on_another_run(): void
    {
        [$a, $b, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        $this->resolveAll($id, $run, $b);

        // الدفتر تغيّر بعد التشغيل ⇒ التشغيلة قديمة: لا reviewed، وتُعرض السبب في الحالة أيضاً.
        $this->invoice('2026-09-20', 1000);
        $stale = $this->review($token, $id, $run['id'])->assertStatus(409);
        $this->assertSame(['run_stale', ['ledger_fingerprint']], [$stale->json('reason'), $stale->json('details.causes')]);
        $state = $this->lcStatus($token, $id, ['run_id' => $run['id']])->assertOk()->json('data');
        $this->assertSame('run_stale', collect($state['blockers'])->firstWhere('code', 'run_stale')['code']);
        $this->assertSame('draft', $this->reconciliation($id)->status);

        // تشغيلة جديدة: القرارات القديمة تخص تشغيلة أخرى ⇒ مانع صريح بعددها، وتُعاد على التشغيلة الجديدة.
        $fresh = $this->match($token, $id);
        $other = $this->review($token, $id, $fresh['id'])->assertStatus(409);
        $this->assertSame(['decisions_on_other_runs', 3], [$other->json('reason'), $other->json('details.count')]);
        $state = $this->lcStatus($token, $id, ['run_id' => $fresh['id']])->assertOk()->json('data');
        $this->assertSame([3, 0, 0], [$state['readiness']['decisions_on_other_runs'], $state['readiness']['unresolved'], $state['readiness']['resolved']]);
        $this->resolveAllOnRun($id, $fresh, $b);
        $this->review($token, $id, $fresh['id'])->assertCreated();
        $this->assertSame('reconciliation_not_editable', $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear'])->assertStatus(409)->json('reason'));
        // وبعد إعادة الفتح تبقى التشغيلة القديمة مرفوضة (قديمة).
        $this->reopen($token, $id)->assertOk();
        $this->assertSame('run_stale', $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear'])->assertStatus(409)->json('reason'));
    }

    /** يعيد معالجة الأسطر على تشغيلة جديدة (القرار الجديد يحلّ محل الفعّال القديم بنسخة تالية). */
    private function resolveAllOnRun(string $id, array $run, Invoice $b): void
    {
        $this->resolveAll($id, $run, $b);
    }

    // ═══════════════════════════════ بصمة سطور الكشف ═══════════════════════════════

    /** @test */
    public function the_statement_lines_digest_detects_changes_made_outside_the_application(): void
    {
        [$a, $b, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        $digest = app(PartnerStatementDigest::class)->for($id);

        // نقطة الثقة: البصمة مكتوبة عند الاستيراد وعلى التشغيلة.
        $this->assertSame([$digest, $digest], [$this->reconciliation($id)->lines_digest, DB::table('partner_statement_match_runs')->where('id', $run['id'])->value('statement_digest')]);
        $this->resolveAll($id, $run, $b);

        // تعديل مبلغ سطر بـSQL خام: القرار والمراجعة والتشغيلة الجديدة كلها ترفض.
        $line = $this->lineId($id, 3);
        DB::table('partner_statement_lines')->where('id', $line)->update(['credit_minor' => 24000]);
        $this->assertNotSame($digest, app(PartnerStatementDigest::class)->for($id));
        $stale = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear'])->assertStatus(409);
        $this->assertSame(['run_stale', true], [$stale->json('reason'), in_array('statement_digest', $stale->json('details.causes'), true)]);
        $this->assertSame('statement_changed', $this->review($token, $id, $run['id'])->assertStatus(409)->json('reason'));
        $this->assertSame('statement_changed', $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/match")->assertStatus(409)->json('reason'));
        $codes = array_column($this->lcStatus($token, $id, ['run_id' => $run['id']])->json('data.blockers'), 'code');
        $this->assertContains('statement_changed', $codes);
        $this->assertContains('run_stale', $codes);

        // العودة إلى القيمة الأصلية تعيد البصمة (البصمة تقيس المحتوى لا التاريخ).
        DB::table('partner_statement_lines')->where('id', $line)->update(['credit_minor' => 23000]);
        $this->assertSame($digest, app(PartnerStatementDigest::class)->for($id));
        $this->review($token, $id, $run['id'])->assertCreated();

        // حذف سطر أو إدراج سطر خارج التطبيق يغيّر البصمة أيضاً (بعد إعادة الفتح).
        $this->reopen($token, $id)->assertOk();
        $extra = (array) DB::table('partner_statement_lines')->where('id', $line)->first();
        DB::table('partner_statement_lines')->insert(['id' => (string) Str::uuid(), 'ordinal' => 99] + $extra);
        $this->assertNotSame($digest, app(PartnerStatementDigest::class)->for($id));
        $this->assertSame('statement_changed', $this->review($token, $id, $run['id'])->assertStatus(409)->json('reason'));
        DB::table('partner_statement_lines')->where('ordinal', 99)->where('reconciliation_id', $id)->delete();
        $this->assertSame($digest, app(PartnerStatementDigest::class)->for($id));
    }

    /** @test */
    public function a_run_without_a_statement_digest_is_stale_and_must_be_rerun(): void
    {
        [$a, $b, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        // تشغيلة من قبل A3c (بلا بصمة): لا اعتماد عليها.
        DB::table('partner_statement_match_runs')->where('id', $run['id'])->update(['statement_digest' => null, 'run_key' => str_repeat('0', 64)]);   // مفتاح الصيغة القديمة بلا بصمة

        $r = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertStatus(409);
        $this->assertSame(['run_stale', ['statement_digest_missing']], [$r->json('reason'), $r->json('details.causes')]);
        $fresh = $this->match($token, $id);
        $this->assertNotSame($run['id'], $fresh['id'], 'البصمة جزء من مفتاح التشغيلة فتُنشأ تشغيلة جديدة.');
        $this->decide($token, $id, ['run_id' => $fresh['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();
    }

    // ═══════════════════════════════ dismiss ═══════════════════════════════

    /** @test */
    public function dismiss_requires_a_reason_and_an_engine_verdict_of_missing_in_books_and_has_no_financial_effect(): void
    {
        [$a, $b, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        $before = $this->counts();
        $line4 = $this->lineId($id, 4);
        $base = ['run_id' => $run['id'], 'line_id' => $line4, 'action' => 'dismiss'];

        $this->assertSame('reason_required', $this->decide($token, $id, $base)->assertStatus(422)->json('reason'));
        $this->assertSame('reason_required', $this->decide($token, $id, $base + ['reason' => ' ab '])->assertStatus(422)->json('reason'));
        $this->assertSame('unit_keys_not_allowed', $this->decide($token, $id, $base + ['reason' => 'سبب كاف', 'unit_keys' => ['invoice#'.$b->id]])->assertStatus(422)->json('reason'));
        $this->assertSame('pair_member_not_allowed', $this->decide($token, $id, $base + ['reason' => 'سبب كاف', 'pair_member' => 'original'])->assertStatus(422)->json('reason'));
        // سطر حكم المحرّك بمطابقته (matched) لا يُستبعد.
        $matched = $this->decide($token, $id, ['line_id' => $this->lineId($id, 2)] + $base + ['reason' => 'سبب كاف'])->assertStatus(422);
        $this->assertSame(['dismiss_requires_missing_in_books', 'matched'], [$matched->json('reason'), $matched->json('details.engine_outcome')]);
        $this->assertSame(0, PartnerStatementReviewDecision::query()->count());

        $ok = $this->decide($token, $id, $base + ['reason' => 'دفعة لم تصل دفاترنا'])->assertCreated();
        $this->assertSame(['dismiss', [], 'missing_in_books', 99900, 0, 99900, true], [
            $ok->json('data.action'), $ok->json('data.unit_keys'), $ok->json('data.engine_outcome'), $ok->json('data.expected_net_minor'), $ok->json('data.set_net_minor'),
            $ok->json('data.difference_minor'), $ok->json('data.accepted_difference'),
        ]);
        $this->assertSame([true, 1], [$this->decide($token, $id, $base + ['reason' => 'دفعة لم تصل دفاترنا'])->assertOk()->json('replayed'), PartnerStatementReviewDecision::query()->count()]);

        // الاستبعاد لا يحجز وحدة: السطر الآخر يأخذ وحدته بلا تعارض. ثم السحب يعيد السطر بلا قرار.
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 3), 'action' => 'override', 'unit_keys' => ['invoice#'.$b->id], 'reason' => 'سبب كاف'])->assertCreated();
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line4, 'action' => 'clear'])->assertCreated();
        $this->assertSame(1, $this->lcStatus($token, $id)->assertOk()->json('data.readiness.resolved'));
        $this->assertSame($before, $this->counts());
    }

    /**
     * Codex #1939 P2: الاستبعاد يقبل مبلغ السطر كله صراحةً حتى لو كان داخل التسامح؛ والمجموع المسجَّل في حدث المراجعة يشمل كل فرق مالي قُبل (مطلقاً) لا ما تجاوز التسامح وحده.
     *
     * @test
     */
    public function dismissing_a_line_inside_the_tolerance_still_records_the_full_accepted_difference_in_the_decision_and_the_audit_summary(): void
    {
        $a = $this->invoice('2026-09-01', 100000);
        $id = $this->statement([
            ['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000],   // ٢ ⇒ matched
            ['date' => '2026-09-20', 'credit' => 50],                            // ٣ ⇒ ٠٫٥٠ ر.س، داخل التسامح (١٫٠٠) ومفقود في الدفاتر
        ], ['amount_tolerance_minor' => 100]);
        $run = $this->match($this->auth['token'], $id);
        $token = $this->auth['token'];

        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();
        $row = collect($this->withToken($token)->getJson("/api/partner-statement-reconciliations/{$id}/matches?per_page=50&side=statement")->json('data'))->firstWhere('ordinal', 3);
        $this->assertSame('missing_in_books', $row['outcome']);

        $d = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 3), 'action' => 'dismiss', 'reason' => 'مبلغ زهيد غير موجود'])->assertCreated();
        $this->assertSame([50, true], [$d->json('data.difference_minor'), $d->json('data.accepted_difference')]);

        $this->review($token, $id, $run['id'])->assertCreated();
        $this->assertSame(50, $this->events($token, $id)->json('data.0.summary.accepted_difference_minor'));
    }

    /** @test */
    public function the_database_guards_the_dismiss_shape_and_the_migration_refuses_rollback_with_dismissals(): void
    {
        [$a, $b, $id, $run] = $this->scenario();
        $this->decide($this->auth['token'], $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 4), 'action' => 'dismiss', 'reason' => 'سبب كاف'])->assertCreated();
        $row = (array) DB::table('partner_statement_review_decisions')->first();
        $make = fn (array $over): array => $over + ['id' => (string) Str::uuid(), 'revision' => 2] + $row;

        $this->assertRejected(fn () => DB::table('partner_statement_review_decisions')->insert($make(['reason' => null])), 'dismiss بلا سبب');
        $this->assertRejected(fn () => DB::table('partner_statement_review_decisions')->insert($make(['reason' => 'ab'])), 'dismiss بسبب قصير');
        $this->assertRejected(fn () => DB::table('partner_statement_review_decisions')->insert($make(['unit_keys' => '["invoice#x"]'])), 'dismiss بوحدات');
        $this->assertRejected(fn () => DB::table('partner_statement_review_decisions')->insert($make(['pair_member' => 'original'])), 'dismiss بعضو زوج');
        $this->assertRejected(fn () => DB::table('partner_statement_review_decisions')->insert($make(['action' => 'invented'])), 'إجراء غير معروف');
        $this->assertSame(1, PartnerStatementReviewDecision::query()->count());

        $migration = require base_path('database/migrations/2026_12_31_020000_add_dismiss_to_partner_statement_review_decisions.php');
        try {
            $migration->down();
            $this->fail('down() يجب أن يرفض');
        } catch (\RuntimeException) {
            $this->addToAssertionCount(1);
        }
    }

    // ═══════════════════════════════ حراس القاعدة ═══════════════════════════════

    private function assertRejected(callable $fn, string $why): void
    {
        try {
            DB::transaction($fn);
            $this->fail($why);
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
    }

    /** @test */
    public function the_database_refuses_status_changes_without_a_matching_event_and_freezes_the_imported_identity(): void
    {
        [$a, $b, $id, $run] = $this->scenario();
        $this->resolveAll($id, $run, $b);
        $recon = fn () => DB::table('partner_statement_reconciliations')->where('id', $id);

        // تغيّر الحالة بلا حدث، أو بحدث لا يطابق الحافة، أو بحقول مراجعة ناقصة: مرفوض.
        $this->assertRejected(fn () => $recon()->update(['status' => 'reviewed', 'reviewed_at' => now(), 'reviewed_by' => $this->owner->id, 'reviewed_run_id' => $run['id']]), 'reviewed بلا حدث');
        $this->assertRejected(fn () => $recon()->update(['reviewed_at' => now()]), 'حقول مراجعة على draft');
        $event = fn (array $over): array => $over + [
            'id' => (string) Str::uuid(), 'tenant_id' => $this->auth['tenant_id'], 'reconciliation_id' => $id, 'seq' => 1, 'action' => 'mark_reviewed', 'from_status' => 'draft', 'to_status' => 'reviewed',
            'run_id' => $run['id'], 'ledger_fingerprint' => str_repeat('a', 64), 'statement_digest' => str_repeat('b', 64), 'summary' => '{}', 'reason' => null,
            'created_by' => $this->owner->id, 'created_at' => now(),
        ];
        $insert = fn (array $over) => DB::table('partner_statement_reconciliation_events')->insert($event($over));
        $this->assertRejected(fn () => $insert(['run_id' => null]), 'mark_reviewed بلا تشغيلة');
        $this->assertRejected(fn () => $insert(['statement_digest' => null]), 'mark_reviewed بلا بصمة كشف');
        $this->assertRejected(fn () => $insert(['ledger_fingerprint' => null]), 'mark_reviewed بلا بصمة دفتر');
        $this->assertRejected(fn () => $insert(['seq' => 5]), 'ثقب في التسلسل');
        $this->assertRejected(fn () => $insert(['action' => 'reopen', 'from_status' => 'reviewed', 'to_status' => 'draft', 'reason' => 'سبب كاف']), 'from_status لا يطابق الحالة الحالية');
        $this->assertRejected(fn () => $insert(['action' => 'close', 'to_status' => 'closed']), 'إجراء مجهول');
        $this->assertRejected(fn () => $insert(['to_status' => 'closed']), 'حافة نحو closed');
        $this->assertSame(0, $this->eventCount());

        // الحدث المشروع يُقبل، لكن الحالة تتبعه بحقول مراجعة كاملة وإلا رُفضت.
        $insert([]);
        $this->assertRejected(fn () => $recon()->update(['status' => 'reviewed']), 'reviewed بلا حقول مراجعة');
        $this->assertRejected(fn () => $recon()->update(['status' => 'draft', 'reviewed_at' => now(), 'reviewed_by' => $this->owner->id, 'reviewed_run_id' => $run['id']]), 'حافة لا يغطيها الحدث');
        $recon()->update(['status' => 'reviewed', 'reviewed_at' => now(), 'reviewed_by' => $this->owner->id, 'reviewed_run_id' => $run['id']]);
        $this->assertSame('reviewed', $this->reconciliation($id)->status);

        // الهوية والسياسة وبصمة الاستيراد مجمَّدة.
        foreach ([['period_to' => '2026-10-31'], ['role' => 'supplier'], ['policy' => '{"version":1,"date_tolerance_days":9,"amount_tolerance_minor":0,"branch_id":null}'],
            ['file_sha256' => str_repeat('c', 64)], ['line_count' => 99], ['total_credit_minor' => 1], ['lines_digest' => str_repeat('d', 64)]] as $change) {
            $this->assertRejected(fn () => $recon()->update($change), 'تغيير '.array_key_first($change));
        }
        $this->assertTrue($recon()->update(['updated_at' => now()]) >= 0, 'التحديثات غير الجوهرية (الطابع الزمني) مسموحة.');
    }

    /** @test */
    public function the_event_log_is_append_only_and_the_migration_is_reversible_only_without_lifecycle_data(): void
    {
        [$a, $b, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        $this->resolveAll($id, $run, $b);
        $this->review($token, $id, $run['id'])->assertCreated();

        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->update(['reason' => 'تعديل']), 'تعديل الحدث');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->delete(), 'حذف الحدث');
        $model = PartnerStatementReconciliationEvent::query()->firstOrFail();
        foreach ([fn () => $model->update(['reason' => 'x']), fn () => $model->delete()] as $mutation) {
            try {
                $mutation();
                $this->fail('النموذج يجب أن يرفض');
            } catch (\LogicException) {
                $this->addToAssertionCount(1);
            }
        }

        $migration = require base_path('database/migrations/2026_12_31_010000_add_partner_statement_review_lifecycle.php');
        try {
            $migration->down();
            $this->fail('down() يجب أن يرفض');
        } catch (\RuntimeException) {
            $this->assertTrue(Schema::hasTable('partner_statement_reconciliation_events'));
        }
    }

    /** @test */
    public function the_lifecycle_migration_rolls_down_and_up_cleanly_while_every_reconciliation_is_a_draft(): void
    {
        $this->scenario();
        $migration = require base_path('database/migrations/2026_12_31_010000_add_partner_statement_review_lifecycle.php');
        $migration->down();
        $this->assertFalse(Schema::hasTable('partner_statement_reconciliation_events'));
        $this->assertFalse(Schema::hasColumn('partner_statement_reconciliations', 'lines_digest'));
        $this->assertFalse(Schema::hasColumn('partner_statement_match_runs', 'statement_digest'));
        $migration->up();
        $this->assertTrue(Schema::hasColumn('partner_statement_reconciliations', 'reviewed_run_id'));
        $this->assertTrue(Schema::hasTable('partner_statement_reconciliation_events'));
        // بعد إعادة الصعود يعمل كل شيء من جديد (تشغيلة جديدة ببصمتها).
        [$a, $b, $id, $run] = $this->scenario();
        $this->assertNotNull(DB::table('partner_statement_match_runs')->where('id', $run['id'])->value('statement_digest'));
    }

    // ═══════════════════════════════ RBAC وبوابة القدرة والعزل والفروع ═══════════════════════════════

    /** @test */
    public function transitions_need_reconcile_and_view_reads_need_view_and_partner_visibility_is_required(): void
    {
        [$a, $b, $id, $run] = $this->scenario();
        $this->resolveAll($id, $run, $b);

        $viewer = $this->role('ps-lv', ['partner_statements.view', 'partners.view'], 'lv@ps-a3c.test');
        $this->lcStatus($viewer, $id)->assertOk();
        $this->events($viewer, $id)->assertOk();
        $this->review($viewer, $id, $run['id'])->assertForbidden();
        $this->reopen($viewer, $id)->assertForbidden();
        $this->withToken($viewer)->postJson("/api/partner-statement-reconciliations/{$id}/close")->assertForbidden();

        $reconcileOnly = $this->role('ps-lr', ['partner_statements.reconcile', 'partners.view'], 'lr@ps-a3c.test');
        $this->review($reconcileOnly, $id, $run['id'])->assertForbidden();
        $this->lcStatus($reconcileOnly, $id)->assertForbidden();

        $noPartners = $this->role('ps-ln', ['partner_statements.view', 'partner_statements.reconcile'], 'ln@ps-a3c.test');
        $message = PartnerStatementImportService::PARTNER_UNAVAILABLE;
        $this->assertSame($message, $this->review($noPartners, $id, $run['id'])->assertStatus(422)->json('message'));
        $this->assertSame($message, $this->lcStatus($noPartners, $id)->assertStatus(422)->json('message'));
        $this->assertSame($message, $this->events($noPartners, $id)->assertStatus(422)->json('message'));

        $none = $this->role('ps-l0', ['reports.view'], 'l0@ps-a3c.test');
        $this->review($none, $id, $run['id'])->assertForbidden();
        $this->lcStatus($none, $id)->assertForbidden();
        $this->assertSame(0, $this->eventCount());

        $both = $this->role('ps-lb', ['partner_statements.view', 'partner_statements.reconcile', 'partners.view'], 'lb@ps-a3c.test');
        $this->review($both, $id, $run['id'])->assertCreated();
        $this->assertSame(1, $this->eventCount());
    }

    /** @test */
    public function the_application_gate_and_tenant_isolation_apply_to_every_lifecycle_route(): void
    {
        [$a, $b, $id, $run] = $this->scenario();
        $this->resolveAll($id, $run, $b);
        $token = $this->auth['token'];
        $this->review($token, $id, $run['id'])->assertCreated();

        // مستأجر آخر: الرفض الموحَّد لكل المسارات.
        $other = $this->registerTenant('ps-a3c-other', 'owner@other-a3c.test');
        $message = PartnerStatementImportService::PARTNER_UNAVAILABLE;
        $this->assertSame($message, $this->lcStatus($other['token'], $id)->assertStatus(422)->json('message'));
        $this->assertSame($message, $this->events($other['token'], $id)->assertStatus(422)->json('message'));
        $this->assertSame($message, $this->review($other['token'], $id, $run['id'])->assertStatus(422)->json('message'));
        $this->assertSame($message, $this->reopen($other['token'], $id)->assertStatus(422)->json('message'));
        $this->review($other['token'], 'not-a-uuid', $run['id'])->assertNotFound();

        // تشغيلة من مقارنة أخرى لنا ⇒ الرفض الموحَّد.
        $sibling = $this->statement([['date' => '2026-09-01', 'credit' => 1]]);
        $siblingRun = $this->match($token, $sibling);
        $this->assertSame($message, $this->review($token, $id, $siblingRun['id'])->assertStatus(422)->json('message'));

        // التعليق يسمح بالقراءة ويمنع الانتقالات؛ ومستأجر لم يفعّلها: 403 للكل.
        $this->assertSame('suspended', app(TenantApplicationService::class)->disable('accounting.partner_statements', null)->status);
        $this->lcStatus($token, $id)->assertOk();
        $this->events($token, $id)->assertOk();
        $this->reopen($token, $id)->assertForbidden();
        $this->review($token, $sibling, $siblingRun['id'])->assertForbidden();
        $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/close")->assertForbidden();
        $this->assertSame('reviewed', $this->reconciliation($id)->status);

        $off = $this->registerTenant('ps-a3c-off', 'owner@off-a3c.test', autoEnableApplications: false);
        $uuid = '00000000-0000-4000-8000-000000000000';
        foreach ([fn () => $this->lcStatus($off['token'], $uuid), fn () => $this->events($off['token'], $uuid), fn () => $this->review($off['token'], $uuid, $uuid), fn () => $this->reopen($off['token'], $uuid)] as $call) {
            $call()->assertForbidden();
        }
    }

    /** @test */
    public function a_branch_restricted_reviewer_can_only_review_on_their_own_run_and_never_sees_foreign_runs_in_the_log(): void
    {
        $inside = Branch::create(['code' => 'IN', 'name' => 'فرع داخل']);
        $this->invoice('2026-09-03', 100000, $inside->id);
        $token = $this->role('ps-lbr', ['partner_statements.view', 'partner_statements.reconcile', 'partners.view'], 'lbr@ps-a3c.test');
        User::query()->where('email', 'lbr@ps-a3c.test')->firstOrFail()->branches()->sync([$inside->id]);

        $id = $this->statement([['date' => '2026-09-03', 'credit' => 115000]]);
        $orgRun = $this->match($this->auth['token'], $id);
        $line = $this->lineId($id, 2);
        $this->decide($this->auth['token'], $id, ['run_id' => $orgRun['id'], 'line_id' => $line, 'action' => 'confirm'])->assertCreated();
        $this->review($this->auth['token'], $id, $orgRun['id'])->assertCreated();

        // المقيَّد: تشغيلة المؤسسة غير مقروءة له (رفض موحَّد)، والحدث المرتبط بها لا يظهر في سجله.
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->review($token, $id, $orgRun['id'])->assertStatus(422)->json('message'));
        $this->assertSame([], $this->events($token, $id)->assertOk()->json('data'));
        $this->assertStringNotContainsString($orgRun['id'], (string) $this->events($token, $id)->getContent());
        $this->assertCount(1, $this->events($this->auth['token'], $id)->json('data'));

        // إعادة الفتح تتطلب أن تكون التشغيلة التي رُوجعت عليها مقروءة للفاعل: المقيَّد لا يُعيد فتح مراجعة بنطاق المؤسسة.
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->reopen($token, $id)->assertStatus(422)->json('message'));
        $this->assertSame('reviewed', $this->reconciliation($id)->status);
        $this->reopen($this->auth['token'], $id)->assertOk();

        // ثم يعمل بتشغيلته هو: قرار المؤسسة لا يُحتسب له، فيعيد قراره ويراجع.
        $own = $this->match($token, $id);
        $this->assertSame('branch', $own['scope']['kind']);
        $state = $this->lcStatus($token, $id, ['run_id' => $own['id']])->assertOk()->json('data');
        $this->assertSame(['decisions_on_other_runs'], array_column($state['blockers'], 'code'));
        $this->decide($token, $id, ['run_id' => $own['id'], 'line_id' => $line, 'action' => 'confirm'])->assertCreated();
        $this->review($token, $id, $own['id'])->assertCreated();
        // سجله: حدثه هو فقط (الحدثان المرتبطان بتشغيلة المؤسسة لا يظهران له)، وللمالك الثلاثة.
        $this->assertSame([3], array_column($this->events($token, $id)->json('data'), 'seq'));
        $this->assertSame([3, 2, 1], array_column($this->events($this->auth['token'], $id)->json('data'), 'seq'));
    }

    // ═══════════════════════════════ الجدار والاستيراد ═══════════════════════════════

    /** @test */
    public function the_lifecycle_code_references_no_financial_writer_and_writes_only_its_own_tables(): void
    {
        $files = [
            'app/Services/PartnerStatementLifecycleService.php', 'app/Http/Controllers/Api/PartnerStatementLifecycleController.php',
            'app/Models/PartnerStatementReconciliationEvent.php', 'app/Services/PartnerStatementDigest.php',
        ];
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
                $this->assertSame('PartnerStatementReconciliationEvent', $target, "{$file} يكتب على {$target}");
            }
        }
        // الكاتب الوحيد لحقول حالة المقارنة هو خدمة الدورة (`->update(` على صف المقارنة المقفول).
        $source = (string) file_get_contents(base_path('app/Services/PartnerStatementLifecycleService.php'));
        $this->assertSame(2, substr_count($source, '$fresh->update('), 'تحديثان فقط: reviewed و draft.');
    }

    /** @test */
    public function importing_a_statement_records_the_lines_digest_once_and_a_replay_keeps_it(): void
    {
        $this->invoice('2026-09-01', 100000);
        $id = $this->statement([['date' => '2026-09-01', 'credit' => 115000], ['date' => '2026-09-02', 'credit' => 5000]]);
        $recon = $this->reconciliation($id);
        $this->assertSame(app(PartnerStatementDigest::class)->for($id), $recon->lines_digest);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', (string) $recon->lines_digest);
        $this->assertSame(2, PartnerStatementLine::query()->where('reconciliation_id', $id)->count());

        // استيراد الملف نفسه بالتفسير نفسه يعيد المقارنة القائمة بلا مساس بالبصمة.
        $again = $this->statement([['date' => '2026-09-01', 'credit' => 115000], ['date' => '2026-09-02', 'credit' => 5000]]);
        $this->assertSame($id, $again);
        $this->assertSame($recon->lines_digest, $this->reconciliation($id)->lines_digest);
    }
}
