<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PartnerStatementMatch;
use App\Models\PartnerStatementMatchRun;
use App\Models\Role;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PaymentService;
use App\Services\PartnerStatementImportService;
use App\Services\TenantApplicationService;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * IMP-PARTNER-STATEMENTS PS-A2c — مطابقة الكشوف عبر API فوق الدفتر الحقيقي: R1–R3 والنتائج، التكرار، الغموض، الانعكاس، التسامح المجمَّد، RBAC، بوابة القدرة، العزل، الفروع،
 * التحقق many-to-one، ولا أثر مالي. تشغيل: php artisan test --filter=PartnerStatementMatchApiTest
 */
class PartnerStatementMatchApiTest extends TestCase
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
        $this->auth = $this->registerTenant('ps-a2c', 'owner@ps-a2c.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->owner = User::query()->where('email', 'owner@ps-a2c.test')->firstOrFail();
        $this->both = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف المطابقة', 'is_active' => true]);
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
     * @param  list<array{date: string, ref?: string, our?: string, debit?: int, credit?: int, kind?: string}>  $rows
     * @param  array<string, mixed>  $over  خيارات الاستيراد (date_tolerance_days / amount_tolerance_minor / branch_id / role…)
     */
    private function statement(array $rows, array $over = [], ?string $tenantId = null, ?User $user = null, ?Partner $partner = null): string
    {
        $money = fn (?int $minor): string => $minor === null ? '' : number_format($minor / 100, 2, '.', '');
        $csv = SpreadsheetWriter::csv(['التاريخ', 'رقم المستند', 'مرجعنا', 'مدين', 'دائن', 'نوع الحركة'], array_map(fn (array $r): array => [
            $r['date'], $r['ref'] ?? '', $r['our'] ?? '', $money($r['debit'] ?? null), $money($r['credit'] ?? null), $r['kind'] ?? '',
        ], $rows));
        $file = UploadedFile::fake()->createWithContent('s'.uniqid().'.csv', $csv);
        app(TenantContext::class)->set($tenantId ?? $this->auth['tenant_id']);
        $this->actingAs($user ?? $this->owner);

        return app(PartnerStatementImportService::class)->apply($file, $over + [
            'partner_id' => ($partner ?? $this->both)->id, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30',
        ], (string) ($user ?? $this->owner)->id)['reconciliation_id'];
    }

    private function postMatch(string $token, string $id)
    {
        return $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/match");
    }

    private function getMatches(string $token, string $id, array $query = [])
    {
        return $this->withToken($token)->getJson("/api/partner-statement-reconciliations/{$id}/matches".($query === [] ? '' : '?'.http_build_query($query)));
    }

    /** @return array<int, array<string, mixed>> نتائج جهة الكشف بمفتاح رقم الصف */
    private function statementRows(string $token, string $id, array $query = []): array
    {
        $rows = [];
        foreach ($this->getMatches($token, $id, $query + ['side' => 'statement', 'per_page' => 50])->assertOk()->json('data') as $row) {
            $rows[$row['ordinal']] = $row;
        }

        return $rows;
    }

    /** @return array<string, array<string, mixed>> نتائج جهة الدفتر بمفتاح الوحدة */
    private function ledgerRows(string $token, string $id): array
    {
        $rows = [];
        foreach ($this->getMatches($token, $id, ['side' => 'ledger', 'per_page' => 50])->assertOk()->json('data') as $row) {
            $rows[$row['unit_key']] = $row;
        }

        return $rows;
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

    // ═══════════════════════════════ القواعد والنتائج فوق الدفتر الحقيقي ═══════════════════════════════

    /** @test */
    public function rules_and_outcomes_run_against_the_real_ledger_and_the_ledger_side_is_reported(): void
    {
        $a = $this->invoice('2026-09-01', 100000);   // 1150.00
        $b = $this->invoice('2026-09-05', 20000);    // 230.00
        $c = $this->invoice('2026-09-10', 10000);    // 115.00
        $d = $this->invoice('2026-09-12', 50000);    // 575.00
        $e = $this->invoice('2026-09-15', 5000);     // 57.50
        $f = $this->invoice('2026-09-20', 3000);     // 34.50 — غير مذكورة في الكشف
        $payments = app(PaymentService::class);
        $payment = $payments->post($payments->create(
            ['partner_id' => $this->both->id, 'direction' => 'received', 'amount' => 40000, 'payment_date' => '2026-09-08', 'invoice_id' => $a->id],
            [['invoice_id' => $a->id, 'amount' => 40000]],
        ));

        $id = $this->statement([
            ['date' => '2026-09-01', 'our' => $a->number, 'credit' => 115000],       // صف ٢ ⇒ R1
            ['date' => '2026-09-05', 'ref' => $b->number, 'credit' => 23000],        // صف ٣ ⇒ R2
            ['date' => '2026-09-10', 'credit' => 11500],                             // صف ٤ ⇒ R3
            ['date' => '2026-09-12', 'our' => $d->number, 'credit' => 50000],        // صف ٥ ⇒ فرق مبلغ (دفترنا ٥٧٥٠٠)
            ['date' => '2026-09-25', 'our' => $e->number, 'credit' => 5750],         // صف ٦ ⇒ فرق تاريخ (١٠ أيام)
            ['date' => '2026-09-28', 'credit' => 99999],                             // صف ٧ ⇒ مفقود من الدفاتر
            ['date' => '2026-09-08', 'debit' => 40000],                              // صف ٨ ⇒ R3 مع سند القبض
        ]);

        $before = $this->counts();
        $run = $this->postMatch($this->auth['token'], $id)->assertCreated()->json('data');
        $this->assertSame($before, $this->counts(), 'لا قيد ولا مستند ولا دفعة ولا رصيد.');

        $this->assertSame(['1', 'organization', false], [$run['engine_version'], $run['scope']['kind'], $run['replayed']]);
        $this->assertSame([
            'ledger.matched' => 4, 'ledger.missing_in_statement' => 1, 'ledger.needs_review' => 2,
            'statement.amount_difference' => 1, 'statement.date_difference' => 1, 'statement.matched' => 4, 'statement.missing_in_books' => 1,
        ], $run['counts']);

        $rows = $this->statementRows($this->auth['token'], $id);
        $this->assertSame(['matched', 'R1', 'matched_by_our_reference'], [$rows[2]['outcome'], $rows[2]['rule'], $rows[2]['explanation']['code']]);
        $this->assertSame(['matched', 'R2'], [$rows[3]['outcome'], $rows[3]['rule']]);
        $this->assertSame(['matched', 'R3', 'matched_by_amount_date_unique'], [$rows[4]['outcome'], $rows[4]['rule'], $rows[4]['explanation']['code']]);
        $this->assertSame(['amount_difference', 'R1', -7500], [$rows[5]['outcome'], $rows[5]['rule'], $rows[5]['difference_minor']]);
        $this->assertSame(['date_difference', 10, 0], [$rows[6]['outcome'], $rows[6]['day_difference'], $rows[6]['difference_minor']]);
        $this->assertSame(['missing_in_books', null], [$rows[7]['outcome'], $rows[7]['rule']]);
        $this->assertSame(['matched', 'R3', 'payment'], [$rows[8]['outcome'], $rows[8]['rule'], $rows[8]['unit']['kind']]);
        $this->assertSame($payment->number, $rows[8]['unit']['doc_number']);
        $this->assertSame($a->number, $rows[2]['unit']['doc_number']);

        $ledger = $this->ledgerRows($this->auth['token'], $id);
        $this->assertSame('missing_in_statement', $ledger['invoice#'.$f->id]['outcome']);
        $this->assertSame('needs_review', $ledger['invoice#'.$d->id]['outcome']);
        $this->assertSame('matched', $ledger['invoice#'.$a->id]['outcome']);
    }

    /** @test */
    public function re_running_is_idempotent_and_a_ledger_change_creates_a_new_run_keeping_the_old_one(): void
    {
        $this->invoice('2026-09-01', 100000);
        $id = $this->statement([['date' => '2026-09-01', 'credit' => 115000]]);

        $first = $this->postMatch($this->auth['token'], $id)->assertCreated()->json('data');
        $again = $this->postMatch($this->auth['token'], $id)->assertOk()->json('data');
        $this->assertSame([$first['id'], true], [$again['id'], $again['replayed']]);
        $this->assertSame(1, PartnerStatementMatchRun::query()->count());
        $this->assertSame(2, PartnerStatementMatch::query()->count());   // سطر كشف + وحدة دفترية

        $this->invoice('2026-09-20', 7000);   // يتغير الدفتر
        $second = $this->postMatch($this->auth['token'], $id)->assertCreated()->json('data');
        $this->assertNotSame($first['id'], $second['id']);
        $this->assertSame(2, PartnerStatementMatchRun::query()->count(), 'القديمة تبقى.');

        $latest = $this->getMatches($this->auth['token'], $id)->assertOk();
        $this->assertSame([$second['id'], false], [$latest->json('run.id'), $latest->json('ledger_changed')]);
        $old = $this->getMatches($this->auth['token'], $id, ['run_id' => $first['id']])->assertOk();
        $this->assertSame([$first['id'], true], [$old->json('run.id'), $old->json('ledger_changed')], 'قراءة تشغيلة قديمة تنبّه أن الدفتر تغيّر.');
    }

    /** @test */
    public function reversed_documents_are_never_auto_matched_and_incomplete_chains_need_a_human(): void
    {
        $reversed = $this->invoice('2026-09-03', 100000);
        $ledger = app(LedgerService::class);
        $ledger->reverse($this->entryOf($reversed), '2026-09-06', 'إلغاء');
        $cut = $this->invoice('2026-09-04', 20000);
        $ledger->reverse($this->entryOf($cut), '2026-12-20', 'إلغاء متأخر');   // خارج نافذة الفترة

        $id = $this->statement([
            ['date' => '2026-09-03', 'our' => $reversed->number, 'credit' => 115000],
            ['date' => '2026-09-04', 'our' => $cut->number, 'credit' => 23000],
        ]);
        $this->postMatch($this->auth['token'], $id)->assertCreated();
        $rows = $this->statementRows($this->auth['token'], $id);

        $this->assertSame(['amount_difference', 'reversed_in_books', 115000], [$rows[2]['outcome'], $rows[2]['explanation']['code'], $rows[2]['difference_minor']]);
        $this->assertSame(['ambiguous', 'candidate_reversal_incomplete', ['reversal_outside_window']], [$rows[3]['outcome'], $rows[3]['explanation']['code'], $rows[3]['explanation']['params']['reasons']]);
        $ledgerRows = $this->ledgerRows($this->auth['token'], $id);
        $this->assertSame('neutralised', $ledgerRows['invoice#'.$reversed->id]['outcome']);
        $this->assertSame('incomplete', $ledgerRows['invoice#'.$cut->id]['outcome']);
        $this->assertNotContains('matched', array_column(array_merge($rows, $ledgerRows), 'outcome'));
    }

    /** @test */
    public function ambiguity_and_double_use_are_explicit_and_nothing_is_assigned(): void
    {
        $this->invoice('2026-09-02', 5000);    // وحدة واحدة ٥٧٫٥٠
        $h1 = $this->invoice('2026-09-10', 10000);
        $h2 = $this->invoice('2026-09-10', 10000);   // وثيقتان متماثلتان

        $id = $this->statement([
            ['date' => '2026-09-02', 'credit' => 5750],    // صف ٢
            ['date' => '2026-09-03', 'credit' => 5750],    // صف ٣: نفس الوحدة ⇒ استعمال مزدوج
            ['date' => '2026-09-10', 'credit' => 11500],   // صف ٤: وحدتان ⇒ غموض
        ]);
        $this->postMatch($this->auth['token'], $id)->assertCreated();
        $rows = $this->statementRows($this->auth['token'], $id);

        $this->assertSame(['ambiguous', 'unit_claimed_by_several_lines', 'R3'], [$rows[2]['outcome'], $rows[2]['explanation']['code'], $rows[2]['rule']]);
        $this->assertSame('ambiguous', $rows[3]['outcome']);
        $this->assertSame(['ambiguous', 'ambiguous_multiple_candidates'], [$rows[4]['outcome'], $rows[4]['explanation']['code']]);
        $this->assertEqualsCanonicalizing([$h1->number, $h2->number], array_column($rows[4]['candidates'], 'doc_number'));
        $this->assertNotContains('matched', array_column($rows, 'outcome'));
        $this->assertSame(['needs_review', 'needs_review', 'needs_review'], array_column($this->ledgerRows($this->auth['token'], $id), 'outcome'));
    }

    /** @test */
    public function tolerances_come_from_the_policy_frozen_with_the_reconciliation(): void
    {
        $this->invoice('2026-09-10', 10000);
        $line = [['date' => '2026-09-13', 'credit' => 11500]];   // ٣ أيام بعد وبمبلغ مطابق

        $wide = $this->statement($line, ['date_tolerance_days' => 3]);
        $tight = $this->statement($line, ['date_tolerance_days' => 2]);

        $this->postMatch($this->auth['token'], $wide)->assertCreated();
        $this->postMatch($this->auth['token'], $tight)->assertCreated();
        $this->assertSame('matched', $this->statementRows($this->auth['token'], $wide)[2]['outcome']);
        $this->assertSame('missing_in_books', $this->statementRows($this->auth['token'], $tight)[2]['outcome'], 'تسامح ٢ يوم: خارج النافذة ⇒ لا مرشح.');

        $amount = $this->statement([['date' => '2026-09-10', 'credit' => 11510]], ['amount_tolerance_minor' => 10, 'date_tolerance_days' => 0]);
        $this->postMatch($this->auth['token'], $amount)->assertCreated();
        $this->assertSame('matched', $this->statementRows($this->auth['token'], $amount)[2]['outcome']);
    }

    // ═══════════════════════════════ many-to-one: اقتراح وتحقق ═══════════════════════════════

    /** @test */
    public function many_to_one_is_suggested_and_verifiable_but_never_applied(): void
    {
        $p1 = $this->invoice('2026-09-02', 30000);   // ٣٤٥٠٠
        $p2 = $this->invoice('2026-09-03', 45000);   // ٥١٧٥٠
        $p3 = $this->invoice('2026-09-04', 12345);

        $id = $this->statement([['date' => '2026-09-04', 'credit' => 86250]]);   // ٣٤٥٠٠ + ٥١٧٥٠
        $this->postMatch($this->auth['token'], $id)->assertCreated();
        $row = $this->statementRows($this->auth['token'], $id)[2];
        $this->assertSame('missing_in_books', $row['outcome'], 'لا مطابقة تلقائية لمجموعة.');
        $this->assertSame([['suggestion' => true, 'unit_keys' => ['invoice#'.$p1->id, 'invoice#'.$p2->id], 'sum_minor' => 86250, 'difference_minor' => 0]], array_map(fn (array $s): array => $s, $this->sortKeys($row['suggestions'])));

        $matchesBefore = PartnerStatementMatch::query()->count();
        $lineId = $row['line_id'];
        $url = "/api/partner-statement-reconciliations/{$id}/verify-set?".http_build_query(['line_id' => $lineId, 'unit_keys' => ['invoice#'.$p1->id, 'invoice#'.$p2->id]]);
        $ok = $this->withToken($this->auth['token'])->getJson($url)->assertOk()->json('data');
        $this->assertSame([false, true, 0, 86250, 86250], [$ok['applied'], $ok['equal_within_tolerance'], $ok['difference_minor'], $ok['set_net_minor'], $ok['expected_net_minor']]);

        $wrong = $this->withToken($this->auth['token'])->getJson("/api/partner-statement-reconciliations/{$id}/verify-set?".http_build_query(['line_id' => $lineId, 'unit_keys' => ['invoice#'.$p1->id, 'invoice#'.$p3->id]]))->assertOk()->json('data');
        $this->assertSame([false, 86250 - 34500 - (int) $p3->fresh()->total], [$wrong['equal_within_tolerance'], $wrong['difference_minor']]);

        $unknown = $this->withToken($this->auth['token'])->getJson("/api/partner-statement-reconciliations/{$id}/verify-set?".http_build_query(['line_id' => $lineId, 'unit_keys' => ['invoice#nope']]))->assertOk()->json('data');
        $this->assertSame([false, 'unit_not_in_candidates'], [$unknown['equal_within_tolerance'], $unknown['problems'][0]['code']]);

        $this->withToken($this->auth['token'])->getJson("/api/partner-statement-reconciliations/{$id}/verify-set?".http_build_query(['line_id' => $lineId, 'unit_keys' => array_map(fn (int $i): string => "k{$i}", range(1, 51))]))->assertStatus(422);
        $this->assertSame($matchesBefore, PartnerStatementMatch::query()->count(), 'التحقق قراءة فقط.');
    }

    /** @param list<array<string, mixed>> $suggestions @return list<array<string, mixed>> */
    private function sortKeys(array $suggestions): array
    {
        return array_map(function (array $s): array {
            ksort($s);

            return ['suggestion' => $s['suggestion'], 'unit_keys' => $s['unit_keys'], 'sum_minor' => $s['sum_minor'], 'difference_minor' => $s['difference_minor']];
        }, $suggestions);
    }

    // ═══════════════════════════════ RBAC وبوابة القدرة والعزل والفروع ═══════════════════════════════

    /** @test */
    public function permissions_are_independent_and_partner_visibility_is_required(): void
    {
        $this->invoice('2026-09-01', 100000);
        $id = $this->statement([['date' => '2026-09-01', 'credit' => 115000]]);
        $this->postMatch($this->auth['token'], $id)->assertCreated();

        $viewer = $this->role('ps-mv', ['partner_statements.view', 'partners.view'], 'mv@ps-a2c.test');
        $this->getMatches($viewer, $id)->assertOk();
        $this->postMatch($viewer, $id)->assertForbidden();

        // reconcile بلا view: التشغيل يقرأ الدفتر والنتائج فيتطلب الصلاحيتين معاً (لا منح ضمني)؛ والقراءة ترفض.
        $reconcileOnly = $this->role('ps-mr', ['partner_statements.reconcile', 'partners.view'], 'mr@ps-a2c.test');
        $this->postMatch($reconcileOnly, $id)->assertForbidden();
        $this->getMatches($reconcileOnly, $id)->assertForbidden();

        $both = $this->role('ps-mb', ['partner_statements.view', 'partner_statements.reconcile', 'partners.view'], 'mb@ps-a2c.test');
        $this->postMatch($both, $id)->assertOk();
        $this->getMatches($both, $id)->assertOk();

        $noPartners = $this->role('ps-mn', ['partner_statements.view', 'partner_statements.reconcile'], 'mn@ps-a2c.test');
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->getMatches($noPartners, $id)->assertStatus(422)->json('message'));
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->postMatch($noPartners, $id)->assertStatus(422)->json('message'));

        $none = $this->role('ps-m0', ['reports.view'], 'm0@ps-a2c.test');
        $this->getMatches($none, $id)->assertForbidden();
        $this->postMatch($none, $id)->assertForbidden();
    }

    /** @test */
    public function the_application_gate_blocks_everything_when_disabled_and_writes_when_suspended(): void
    {
        $this->invoice('2026-09-01', 100000);
        $id = $this->statement([['date' => '2026-09-01', 'credit' => 115000]]);
        $this->postMatch($this->auth['token'], $id)->assertCreated();

        // كشف مستورد ⇒ الإيقاف تعليق: القراءة تمرّ والتشغيل مرفوض.
        $this->assertSame('suspended', app(TenantApplicationService::class)->disable('accounting.partner_statements', null)->status);
        $this->getMatches($this->auth['token'], $id)->assertOk();
        $this->postMatch($this->auth['token'], $id)->assertForbidden();
        $this->withToken($this->auth['token'])->getJson("/api/partner-statement-reconciliations/{$id}/verify-set?line_id=".$this->statementRows_lineId($id).'&unit_keys[]=x')->assertOk();

        // مستأجر لم يفعّل القدرة أبداً (لا قرار ⇒ معطّلة): كل شيء 403.
        $other = $this->registerTenant('ps-a2c-off', 'owner@off.test', autoEnableApplications: false);
        $uuid = '00000000-0000-4000-8000-000000000000';
        $this->postMatch($other['token'], $uuid)->assertForbidden();
        $this->getMatches($other['token'], $uuid)->assertForbidden();
        $this->withToken($other['token'])->getJson("/api/partner-statement-reconciliations/{$uuid}/verify-set?line_id={$uuid}&unit_keys[]=x")->assertForbidden();
    }

    private function statementRows_lineId(string $reconciliationId): string
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return (string) \App\Models\PartnerStatementLine::query()->where('reconciliation_id', $reconciliationId)->value('id');
    }

    /** @test */
    public function another_tenants_reconciliation_and_unknown_ids_get_one_identical_refusal(): void
    {
        $other = $this->registerTenant('ps-a2c-other', 'owner@other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $otherOwner = User::query()->where('email', 'owner@other.test')->firstOrFail();
        $foreignPartner = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف آخر', 'is_active' => true]);
        $foreign = $this->statement([['date' => '2026-09-01', 'credit' => 100]], tenantId: $other['tenant_id'], user: $otherOwner, partner: $foreignPartner);
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->actingAs($this->owner);

        $message = PartnerStatementImportService::PARTNER_UNAVAILABLE;
        foreach ([$foreign, '00000000-0000-4000-8000-000000000000'] as $id) {
            $this->assertSame($message, $this->postMatch($this->auth['token'], $id)->assertStatus(422)->json('message'), $id);
            $this->assertSame($message, $this->getMatches($this->auth['token'], $id)->assertStatus(422)->json('message'), $id);
        }
        // معرّف غير UUID لا يطابق قيد المسار العام أصلاً (404 من الإطار، بلا قراءة).
        $this->postMatch($this->auth['token'], 'not-a-uuid')->assertNotFound();
        $this->assertSame(0, PartnerStatementMatchRun::query()->count());
    }

    /** @test */
    public function a_branch_restricted_actor_matches_only_inside_their_branch_and_never_sees_other_branches(): void
    {
        $inside = Branch::create(['code' => 'IN', 'name' => 'فرع داخل']);
        $outside = Branch::create(['code' => 'OUT', 'name' => 'فرع خارج']);
        $mine = $this->invoice('2026-09-01', 100000, $inside->id);            // ترقيم الفواتير لكل فرع: ‎00001‎ في «داخل»
        $this->invoice('2026-09-05', 1000, $outside->id);                     // ‎00001‎ في «خارج» (نفس رقم فاتورتي)
        $foreign = $this->invoice('2026-09-02', 70000, $outside->id);         // ‎00002‎ في «خارج»: رقم لا يملكه فرعي

        $token = $this->role('ps-branch', ['partner_statements.view', 'partner_statements.reconcile', 'partners.view'], 'br@ps-a2c.test');
        User::query()->where('email', 'br@ps-a2c.test')->firstOrFail()->branches()->sync([$inside->id]);

        $id = $this->statement([
            ['date' => '2026-09-01', 'our' => $mine->number, 'credit' => 115000],
            ['date' => '2026-09-02', 'our' => $foreign->number, 'credit' => 80500],
        ]);
        $run = $this->postMatch($token, $id)->assertCreated()->json('data');
        $this->assertSame(['branch', [$inside->id]], [$run['scope']['kind'], $run['scope']['branch_ids']]);

        $body = (string) $this->getMatches($token, $id, ['per_page' => 50])->assertOk()->getContent();
        $this->assertStringContainsString($mine->number, $body);
        $this->assertStringNotContainsString($foreign->number, $body, 'قيود الفرع الآخر لا تظهر.');
        $this->assertSame('missing_in_books', $this->statementRows($token, $id)[3]['outcome']);

        // غير المقيَّد يرى الفرعين: الرقم ‎00001‎ يصيب وثيقتين في فرعين ⇒ غموض صريح لا تخمين.
        $orgRun = $this->postMatch($this->auth['token'], $id)->assertCreated()->json('data');
        $this->assertSame('organization', $orgRun['scope']['kind']);
        $this->assertSame('ambiguous_multiple_documents_for_reference', $this->statementRows($this->auth['token'], $id)[2]['explanation']['code']);

        // مقارنة بفلتر فرع خارج نطاقه: مرفوضة.
        $outsideRecon = $this->statement([['date' => '2026-09-02', 'credit' => 80500]], ['branch_id' => $outside->id]);
        $this->assertSame('هذا الفرع خارج نطاق صلاحياتك.', $this->postMatch($token, $outsideRecon)->assertStatus(422)->json('message'));
        $this->getMatches($token, $outsideRecon)->assertStatus(422);
    }

    /**
     * Codex #1908 P1: نتائج مخزَّنة بنطاق أوسع من نطاق القارئ لا تُعاد له — لا بالاختيار الافتراضي ولا بـrun_id صريح؛ ويُختار له أحدث تشغيلة **مقروءة** له.
     *
     * @test
     */
    public function a_stored_run_is_only_readable_inside_the_readers_branch_scope(): void
    {
        $inside = Branch::create(['code' => 'IN', 'name' => 'فرع داخل']);
        $outside = Branch::create(['code' => 'OUT', 'name' => 'فرع خارج']);
        $mine = $this->invoice('2026-09-01', 100000, $inside->id);            // ‎00001‎ في «داخل»
        $this->invoice('2026-09-05', 1000, $outside->id);                     // ‎00001‎ في «خارج» (ترقيم الفواتير لكل فرع)
        $other = $this->invoice('2026-09-02', 70000, $outside->id);           // ‎00002‎ في «خارج»: رقم لا يملكه فرعي
        $restrictedToken = $this->role('ps-scope', ['partner_statements.view', 'partner_statements.reconcile', 'partners.view'], 'sc@ps-a2c.test');
        User::query()->where('email', 'sc@ps-a2c.test')->firstOrFail()->branches()->sync([$inside->id]);

        $id = $this->statement([['date' => '2026-09-01', 'credit' => 115000], ['date' => '2026-09-02', 'credit' => 80500]]);
        $orgRun = $this->postMatch($this->auth['token'], $id)->assertCreated()->json('data');
        $this->assertSame('organization', $orgRun['scope']['kind']);

        // تشغيلة المؤسسة مخزَّنة ببيانات الفرعين؛ المقيَّد لا يقرؤها: لا افتراضياً ولا صراحةً.
        $default = $this->getMatches($restrictedToken, $id)->assertOk();
        $this->assertNull($default->json('run'));
        $this->assertSame([], $default->json('data'));
        $this->assertStringNotContainsString($other->number.'"', (string) $default->getContent());
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->getMatches($restrictedToken, $id, ['run_id' => $orgRun['id']])->assertStatus(422)->json('message'));

        // يشغّل بنطاقه فيرى تشغيلته هو (الأحدث المقروءة)، دون وحدات الفرع الآخر.
        $own = $this->postMatch($restrictedToken, $id)->assertCreated()->json('data');
        $this->assertSame('branch', $own['scope']['kind']);
        $page = $this->getMatches($restrictedToken, $id, ['per_page' => 50])->assertOk();
        $this->assertSame($own['id'], $page->json('run.id'));
        $this->assertStringNotContainsString($other->number.'"', (string) $page->getContent());
        $this->assertStringContainsString($mine->number, (string) $page->getContent());

        // غير المقيَّد يقرأ كل التشغيلات؛ والأحدث له تشغيلة المقيَّد (الأحدث زمنياً)، والمؤسسة بـrun_id.
        $this->getMatches($this->auth['token'], $id, ['run_id' => $orgRun['id']])->assertOk();
        $this->assertSame($own['id'], $this->getMatches($this->auth['token'], $id)->assertOk()->json('run.id'));
    }

    // ═══════════════════════════════ الواجهة والحدود ═══════════════════════════════

    /** @test */
    public function the_matches_endpoint_filters_paginates_and_rejects_unknown_parameters(): void
    {
        foreach (range(1, 6) as $i) {
            $this->invoice('2026-09-0'.$i, 1000 * $i);
        }
        $id = $this->statement([['date' => '2026-09-01', 'credit' => 1150], ['date' => '2026-09-28', 'credit' => 424242]]);
        $this->postMatch($this->auth['token'], $id)->assertCreated();

        $page = $this->getMatches($this->auth['token'], $id, ['per_page' => 3])->assertOk();
        $this->assertSame([3, 3], [count($page->json('data')), $page->json('meta.per_page')]);
        $this->assertSame(8, $page->json('meta.total'));   // سطرا كشف + ٦ وحدات
        $this->assertSame(['statement', 'statement'], array_slice(array_column($page->json('data'), 'side'), 0, 2), 'جهة الكشف أولاً.');

        $this->assertSame(['missing_in_books'], array_unique(array_column($this->getMatches($this->auth['token'], $id, ['outcome' => ['missing_in_books']])->assertOk()->json('data'), 'outcome')));
        $this->getMatches($this->auth['token'], $id, ['per_page' => 51])->assertStatus(422);
        $this->getMatches($this->auth['token'], $id, ['tenant_id' => 'x'])->assertStatus(422);
        $this->getMatches($this->auth['token'], $id, ['outcome' => ['invented']])->assertStatus(422);
        $this->withToken($this->auth['token'])->postJson("/api/partner-statement-reconciliations/{$id}/match", ['date_tolerance_days' => 30])->assertStatus(422);
    }

    /** @test */
    public function results_are_immutable_and_the_migration_refuses_to_roll_back_with_data(): void
    {
        $this->invoice('2026-09-01', 100000);
        $id = $this->statement([['date' => '2026-09-01', 'credit' => 115000]]);
        $this->postMatch($this->auth['token'], $id)->assertCreated();

        $this->expectException(\LogicException::class);
        try {
            PartnerStatementMatch::query()->firstOrFail()->update(['outcome' => 'invented_outcome']);
        } finally {
            $migration = require base_path('database/migrations/2026_12_27_010000_create_partner_statement_match_tables.php');
            try {
                $migration->down();
                $this->fail('كان يجب أن يرفض التراجع.');
            } catch (\RuntimeException) {
                $this->assertGreaterThan(0, PartnerStatementMatchRun::query()->count());
            }
        }
    }

    /** @test */
    public function the_matching_code_references_no_financial_writer_and_writes_only_its_own_tables(): void
    {
        $files = [
            'app/Services/PartnerStatementMatchingEngine.php', 'app/Services/PartnerStatementMatchService.php',
            'app/Http/Controllers/Api/PartnerStatementMatchController.php', 'app/Models/PartnerStatementMatch.php', 'app/Models/PartnerStatementMatchRun.php',
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
            // الكتابة (إنشاء/إدراج) على جدولَي النتائج وحدهما.
            preg_match_all('/([A-Za-z\\\\]+)::(?:create|insert|forceCreate|updateOrCreate)\(/', $source, $writes);
            foreach ($writes[1] as $target) {
                $this->assertContains($target, ['PartnerStatementMatchRun', 'PartnerStatementMatch'], "{$file} يكتب على {$target}");
            }
            preg_match_all('/([A-Za-z\\\\]+)::query\(\)->insert\(/', $source, $inserts);
            foreach ($inserts[1] as $target) {
                $this->assertSame('PartnerStatementMatch', $target);
            }
        }
    }
}
