<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementReviewDecision;
use App\Models\Role;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\PartnerStatementImportService;
use App\Services\TenantApplicationService;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * IMP-PARTNER-STATEMENTS PS-A3a — مراجعة نتائج المطابقة (confirm · override · clear) فوق الدفتر الحقيقي: الأسباب الإلزامية، السجل append-only بنسخ متسلسلة، منع النتائج القديمة،
 * منع الاستعمال المزدوج، الوحدات القابلة للمراجعة (D-PS-15)، RBAC، بوابة القدرة، العزل، الفروع، إعادة الطلب، ولا أثر مالي.
 * تشغيل: php artisan test --filter=PartnerStatementReviewApiTest
 */
class PartnerStatementReviewApiTest extends TestCase
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
        $this->auth = $this->registerTenant('ps-a3a', 'owner@ps-a3a.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->owner = User::query()->where('email', 'owner@ps-a3a.test')->firstOrFail();
        $this->both = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف المراجعة', 'is_active' => true]);
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

    /**
     * @param  list<array{date: string, ref?: string, our?: string, debit?: int, credit?: int}>  $rows
     * @param  array<string, mixed>  $over
     */
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

    private function lineId(string $reconciliationId, int $ordinal): string
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return (string) PartnerStatementLine::query()->where('reconciliation_id', $reconciliationId)->where('ordinal', $ordinal)->value('id');
    }

    /** @param array<string, mixed> $payload */
    private function decide(string $token, string $id, array $payload)
    {
        return $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/decisions", $payload);
    }

    private function listDecisions(string $token, string $id, array $query = [])
    {
        return $this->withToken($token)->getJson("/api/partner-statement-reconciliations/{$id}/decisions".($query === [] ? '' : '?'.http_build_query($query)));
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

    private function decisionCount(): int
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return PartnerStatementReviewDecision::query()->count();
    }

    /** مقارنة نموذجية: سطر ٢ مطابق R1 · سطر ٣ مفقود · سطر ٤ فرق مبلغ. @return array{0: Invoice, 1: Invoice, 2: Invoice, 3: string, 4: array<string, mixed>} */
    private function scenario(): array
    {
        $a = $this->invoice('2026-09-01', 100000);   // 1150.00
        $b = $this->invoice('2026-09-05', 20000);    // 230.00
        $d = $this->invoice('2026-09-12', 5000);     // 57.50
        $id = $this->statement([
            ['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000],   // ٢ ⇒ matched R1
            ['date' => '2026-09-25', 'credit' => 23000],                         // ٣ ⇒ missing_in_books (b على بعد ٢٠ يوماً)
            ['date' => '2026-09-12', 'our' => $d->number, 'credit' => 5000],     // ٤ ⇒ amount_difference (٥٧٥٠ مقابل ٥٠٠٠)
        ]);

        return [$a, $b, $d, $id, $this->match($this->auth['token'], $id)];
    }

    // ═══════════════════════════════ الدورة الكاملة ═══════════════════════════════

    /** @test */
    public function confirm_override_and_clear_are_recorded_append_only_with_linear_revisions_and_no_financial_effect(): void
    {
        [$a, $b, $d, $id, $run] = $this->scenario();
        $before = $this->counts();
        $token = $this->auth['token'];

        $confirm = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();
        $this->assertSame(['confirm', 1, ['invoice#'.$a->id], 'matched', 0, false], [
            $confirm->json('data.action'), $confirm->json('data.revision'), $confirm->json('data.unit_keys'), $confirm->json('data.engine_outcome'),
            $confirm->json('data.difference_minor'), $confirm->json('data.accepted_difference'),
        ]);
        $this->assertFalse($confirm->json('replayed'));

        $override = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 3), 'action' => 'override', 'unit_keys' => ['invoice#'.$b->id], 'reason' => 'تحويل بنكي مؤرخ لاحقاً'])->assertCreated();
        $this->assertSame(['override', 'missing_in_books', 23000, 23000, 0], [
            $override->json('data.action'), $override->json('data.engine_outcome'), $override->json('data.expected_net_minor'), $override->json('data.set_net_minor'), $override->json('data.difference_minor'),
        ]);

        // فرق المبلغ: يتطلب سبباً ثم إقراراً صريحاً لأنه خارج التسامح المجمَّد.
        $line4 = $this->lineId($id, 4);
        $this->assertSame('reason_required', $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line4, 'action' => 'confirm'])->assertStatus(422)->json('reason'));
        $over = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line4, 'action' => 'confirm', 'reason' => 'اتفاق على خصم تجاري'])->assertStatus(422);
        $this->assertSame(['difference_exceeds_tolerance', -750, 0], [$over->json('reason'), $over->json('details.difference_minor'), $over->json('details.tolerance_minor')]);
        $accepted = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line4, 'action' => 'confirm', 'reason' => 'اتفاق على خصم تجاري', 'accept_difference' => true])->assertCreated();
        $this->assertSame([-750, true, 'amount_difference'], [$accepted->json('data.difference_minor'), $accepted->json('data.accepted_difference'), $accepted->json('data.engine_outcome')]);

        $effective = $this->listDecisions($token, $id)->assertOk();
        $this->assertSame([2, 3, 4], array_column($effective->json('data'), 'ordinal'));

        // السحب: نسخة جديدة بلا وحدات، والقرار الفعّال يزول، والتاريخ كله باقٍ.
        $clear = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 3), 'action' => 'clear'])->assertCreated();
        $this->assertSame(['clear', 2, []], [$clear->json('data.action'), $clear->json('data.revision'), $clear->json('data.unit_keys')]);
        $this->assertSame([2, 4], array_column($this->listDecisions($token, $id)->assertOk()->json('data'), 'ordinal'));
        $history = $this->listDecisions($token, $id, ['line_id' => $this->lineId($id, 3), 'history' => 1])->assertOk()->json('data');
        $this->assertSame([['clear', 2], ['override', 1]], array_map(fn ($r) => [$r['action'], $r['revision']], $history));

        $this->assertSame(4, $this->decisionCount());
        $this->assertSame($before, $this->counts(), 'لا قيد ولا مستند ولا دفعة ولا رصيد ولا مخزون.');
    }

    /** @test */
    public function the_contract_requires_reasons_for_overrides_and_rejects_malformed_requests(): void
    {
        [$a, $b, $d, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        $line3 = $this->lineId($id, 3);
        $base = ['run_id' => $run['id'], 'line_id' => $line3];

        // التجاوز: سبب إلزامي (٣ محارف على الأقل بعد التشذيب) ووحدة واحدة على الأقل.
        $this->assertSame('reason_required', $this->decide($token, $id, $base + ['action' => 'override', 'unit_keys' => ['invoice#'.$b->id]])->assertStatus(422)->json('reason'));
        $this->assertSame('reason_required', $this->decide($token, $id, $base + ['action' => 'override', 'unit_keys' => ['invoice#'.$b->id], 'reason' => '  ab '])->assertStatus(422)->json('reason'));
        $this->assertSame('unit_keys_invalid', $this->decide($token, $id, $base + ['action' => 'override', 'reason' => 'سبب كاف'])->assertStatus(422)->json('reason'));
        $this->assertSame('unit_keys_invalid', $this->decide($token, $id, $base + ['action' => 'override', 'unit_keys' => [], 'reason' => 'سبب كاف'])->assertStatus(422)->json('reason'));

        // التأكيد لا يحمل وحدات ولا يصحّ حيث لا اقتراح.
        $this->assertSame('unit_keys_not_allowed', $this->decide($token, $id, $base + ['action' => 'confirm', 'unit_keys' => ['invoice#'.$b->id]])->assertStatus(422)->json('reason'));
        $this->assertSame('nothing_to_confirm', $this->decide($token, $id, $base + ['action' => 'confirm', 'reason' => 'سبب كاف'])->assertStatus(422)->json('reason'));
        $this->assertSame('unit_keys_not_allowed', $this->decide($token, $id, $base + ['action' => 'clear', 'unit_keys' => ['x']])->assertStatus(422)->json('reason'));

        // وحدة خارج الدفتر، ومعاملات غير مدعومة، وإجراء/معرّفات غير صالحة.
        $this->assertSame('unit_not_in_ledger', $this->decide($token, $id, $base + ['action' => 'override', 'unit_keys' => ['invoice#00000000-0000-4000-8000-000000000000'], 'reason' => 'سبب كاف'])->assertStatus(422)->json('reason'));
        $this->decide($token, $id, $base + ['action' => 'override', 'unit_keys' => ['x'], 'reason' => 'سبب كاف', 'tenant_id' => 'x'])->assertStatus(422);
        $this->decide($token, $id, $base + ['action' => 'invented'])->assertStatus(422);
        $this->decide($token, $id, ['run_id' => 'nope', 'line_id' => $line3, 'action' => 'clear'])->assertStatus(422);
        $this->assertSame('line_not_found', $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => '00000000-0000-4000-8000-000000000000', 'action' => 'clear'])->assertStatus(422)->json('reason'));
        $this->decide($token, $id, $base + ['action' => 'clear', 'reason' => str_repeat('ا', 501)])->assertStatus(422);

        $this->assertSame(0, $this->decisionCount(), 'لا يُسجَّل شيء عند أي رفض.');
    }

    /** @test */
    public function repeating_the_effective_decision_is_replayed_and_a_changed_one_adds_a_revision(): void
    {
        [$a, $b, $d, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        $line3 = $this->lineId($id, 3);
        $payload = ['run_id' => $run['id'], 'line_id' => $line3, 'action' => 'override', 'unit_keys' => ['invoice#'.$b->id], 'reason' => 'سبب أول'];

        $first = $this->decide($token, $id, $payload)->assertCreated();
        $replay = $this->decide($token, $id, $payload)->assertOk();
        $this->assertTrue($replay->json('replayed'));
        $this->assertSame($first->json('data.id'), $replay->json('data.id'));
        $this->assertSame(1, $this->decisionCount());

        // سبب مختلف ⇒ نسخة جديدة؛ ثم السحب ثم سحب ثانٍ بلا قرار ⇒ لا شيء جديد.
        $this->assertSame(2, $this->decide($token, $id, ['reason' => 'سبب ثانٍ'] + $payload)->assertCreated()->json('data.revision'));
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line3, 'action' => 'clear'])->assertCreated();
        $noop = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line3, 'action' => 'clear'])->assertOk();
        $this->assertTrue($noop->json('replayed'));
        $this->assertNull($noop->json('data'));
        $this->assertSame(3, $this->decisionCount());
    }

    // ═══════════════════════════════ الاستعمال المزدوج ═══════════════════════════════

    /** @test */
    public function a_ledger_unit_with_an_effective_decision_cannot_be_given_to_another_line_until_cleared(): void
    {
        $x = $this->invoice('2026-09-02', 5000);   // وحدة واحدة ٥٧٫٥٠
        $id = $this->statement([
            ['date' => '2026-09-02', 'credit' => 5750],    // ٢ ⇒ matched R3 على x
            ['date' => '2026-09-20', 'credit' => 5750],    // ٣ ⇒ مفقود (بعيد زمنياً)
        ]);
        $run = $this->match($this->auth['token'], $id);
        $token = $this->auth['token'];
        $unit = 'invoice#'.$x->id;

        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();

        $clash = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 3), 'action' => 'override', 'unit_keys' => [$unit], 'reason' => 'دفعة ثانية'])->assertStatus(409);
        $this->assertSame(['unit_already_decided', $unit, $this->lineId($id, 2)], [$clash->json('reason'), $clash->json('details.unit_key'), $clash->json('details.line_id')]);
        $this->assertSame(1, $this->decisionCount());

        // بعد سحب القرار الأول تتحرر الوحدة، وتحذير المحرّك يذكر السطر الذي اقترحها له.
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear'])->assertCreated();
        $freed = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 3), 'action' => 'override', 'unit_keys' => [$unit], 'reason' => 'دفعة ثانية'])->assertCreated();
        $this->assertSame([['code' => 'unit_proposed_for_another_line', 'params' => ['unit_key' => $unit, 'ordinal' => 2]]], $freed->json('warnings'));

        // والعكس: السطر الأول لم يعد يستطيع تأكيد وحدته المقترحة لأن الثاني يحملها.
        $this->assertSame('unit_already_decided', $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertStatus(409)->json('reason'));
    }

    // ═══════════════════════════════ نتائج قديمة ═══════════════════════════════

    /** @test */
    public function a_run_that_no_longer_matches_the_ledger_policy_scope_or_engine_cannot_be_reviewed(): void
    {
        [$a, $b, $d, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        $confirm = ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'];

        // تغيّر الدفتر بعد التشغيل ⇒ رفض كامل ولا قرار؛ إعادة المطابقة تعطي تشغيلة جديدة قابلة للمراجعة.
        $this->invoice('2026-09-20', 1000);
        $stale = $this->decide($token, $id, $confirm)->assertStatus(409);
        $this->assertSame(['run_stale', ['ledger_fingerprint']], [$stale->json('reason'), $stale->json('details.causes')]);
        $this->assertSame(0, $this->decisionCount());
        $fresh = $this->match($token, $id);
        $this->assertNotSame($run['id'], $fresh['id']);
        $this->decide($token, $id, ['run_id' => $fresh['id']] + $confirm)->assertCreated();

        // قرار على التشغيلة القديمة يبقى مرفوضاً حتى بعد وجود الجديدة.
        $this->assertSame('run_stale', $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 4), 'action' => 'clear'])->assertStatus(409)->json('reason'));

        // إصدار محرّك أو سياسة أو نطاق مختلف عن الحاضر (يُحاكى بتعديل صف التشغيلة خارج النموذج) ⇒ كل منها سبب مستقل.
        foreach ([['engine_version', '0', 'engine_version'], ['policy', json_encode(['version' => 1, 'date_tolerance_days' => 9, 'amount_tolerance_minor' => 0, 'branch_id' => null]), 'policy'],
            ['scope', json_encode(['kind' => 'branch', 'branch_ids' => ['x']]), 'scope']] as [$column, $value, $cause]) {
            $original = DB::table('partner_statement_match_runs')->where('id', $fresh['id'])->value($column);
            DB::table('partner_statement_match_runs')->where('id', $fresh['id'])->update([$column => $value]);
            $response = $this->decide($token, $id, ['run_id' => $fresh['id'], 'line_id' => $this->lineId($id, 4), 'action' => 'clear'])->assertStatus(409);
            $this->assertSame(['run_stale', true], [$response->json('reason'), in_array($cause, $response->json('details.causes'), true)], $cause);
            DB::table('partner_statement_match_runs')->where('id', $fresh['id'])->update([$column => $original]);
        }
    }

    /** @test */
    public function only_the_draft_state_accepts_review_and_reads_stay_available(): void
    {
        [$a, $b, $d, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();

        DB::table('partner_statement_reconciliations')->where('id', $id)->update(['status' => 'reviewed']);
        $this->assertSame('reconciliation_not_editable', $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear'])->assertStatus(409)->json('reason'));
        $this->assertSame(1, $this->decisionCount());
        $this->listDecisions($token, $id)->assertOk();
    }

    // ═══════════════════════════════ D-PS-15: الوحدات القابلة للمراجعة ═══════════════════════════════

    /** @test */
    public function reversed_and_incomplete_units_are_never_assignable_here_and_nothing_is_guessed(): void
    {
        $reversed = $this->invoice('2026-09-03', 100000);
        $ledger = app(LedgerService::class);
        $ledger->reverse($this->entryOf($reversed), '2026-09-06', 'إلغاء');
        $cut = $this->invoice('2026-09-04', 20000);
        $ledger->reverse($this->entryOf($cut), '2026-12-20', 'إلغاء متأخر');   // خارج نافذة الفترة ⇒ سلسلة ناقصة
        $id = $this->statement([
            ['date' => '2026-09-03', 'our' => $reversed->number, 'credit' => 115000],   // ٢ ⇒ amount_difference / reversed_in_books
            ['date' => '2026-09-04', 'our' => $cut->number, 'credit' => 23000],          // ٣ ⇒ ambiguous / candidate_reversal_incomplete
        ]);
        $run = $this->match($this->auth['token'], $id);
        $token = $this->auth['token'];

        // تأكيد «فرق» على وحدة معكوسة مرفوض (ليست active) مهما أُقرّ الفرق.
        $confirm = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm', 'reason' => 'سبب كاف', 'accept_difference' => true])->assertStatus(422);
        $this->assertSame(['unit_not_reviewable', 'neutralised'], [$confirm->json('reason'), $confirm->json('details.state')]);

        // التجاوز اليدوي إلى زوج معكوس أو سلسلة ناقصة مرفوض كذلك (الربط اليدوي المثبت شريحة مستقلة).
        foreach ([[2, $reversed, 'neutralised'], [3, $cut, 'incomplete']] as [$ordinal, $invoice, $state]) {
            $r = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, $ordinal), 'action' => 'override', 'unit_keys' => ['invoice#'.$invoice->id], 'reason' => 'سبب كاف', 'accept_difference' => true])->assertStatus(422);
            $this->assertSame(['unit_not_reviewable', $state], [$r->json('reason'), $r->json('details.state')]);
        }
        $this->assertSame(0, $this->decisionCount());
    }

    // ═══════════════════════════════ RBAC وبوابة القدرة والعزل والفروع ═══════════════════════════════

    /** @test */
    public function permissions_are_independent_and_review_requires_reconcile_view_and_partner_visibility(): void
    {
        [$a, $b, $d, $id, $run] = $this->scenario();
        $payload = ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'];

        $viewer = $this->role('ps-rv', ['partner_statements.view', 'partners.view'], 'rv@ps-a3a.test');
        $this->listDecisions($viewer, $id)->assertOk();
        $this->decide($viewer, $id, $payload)->assertForbidden();

        $reconcileOnly = $this->role('ps-rr', ['partner_statements.reconcile', 'partners.view'], 'rr@ps-a3a.test');
        $this->decide($reconcileOnly, $id, $payload)->assertForbidden();
        $this->listDecisions($reconcileOnly, $id)->assertForbidden();

        $noPartners = $this->role('ps-rn', ['partner_statements.view', 'partner_statements.reconcile'], 'rn@ps-a3a.test');
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->decide($noPartners, $id, $payload)->assertStatus(422)->json('message'));
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->listDecisions($noPartners, $id)->assertStatus(422)->json('message'));

        $none = $this->role('ps-r0', ['reports.view'], 'r0@ps-a3a.test');
        $this->decide($none, $id, $payload)->assertForbidden();
        $this->listDecisions($none, $id)->assertForbidden();
        $this->assertSame(0, $this->decisionCount());

        $both = $this->role('ps-rb', ['partner_statements.view', 'partner_statements.reconcile', 'partners.view'], 'rb@ps-a3a.test');
        $this->decide($both, $id, $payload)->assertCreated();
    }

    /** @test */
    public function the_application_gate_blocks_review_when_disabled_and_writes_when_suspended(): void
    {
        [$a, $b, $d, $id, $run] = $this->scenario();
        $token = $this->auth['token'];
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();

        $this->assertSame('suspended', app(TenantApplicationService::class)->disable('accounting.partner_statements', null)->status);
        $this->listDecisions($token, $id)->assertOk();
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear'])->assertForbidden();
        $this->assertSame(1, $this->decisionCount());

        $other = $this->registerTenant('ps-a3a-off', 'owner@off-a3a.test', autoEnableApplications: false);
        $uuid = '00000000-0000-4000-8000-000000000000';
        $this->decide($other['token'], $uuid, ['run_id' => $uuid, 'line_id' => $uuid, 'action' => 'clear'])->assertForbidden();
        $this->listDecisions($other['token'], $uuid)->assertForbidden();
    }

    /** @test */
    public function another_tenants_reconciliation_run_or_line_gets_the_same_refusal_and_nothing_is_written(): void
    {
        [$a, $b, $d, $id, $run] = $this->scenario();
        $other = $this->registerTenant('ps-a3a-other', 'owner@other-a3a.test');
        $message = PartnerStatementImportService::PARTNER_UNAVAILABLE;

        // مستأجر آخر يشير إلى مقارنتنا/تشغيلتنا/سطرنا.
        $this->assertSame($message, $this->decide($other['token'], $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertStatus(422)->json('message'));
        $this->assertSame($message, $this->listDecisions($other['token'], $id)->assertStatus(422)->json('message'));

        // مقارنتنا مع تشغيلة غير موجودة أو من مقارنة أخرى لنا.
        $this->assertSame($message, $this->decide($this->auth['token'], $id, ['run_id' => '00000000-0000-4000-8000-000000000000', 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertStatus(422)->json('message'));
        $sibling = $this->statement([['date' => '2026-09-01', 'credit' => 1]]);
        $siblingRun = $this->match($this->auth['token'], $sibling);
        $this->assertSame($message, $this->decide($this->auth['token'], $id, ['run_id' => $siblingRun['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertStatus(422)->json('message'));
        // سطر من مقارنة أخرى.
        $this->assertSame('line_not_found', $this->decide($this->auth['token'], $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($sibling, 2), 'action' => 'clear'])->assertStatus(422)->json('reason'));
        $this->decide($this->auth['token'], 'not-a-uuid', ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear'])->assertNotFound();
        $this->assertSame(0, $this->decisionCount());
    }

    /** @test */
    public function a_branch_restricted_reviewer_neither_uses_nor_sees_runs_and_units_beyond_their_branches(): void
    {
        $inside = Branch::create(['code' => 'IN', 'name' => 'فرع داخل']);
        $outside = Branch::create(['code' => 'OUT', 'name' => 'فرع خارج']);
        $mine = $this->invoice('2026-09-01', 100000, $inside->id);
        $foreign = $this->invoice('2026-09-02', 70000, $outside->id);
        $token = $this->role('ps-rs', ['partner_statements.view', 'partner_statements.reconcile', 'partners.view'], 'rs@ps-a3a.test');
        User::query()->where('email', 'rs@ps-a3a.test')->firstOrFail()->branches()->sync([$inside->id]);

        $id = $this->statement([['date' => '2026-09-01', 'credit' => 115000], ['date' => '2026-09-02', 'credit' => 80500]]);
        $orgRun = $this->match($this->auth['token'], $id);
        $line2 = $this->lineId($id, 2);
        $line3 = $this->lineId($id, 3);

        // تشغيلة المؤسسة لا يراجع عليها المقيَّد (الرفض الموحَّد)، وقرارات غير المقيَّد عليها لا تُعرض له.
        $this->decide($this->auth['token'], $id, ['run_id' => $orgRun['id'], 'line_id' => $line2, 'action' => 'override', 'unit_keys' => ['invoice#'.$foreign->id], 'reason' => 'سبب كاف', 'accept_difference' => true])->assertCreated();
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->decide($token, $id, ['run_id' => $orgRun['id'], 'line_id' => $line2, 'action' => 'clear'])->assertStatus(422)->json('message'));
        $this->assertSame([], $this->listDecisions($token, $id)->assertOk()->json('data'));
        $this->assertSame([], $this->listDecisions($token, $id, ['line_id' => $line2, 'history' => 1])->assertOk()->json('data'));
        $this->assertStringNotContainsString($foreign->id, (string) $this->listDecisions($token, $id)->getContent());

        // يشغّل بنطاقه فيراجع وحداته هو؛ ووحدة الفرع الآخر ليست في دفتره.
        $own = $this->match($token, $id);
        $this->assertSame('branch', $own['scope']['kind']);
        $this->assertSame('unit_not_in_ledger', $this->decide($token, $id, ['run_id' => $own['id'], 'line_id' => $line3, 'action' => 'override', 'unit_keys' => ['invoice#'.$foreign->id], 'reason' => 'سبب كاف', 'accept_difference' => true])->assertStatus(422)->json('reason'));
        $ok = $this->decide($token, $id, ['run_id' => $own['id'], 'line_id' => $line3, 'action' => 'override', 'unit_keys' => ['invoice#'.$mine->id], 'reason' => 'سبب كاف', 'accept_difference' => true])->assertCreated();
        $this->assertSame(['invoice#'.$mine->id], $ok->json('data.unit_keys'));
        $this->assertSame([3], array_column($this->listDecisions($token, $id)->assertOk()->json('data'), 'ordinal'));
    }

    /**
     * Codex #1915 P2: تشغيلتان بنطاقين مختلفين (مؤسسة / فرع) قد تشتركان في بصمة الدفتر إن كانت كل الوحدات في فرع واحد. إعادة الطلب مرتبطة بالتشغيلة المطلوبة:
     * لا يُعاد لمراجع مقيَّد قرارٌ بُني على تشغيلة المؤسسة (معرّفها وبياناتها)، بل تُسجَّل نسخة له على تشغيلته هو، فيظهر في قائمته.
     *
     * @test
     */
    public function a_replay_is_bound_to_the_requested_run_so_a_restricted_reviewer_never_receives_an_unreadable_decision(): void
    {
        $inside = Branch::create(['code' => 'IN', 'name' => 'فرع داخل']);
        $this->invoice('2026-09-01', 100000, $inside->id);   // كل وحدات الدفتر في فرع واحد ⇒ البصمة نفسها للتشغيلتين
        $token = $this->role('ps-rb2', ['partner_statements.view', 'partner_statements.reconcile', 'partners.view'], 'rb2@ps-a3a.test');
        User::query()->where('email', 'rb2@ps-a3a.test')->firstOrFail()->branches()->sync([$inside->id]);

        $id = $this->statement([['date' => '2026-09-01', 'credit' => 115000]]);
        $line = $this->lineId($id, 2);
        $orgRun = $this->match($this->auth['token'], $id);
        $own = $this->match($token, $id);
        $this->assertNotSame($orgRun['id'], $own['id']);
        $this->assertSame($orgRun['ledger_fingerprint'], $own['ledger_fingerprint'], 'نفس البصمة بنطاقين مختلفين — شرط الحالة.');

        $first = $this->decide($this->auth['token'], $id, ['run_id' => $orgRun['id'], 'line_id' => $line, 'action' => 'confirm'])->assertCreated();

        $second = $this->decide($token, $id, ['run_id' => $own['id'], 'line_id' => $line, 'action' => 'confirm'])->assertCreated();
        $this->assertFalse($second->json('replayed'));
        $this->assertSame([$own['id'], 2], [$second->json('data.run_id'), $second->json('data.revision')]);
        $this->assertNotSame($first->json('data.id'), $second->json('data.id'));

        // المقيَّد يرى قراره هو فقط؛ ولا يظهر له معرّف تشغيلة المؤسسة في أي استجابة.
        $list = $this->listDecisions($token, $id)->assertOk();
        $this->assertSame([$second->json('data.id')], array_column($list->json('data'), 'id'));
        $this->assertStringNotContainsString($orgRun['id'], (string) $list->getContent());
        $this->assertStringNotContainsString($orgRun['id'], (string) $second->getContent());

        // وإعادة طلبه هو على تشغيلته تُعاد replayed.
        $this->assertTrue($this->decide($token, $id, ['run_id' => $own['id'], 'line_id' => $line, 'action' => 'confirm'])->assertOk()->json('replayed'));
    }

    // ═══════════════════════════════ سجل لا يتغيّر ═══════════════════════════════

    /** @test */
    public function the_decision_log_is_immutable_and_the_database_enforces_revision_order_and_shape(): void
    {
        [$a, $b, $d, $id, $run] = $this->scenario();
        $this->decide($this->auth['token'], $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();
        $row = (array) DB::table('partner_statement_review_decisions')->first();

        $rejects = function (callable $fn, string $why): void {
            try {
                DB::transaction($fn);
                $this->fail($why);
            } catch (QueryException) {
                $this->addToAssertionCount(1);
            }
        };

        $rejects(fn () => DB::table('partner_statement_review_decisions')->update(['reason' => 'تعديل']), 'التعديل مرفوض');
        $rejects(fn () => DB::table('partner_statement_review_decisions')->delete(), 'الحذف مرفوض');
        // نسخة بثقب أو مكرّرة، وإجراء غير معروف، وتجاوز بلا سبب، وclear بوحدات، وconfirm بلا وحدات.
        $make = fn (array $over): array => $over + ['id' => (string) \Illuminate\Support\Str::uuid()] + $row;
        $rejects(fn () => DB::table('partner_statement_review_decisions')->insert($make(['revision' => 5])), 'ثقب في النسخ');
        $rejects(fn () => DB::table('partner_statement_review_decisions')->insert($make(['revision' => 1])), 'نسخة مكررة');
        $rejects(fn () => DB::table('partner_statement_review_decisions')->insert($make(['revision' => 2, 'action' => 'invented'])), 'إجراء غير معروف');
        $rejects(fn () => DB::table('partner_statement_review_decisions')->insert($make(['revision' => 2, 'action' => 'override', 'reason' => null])), 'تجاوز بلا سبب');
        $rejects(fn () => DB::table('partner_statement_review_decisions')->insert($make(['revision' => 2, 'action' => 'clear'])), 'clear بوحدات');
        $rejects(fn () => DB::table('partner_statement_review_decisions')->insert($make(['revision' => 2, 'unit_keys' => '[]'])), 'confirm بلا وحدات');
        $this->assertSame(1, $this->decisionCount());

        // نسخة صحيحة تالية تُقبل (الحارس لا يمنع الاستعمال المشروع).
        DB::table('partner_statement_review_decisions')->insert($make(['revision' => 2, 'action' => 'clear', 'unit_keys' => '[]', 'reason' => null]));
        $this->assertSame(2, $this->decisionCount());

        // النموذج نفسه يرفض التعديل والحذف.
        $model = PartnerStatementReviewDecision::query()->firstOrFail();
        foreach ([fn () => $model->update(['reason' => 'x']), fn () => $model->delete()] as $mutation) {
            try {
                $mutation();
                $this->fail('النموذج يجب أن يرفض');
            } catch (\LogicException) {
                $this->addToAssertionCount(1);
            }
        }

        // التراجع يرفض والسجل فيه صفوف.
        $migration = require base_path('database/migrations/2026_12_28_010000_create_partner_statement_review_decisions.php');
        try {
            $migration->down();
            $this->fail('down() يجب أن يرفض');
        } catch (\RuntimeException) {
            $this->assertTrue(\Illuminate\Support\Facades\Schema::hasTable('partner_statement_review_decisions'));
        }
    }

    /** @test */
    public function the_review_code_references_no_financial_writer_and_writes_only_its_own_table(): void
    {
        $files = [
            'app/Services/PartnerStatementReviewService.php', 'app/Http/Controllers/Api/PartnerStatementReviewController.php',
            'app/Models/PartnerStatementReviewDecision.php', 'app/Support/PartnerStatementReviewException.php',
        ];
        $forbidden = ['LedgerService', 'JournalEntry', 'JournalLine', 'journal_entries', 'journal_lines', 'InventoryService', 'StockMovement', 'Zatca', 'InvoiceService', 'PaymentService',
            'PurchaseService', 'ExpenseService', 'CreditNoteService', 'ReturnService', 'PartnerService', 'AccountBalance', 'DB::table', '->save(', '->delete(', '->forceDelete(', '->update('];
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
                $this->assertSame('PartnerStatementReviewDecision', $target, "{$file} يكتب على {$target}");
            }
        }
    }
}
