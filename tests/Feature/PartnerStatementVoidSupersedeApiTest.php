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
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Models\PartnerStatementReviewDecision;
use App\Services\PartnerStatementClaimService;
use App\Services\PartnerStatementImportService;
use App\Services\PartnerStatementLifecycleService;
use App\Support\PartnerStatementReviewException;
use App\Services\TenantApplicationService;
use App\Support\PartnerStatementVoidSeparation;
use App\Support\Rbac;
use App\Support\Settings;
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
 * IMP-PARTNER-STATEMENTS PS-A3e — إبطال النهائي `closed → voided` والاستبدال الذرّي `closed → superseded` + إغلاق البديلة، وإفراج المطالبات بالقاعدة نفسها:
 * الصلاحية المستقلة `partner_statements.void`، السبب والفاعل والوقت، بقاء التاريخ (قرارات/مطالبات/أحداث)، منع المطالبة المزدوجة قبل الإفراج وإعادة الاستعمال بعده، فصل المراجِع عن المُغلِق في البديلة،
 * التراجع الكامل عند أي فشل، إعادة الطلب، حراس القاعدة ضد SQL خام، وعدم الأثر المالي. التزامن الحقيقي على PostgreSQL في PartnerStatementVoidSupersedeConcurrencyPostgresTest.
 * تشغيل: php artisan test --filter=PartnerStatementVoidSupersedeApiTest
 */
class PartnerStatementVoidSupersedeApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private array $auth;

    private User $owner;

    private Partner $both;

    private string $closer;

    private string $closerId;

    private string $voider;

    private string $voiderId;

    private string $retirer;

    private string $retirerId;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->auth = $this->registerTenant('ps-a3e', 'owner@ps-a3e.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->owner = User::query()->where('email', 'owner@ps-a3e.test')->firstOrFail();
        $this->both = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف الإغلاق', 'is_active' => true]);
        $this->closer = $this->role('ps-closer', ['partner_statements.view', 'partner_statements.close', 'partners.view'], 'closer@ps-a3e.test');
        $this->closerId = (string) User::query()->where('email', 'closer@ps-a3e.test')->value('id');
        $this->voider = $this->role('ps-voider', ['partner_statements.view', 'partner_statements.void', 'partners.view'], 'voider@ps-a3e.test');
        $this->voiderId = (string) User::query()->where('email', 'voider@ps-a3e.test')->value('id');
        $this->retirer = $this->role('ps-retirer', ['partner_statements.view', 'partner_statements.close', 'partner_statements.void', 'partners.view'], 'retirer@ps-a3e.test');
        $this->retirerId = (string) User::query()->where('email', 'retirer@ps-a3e.test')->value('id');
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

    // ═══════════════════════════════ أدوات A3e ═══════════════════════════════

    private function void(string $token, string $id, ?string $reason = 'خطأ في التسوية')
    {
        return $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/void", $reason === null ? [] : ['reason' => $reason]);
    }

    /** @param list<string> $replaces */
    private function replace(string $token, string $newId, string $runId, array $replaces, ?string $reason = 'استبدال بتسوية أدق', ?array $ack = null)
    {
        return $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$newId}/replace", array_filter([
            'run_id' => $runId, 'replaces' => $replaces, 'reason' => $reason, 'acknowledge_overlap' => $ack,
        ], fn ($v) => $v !== null));
    }

    private function reopen(string $token, string $id)
    {
        return $this->withToken($token)->postJson("/api/partner-statement-reconciliations/{$id}/reopen", ['reason' => 'إعادة فتح']);
    }

    /** @return array{0: string, 1: array<string, mixed>, 2: Invoice} نهائي مُغلق ببند واحد يطالب بقيد فاتورة. */
    private function finalized(string $date = '2026-09-01', int $price = 100000, ?string $closerToken = null, ?array $period = null): array
    {
        $invoice = $this->invoice($date, $price);
        [$id, $run] = $this->ready([['date' => $date, 'our' => $invoice->number, 'credit' => intdiv($price * 115, 100)]], $period ?? []);
        $this->close($closerToken ?? $this->closer, $id, $run['id'])->assertCreated();

        return [$id, $run, $invoice];
    }

    /** @return array{0: string, 1: array<string, mixed>} مقارنة بديلة مراجَعة (المالك) لنفس الفاتورة/الفترة. */
    private function candidate(Invoice $invoice, int $credit = 115000): array
    {
        // مرجع فريد: كشف مطابق حرفياً يُعاد استيراده بالمعرّف نفسه (منع التكرار) فلا يصلح بديلاً.
        return $this->ready([['date' => '2026-09-01', 'ref' => 'R'.uniqid(), 'our' => $invoice->number, 'credit' => $credit]]);
    }

    private function activeClaims(string $id): int
    {
        return DB::table('partner_statement_unit_claims')->where('reconciliation_id', $id)->whereNull('released_at')->count();
    }

    private function allClaims(string $id): int
    {
        return DB::table('partner_statement_unit_claims')->where('reconciliation_id', $id)->count();
    }

    private function actions(string $id): array
    {
        return DB::table('partner_statement_reconciliation_events')->where('reconciliation_id', $id)->orderBy('seq')->pluck('action')->all();
    }

    // ═══════════════════════════════ الإبطال ═══════════════════════════════

    /** @test */
    public function voiding_records_reason_actor_and_time_releases_claims_keeps_history_and_has_no_financial_effect(): void
    {
        [$id, $run, $invoice] = $this->finalized();
        $this->assertSame([1, 1], [$this->activeClaims($id), $this->allClaims($id)]);
        $decisions = DB::table('partner_statement_review_decisions')->where('reconciliation_id', $id)->count();
        $before = $this->counts();

        $this->assertSame(['available' => true, 'blocked_reason' => null, 'separation_policy' => 'strict'], $this->lcStatus($this->voider, $id)->assertOk()->json('data.void'));
        $res = $this->void($this->voider, $id, 'سبب الإبطال')->assertCreated();
        $this->assertFalse($res->json('replayed'));
        $data = $res->json('data');
        $this->assertSame(['voided', $this->voiderId, 'سبب الإبطال', null], [$data['reconciliation']['status'], $data['reconciliation']['voided_by'], $data['reconciliation']['void_reason'], $data['reconciliation']['superseded_by_id']]);
        $this->assertNotNull($data['reconciliation']['voided_at']);
        $this->assertSame(['available' => false, 'blocked_reason' => 'already_voided', 'separation_policy' => 'strict'], $data['void']);

        // المطالبات: أُفرج عنها لا حُذفت (سجل تاريخي كامل)، بوقت الإبطال نفسه.
        $this->assertSame([0, 1], [$this->activeClaims($id), $this->allClaims($id)]);
        $row = DB::table('partner_statement_unit_claims')->where('reconciliation_id', $id)->first();
        $this->assertSame((string) DB::table('partner_statement_reconciliations')->where('id', $id)->value('voided_at'), (string) $row->released_at);
        $this->assertSame([0, 1], [$data['final']['active_claims_count'], $data['final']['claims_count']]);

        // التاريخ: قرارات + حدث الإغلاق الأصلي باقيان وحدث الإبطال مضاف بهوية الفاعل ونسخة المطالبات.
        $this->assertSame($decisions, DB::table('partner_statement_review_decisions')->where('reconciliation_id', $id)->count());
        $this->assertSame(['mark_reviewed', 'close', 'void'], $this->actions($id));
        $events = collect($this->events($this->voider, $id)->assertOk()->json('data'));
        $void = $events->firstWhere('action', 'void');
        $this->assertSame([3, 'closed', 'voided', $run['id'], $this->voiderId, 1, null, 'سبب الإبطال'], [$void['seq'], $void['from_status'], $void['to_status'], $void['run_id'], $void['created_by'], $void['claims_count'], $void['related_reconciliation_id'], $void['reason']]);
        $this->assertNotNull($events->firstWhere('action', 'close'));
        $this->assertSame($before, $this->counts(), 'لا قيد ولا مستند ولا رصيد ولا مخزون يتغيّر بالإبطال.');
    }

    /** @test */
    public function a_void_replay_is_safe_a_different_reason_conflicts_and_the_reason_is_mandatory(): void
    {
        [$id] = $this->finalized();
        $this->void($this->voider, $id, null)->assertStatus(422);
        $this->assertSame('reason_required', $this->void($this->voider, $id, 'ab')->assertStatus(422)->json('reason'));
        $this->void($this->voider, $id, str_repeat('س', 501))->assertStatus(422);
        $this->assertSame('closed', $this->reconciliation($id)->status);

        $this->void($this->voider, $id, 'سبب واحد')->assertCreated();
        $again = $this->void($this->voider, $id, 'سبب واحد')->assertOk();
        $this->assertTrue($again->json('replayed'));
        $this->assertSame(['mark_reviewed', 'close', 'void'], $this->actions($id), 'لا حدث ثانٍ.');
        $this->assertSame('reconciliation_already_voided', $this->void($this->voider, $id, 'سبب آخر')->assertStatus(409)->json('reason'));
        $this->assertSame('سبب واحد', $this->reconciliation($id)->void_reason, 'السبب الأول لا يتغيّر.');
    }

    /** @test */
    public function only_a_closed_final_can_be_voided_and_a_voided_one_is_terminal(): void
    {
        $invoice = $this->invoice('2026-09-01', 100000);
        [$id, $run] = $this->candidate($invoice);
        $this->assertSame('reconciliation_not_closed', $this->void($this->voider, $id)->assertStatus(409)->json('reason'), 'مراجَعة لا تُبطَل.');
        $this->assertSame('not_closed', $this->lcStatus($this->voider, $id)->json('data.void.blocked_reason'));

        $this->close($this->closer, $id, $run['id'])->assertCreated();
        $this->void($this->voider, $id)->assertCreated();

        // طرفية: لا فتح ولا مراجعة ولا إغلاق ولا قرار ولا استبدال لها.
        $this->reopen($this->auth['token'], $id)->assertStatus(409);
        $this->review($this->auth['token'], $id, $run['id'])->assertStatus(409);
        $this->assertSame('reconciliation_not_reviewed', $this->close($this->retirer, $id, $run['id'])->assertStatus(409)->json('reason'));
        $this->decide($this->auth['token'], $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear', 'reason' => 'x'])->assertStatus(409);
        $this->assertSame(['voided', 0], [$this->reconciliation($id)->status, $this->activeClaims($id)]);
        $this->assertSame('already_voided', $this->lcStatus($this->closer, $id)->json('data.close.blocked_reason'));
    }

    /** @test */
    public function a_released_claim_is_reusable_only_after_the_void_and_the_double_claim_guard_holds_before_it(): void
    {
        [$a, , $invoice] = $this->finalized();
        [$b, $runB] = $this->candidate($invoice);

        // قبل الإبطال: الحركة محجوزة ⇒ لا مطالبة مزدوجة (النطاق والفترة نفسهما).
        $before = $this->close($this->closer, $b, $runB['id'])->assertStatus(409);
        $this->assertSame('final_already_exists', $before->json('reason'));
        $this->assertSame([0, 1], [$this->activeClaims($b), $this->activeClaims($a)]);

        $this->void($this->voider, $a)->assertCreated();
        $this->close($this->closer, $b, $runB['id'])->assertCreated();
        $this->assertSame([0, 1, 1], [$this->activeClaims($a), $this->allClaims($a), $this->activeClaims($b)]);
        $this->assertSame($this->claimed($a), $this->claimed($b), 'القيد نفسه صار مطالَباً به من البديلة.');
        $this->assertSame(1, DB::table('partner_statement_unit_claims')->whereNull('released_at')->count());
    }

    // ═══════════════════════════════ الاستبدال ═══════════════════════════════

    /** @test */
    public function replacing_supersedes_the_original_and_closes_the_replacement_in_one_transaction_with_linked_audit(): void
    {
        [$a, $runA, $invoice] = $this->finalized();
        [$b, $runB] = $this->candidate($invoice);
        $before = $this->counts();

        $res = $this->replace($this->retirer, $b, $runB['id'], [$a], 'تسوية أدق')->assertCreated();
        $data = $res->json('data');
        $this->assertSame(['closed', $this->retirerId, $this->owner->id], [$data['reconciliation']['status'], $data['reconciliation']['closed_by'], $data['reconciliation']['reviewed_by']], 'المراجِع ≠ المُغلِق في البديلة.');

        $orig = $this->reconciliation($a);
        $this->assertSame(['superseded', $b, $this->retirerId, 'تسوية أدق'], [$orig->status, $orig->superseded_by_id, $orig->voided_by, $orig->void_reason]);
        $this->assertSame([0, 1, 1], [$this->activeClaims($a), $this->allClaims($a), $this->activeClaims($b)]);

        // التدقيق: الأصل `supersede` يربط البديلة، والبديلة `close` تحمل قائمة المُستبدَلات.
        $se = DB::table('partner_statement_reconciliation_events')->where('reconciliation_id', $a)->where('action', 'supersede')->first();
        $this->assertSame([$b, 'closed', 'superseded', 1], [$se->related_reconciliation_id, $se->from_status, $se->to_status, (int) $se->claims_count]);
        $close = collect($this->events($this->retirer, $b)->json('data'))->firstWhere('action', 'close');
        $this->assertSame([$a], $close['summary']['supersedes']);
        $this->assertSame($before, $this->counts(), 'لا أثر مالي.');
        $this->assertSame(['available' => false, 'blocked_reason' => 'already_superseded', 'separation_policy' => 'strict'], $this->lcStatus($this->retirer, $a)->json('data.void'));
        $this->assertSame($b, $this->lcStatus($this->retirer, $a)->json('data.reconciliation.superseded_by_id'));
    }

    /** @test */
    public function a_failed_replacement_rolls_everything_back_the_original_stays_closed_with_its_claims(): void
    {
        [$a, , $invoice] = $this->finalized();
        $before = $this->counts();
        $snapshot = fn (): array => [
            $this->reconciliation($a)->status, $this->activeClaims($a), count($this->actions($a)), DB::table('partner_statement_reconciliation_events')->count(), $this->claimCount(),
        ];

        // (1) المُغلِق هو المراجِع ⇒ 403 (فصل المهام يسري على البديلة).
        [$b, $runB] = $this->candidate($invoice);
        $state = $snapshot();
        $owner = $this->replace($this->auth['token'], $b, $runB['id'], [$a])->assertStatus(403);
        $this->assertSame('closer_must_differ_from_reviewer', $owner->json('reason'));
        $this->assertSame($state, $snapshot());

        // (2) تعارض بعد الاستبدال: نهائي ثالث يحجز قيداً من البديلة (لا يشمله الاستبدال) ⇒ unit_conflict وتراجع كامل.
        $other = $this->invoice('2026-09-02', 40000);
        [$c, $runC] = $this->ready([['date' => '2026-09-02', 'our' => $other->number, 'credit' => 46000]], ['period_from' => '2026-09-02', 'period_to' => '2026-09-02']);
        $this->close($this->closer, $c, $runC['id'], [$a])->assertCreated();   // فترة يوم واحد داخل فترة أ: إقرار التداخل
        [$d, $runD] = $this->ready([
            ['date' => '2026-09-01', 'ref' => 'D1', 'our' => $invoice->number, 'credit' => 115000],
            ['date' => '2026-09-02', 'ref' => 'D2', 'our' => $other->number, 'credit' => 46000],
        ]);
        $state = $snapshot();
        $before = $this->counts();
        $conflict = $this->replace($this->retirer, $d, $runD['id'], [$a])->assertStatus(409);
        $this->assertSame('unit_conflict', $conflict->json('reason'));
        $this->assertSame($state, $snapshot(), 'الأصل لم يُستبدَل رغم أن خطوة الاستبدال سبقت فحص التعارض.');
        $this->assertSame(['reviewed', 0], [$this->reconciliation($d)->status, $this->activeClaims($d)]);
        $this->assertSame(['mark_reviewed', 'close'], $this->actions($a));
        $this->assertSame($before, $this->counts());
    }

    /** @test */
    public function the_replacement_contract_is_validated_targets_must_be_closed_finals_of_the_same_partner_and_role(): void
    {
        [$a, , $invoice] = $this->finalized();
        [$b, $runB] = $this->candidate($invoice);

        $this->replace($this->retirer, $b, $runB['id'], [])->assertStatus(422);
        $this->assertSame('replace_self', $this->replace($this->retirer, $b, $runB['id'], [$b])->assertStatus(422)->json('reason'));
        $this->replace($this->retirer, $b, $runB['id'], [$a, $a])->assertStatus(422);   // distinct
        $this->replace($this->retirer, $b, $runB['id'], [$a], null)->assertStatus(422);  // السبب إلزامي
        $this->assertSame('reason_required', $this->replace($this->retirer, $b, $runB['id'], [$a], 'ab')->assertStatus(422)->json('reason'));
        $this->replace($this->retirer, $b, $runB['id'], ['x'])->assertStatus(422);
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->replace($this->retirer, $b, $runB['id'], [(string) Str::uuid()])->assertStatus(422)->json('message'));

        // هدف ليس نهائياً مغلقاً (مراجَعة) ⇒ 409؛ طرف آخر ⇒ 422.
        [$rev] = $this->candidate($invoice);
        $this->assertSame('replace_target_not_closed', $this->replace($this->retirer, $b, $runB['id'], [$rev])->assertStatus(409)->json('reason'));
        $other = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف آخر', 'is_active' => true]);
        $otherId = $this->statement([['date' => '2026-09-01', 'credit' => 1000]], ['partner_id' => $other->id]);
        $oRun = $this->match($this->auth['token'], $otherId);
        $this->decide($this->auth['token'], $otherId, ['run_id' => $oRun['id'], 'line_id' => $this->lineId($otherId, 2), 'action' => 'dismiss', 'reason' => 'لا مطابقة'])->assertCreated();
        $this->review($this->auth['token'], $otherId, $oRun['id'])->assertCreated();
        $this->close($this->closer, $otherId, $oRun['id'])->assertCreated();
        $this->assertSame('replace_target_mismatch', $this->replace($this->retirer, $b, $runB['id'], [$otherId])->assertStatus(422)->json('reason'));

        // لا شيء تغيّر.
        $this->assertSame(['closed', 'reviewed'], [$this->reconciliation($a)->status, $this->reconciliation($b)->status]);
        $this->assertSame(1, $this->activeClaims($a));
    }

    /** @test */
    public function a_replacement_replay_is_safe_and_a_different_set_or_a_superseded_target_is_refused(): void
    {
        [$a, , $invoice] = $this->finalized();
        [$b, $runB] = $this->candidate($invoice);
        $this->replace($this->retirer, $b, $runB['id'], [$a])->assertCreated();
        $events = DB::table('partner_statement_reconciliation_events')->count();

        $again = $this->replace($this->retirer, $b, $runB['id'], [$a])->assertOk();
        $this->assertTrue($again->json('replayed'));
        $this->assertSame($events, DB::table('partner_statement_reconciliation_events')->count());
        $this->assertSame('reconciliation_already_closed', $this->close($this->retirer, $b, $runB['id'])->assertStatus(409)->json('reason'), 'إغلاق عادي بلا قائمة ≠ الاستبدال المسجَّل.');

        // المُستبدَل لا يُبطَل ولا يُستبدَل ثانيةً.
        $this->assertSame('reconciliation_already_superseded', $this->void($this->voider, $a)->assertStatus(409)->json('reason'));
        [$c, $runC] = $this->candidate($invoice);
        $this->assertSame('replace_target_not_closed', $this->replace($this->retirer, $c, $runC['id'], [$a])->assertStatus(409)->json('reason'));
        // وإبطال البديلة الجديدة يفرج مطالباتها فقط.
        $this->void($this->voider, $b)->assertCreated();
        $this->assertSame([0, 0, 1], [$this->activeClaims($a), $this->activeClaims($b), $this->allClaims($b)]);
    }

    /** @test */
    public function overlap_policy_still_applies_to_the_replacement_after_the_supersede(): void
    {
        $x = $this->invoice('2026-08-10', 100000);
        $y = $this->invoice('2026-09-10', 50000);
        [$a, $runA] = $this->ready([['date' => '2026-08-10', 'our' => $x->number, 'credit' => 115000]], ['period_from' => '2026-08-01', 'period_to' => '2026-08-31']);
        $this->close($this->closer, $a, $runA['id'])->assertCreated();
        [$o, $runO] = $this->ready([['date' => '2026-09-10', 'our' => $y->number, 'credit' => 57500]], ['period_from' => '2026-09-01', 'period_to' => '2026-09-30']);
        $this->close($this->closer, $o, $runO['id'])->assertCreated();

        // بديلة (15 أغسطس–30 سبتمبر) تتداخل مع أ ومع ع؛ نستبدل ع فقط ⇒ يبقى تداخل أ يلزم إقراراً مطابقاً.
        [$b, $runB] = $this->ready([['date' => '2026-09-10', 'ref' => 'B1', 'our' => $y->number, 'credit' => 57500]], ['period_from' => '2026-08-15', 'period_to' => '2026-09-30']);
        $req = $this->replace($this->retirer, $b, $runB['id'], [$o])->assertStatus(409);
        $this->assertSame(['overlap_ack_required', [$a]], [$req->json('reason'), array_column($req->json('details.overlaps'), 'id')], 'ع المُستبدَل لا يظهر تداخلاً؛ أ يظهر.');
        $this->assertSame(['closed', 'reviewed'], [$this->reconciliation($o)->status, $this->reconciliation($b)->status], 'الرفض يُرجع الاستبدال.');
        $this->replace($this->retirer, $b, $runB['id'], [$o], 'استبدال', [$a])->assertCreated();
        $this->assertSame(['superseded', 'closed', 'closed'], [$this->reconciliation($o)->status, $this->reconciliation($b)->status, $this->reconciliation($a)->status]);
    }

    // ═══════════════════════════════ الصلاحيات والنطاق ═══════════════════════════════

    /** @test */
    public function void_and_replace_permissions_are_explicit_never_granted_by_default_and_scoped_to_the_tenant_and_the_close_run(): void
    {
        [$a, , $invoice] = $this->finalized();
        [$b, $runB] = $this->candidate($invoice);

        $this->assertContains('partner_statements.void', Rbac::PERMISSIONS);
        $this->assertNotContains('partner_statements.void', array_merge(...array_values(Rbac::MATRIX)));
        foreach (array_diff(array_keys(Rbac::MATRIX), ['owner', 'admin']) as $role) {
            $this->assertFalse(Rbac::allows($role, 'partner_statements.void'), $role);
        }
        $this->assertTrue(Rbac::allows('owner', 'partner_statements.void'));

        // إغلاق وحده لا يُبطل ولا يستبدل؛ إبطال وحده لا يستبدل (الاستبدال يطلب الصلاحيتين).
        $this->void($this->closer, $a)->assertStatus(403);
        $this->replace($this->closer, $b, $runB['id'], [$a])->assertStatus(403);
        $this->replace($this->voider, $b, $runB['id'], [$a])->assertStatus(403);
        // إبطال بلا `view` ⇒ 403.
        $noView = $this->role('ps-void-only', ['partner_statements.void', 'partners.view'], 'vo@ps-a3e.test');
        $this->void($noView, $a)->assertStatus(403);
        // بلا صلاحية الأطراف ⇒ الرفض الموحَّد.
        $noPartners = $this->role('ps-void-np', ['partner_statements.view', 'partner_statements.void'], 'vnp@ps-a3e.test');
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->void($noPartners, $a)->assertStatus(422)->json('message'));
        $this->assertSame(['closed', 1], [$this->reconciliation($a)->status, $this->activeClaims($a)]);

        // مستأجر آخر لا يرى ولا يُبطل.
        $other = $this->registerTenant('ps-other', 'owner@ps-other.test');
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->withToken($other['token'])->postJson("/api/partner-statement-reconciliations/{$a}/void", ['reason' => 'عبر المستأجرين'])->assertStatus(422)->json('message'));
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->assertSame('closed', $this->reconciliation($a)->status);

        // مقيَّد بفرع لا يُخرج نهائي مؤسسة (نطاق أوسع من نطاقه): الرفض الموحَّد ولا تسريب.
        $branch = Branch::create(['code' => 'V1', 'name' => 'فرع']);
        $restricted = $this->role('ps-void-br', ['partner_statements.view', 'partner_statements.void', 'partners.view'], 'vbr@ps-a3e.test');
        User::query()->where('email', 'vbr@ps-a3e.test')->firstOrFail()->branches()->sync([$branch->id]);
        $this->void($restricted, $a)->assertStatus(422);
        $this->assertSame('close_scope_not_readable', $this->lcStatus($restricted, $a)->json('data.void.blocked_reason'));
        $this->assertSame(['closed', 1], [$this->reconciliation($a)->status, $this->activeClaims($a)]);

        // المالك (النجمة) وكل من يحمل الصلاحية الصريحة ينجح؛ مُبطِل = مُغلِق مسموح (D-PS-20: لا فصل مهام مفروض).
        $this->void($this->retirer, $a)->assertCreated();
    }

    // ═══════════════════════════════ حراس القاعدة (SQL خام) ═══════════════════════════════

    /** @test */
    public function raw_sql_cannot_void_edit_or_release_outside_the_contract(): void
    {
        [$a, $runA, $invoice] = $this->finalized();
        [$rev, $runRev] = $this->candidate($invoice);
        $t = $this->auth['tenant_id'];
        $now = now()->format('Y-m-d H:i:s');

        // إبطال بلا حدث، أو بحدث لا يطابق (فاعل/سبب)، مرفوض؛ والمطالبات لا تُفرَج بالتحديث المباشر.
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliations')->where('id', $a)->update(['status' => 'voided', 'voided_at' => $now, 'voided_by' => $this->voiderId, 'void_reason' => 'سبب']), 'إبطال بلا حدث');
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->where('reconciliation_id', $a)->update(['released_at' => $now]), 'إفراج مباشر');
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->where('reconciliation_id', $a)->delete(), 'حذف مطالبة');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliations')->where('id', $rev)->update(['status' => 'voided', 'voided_at' => $now, 'voided_by' => $this->voiderId, 'void_reason' => 'سبب']), 'إبطال مراجَعة');
        $seq = fn (): int => (int) DB::table('partner_statement_reconciliation_events')->where('reconciliation_id', $a)->max('seq') + 1;
        $event = fn (array $over = []): array => $over + [
            'id' => (string) Str::uuid(), 'tenant_id' => $t, 'reconciliation_id' => $a, 'seq' => $seq(), 'action' => 'void', 'from_status' => 'closed', 'to_status' => 'voided', 'run_id' => $runA['id'],
            'summary' => '{"void_separation":"strict"}', 'reason' => 'سبب', 'created_by' => $this->voiderId, 'claims_count' => 1, 'created_at' => $now,
        ];
        // حدث إبطال بعدد مطالبات خاطئ/بتشغيلة غير تشغيلة الإغلاق/لمراجَعة: مرفوض.
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->insert($event(['claims_count' => 0])), 'عدد مطالبات خاطئ');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->insert($event(['run_id' => $runRev['id']])), 'تشغيلة غير تشغيلة الإغلاق');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->insert($event(['reconciliation_id' => $rev, 'seq' => 3, 'run_id' => $runRev['id'], 'claims_count' => 0])), 'إبطال مراجَعة');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->insert($event(['action' => 'supersede', 'to_status' => 'superseded', 'related_reconciliation_id' => $a])), 'استبدال بنفسه');
        $this->assertSame(['closed', 1], [$this->reconciliation($a)->status, $this->activeClaims($a)]);

        // الحدث صحيح لكن الانتقال يُسجِّل فاعلاً أو سبباً مختلفاً عنه ⇒ مرفوض (الهوية والسبب في الصف = الحدث).
        $this->assertRejected(function () use ($a, $event, $now): void {
            DB::table('partner_statement_reconciliation_events')->insert($event());
            DB::table('partner_statement_reconciliations')->where('id', $a)->update(['status' => 'voided', 'voided_at' => $now, 'voided_by' => $this->closerId, 'void_reason' => 'سبب']);
        }, 'فاعل الانتقال ≠ فاعل الحدث');
        $this->assertRejected(function () use ($a, $event, $now): void {
            DB::table('partner_statement_reconciliation_events')->insert($event());
            DB::table('partner_statement_reconciliations')->where('id', $a)->update(['status' => 'voided', 'voided_at' => $now, 'voided_by' => $this->voiderId, 'void_reason' => 'سبب مختلف']);
        }, 'سبب الانتقال ≠ سبب الحدث');
        $this->assertSame(['closed', 1], [$this->reconciliation($a)->status, $this->activeClaims($a)]);

        // ضابط موجب: الحدث المطابق ثم الانتقال المطابق في معاملة واحدة ينجح ويُفرج القاعدة المطالبات.
        DB::transaction(function () use ($a, $event, $now): void {
            DB::table('partner_statement_reconciliation_events')->insert($event());
            DB::table('partner_statement_reconciliations')->where('id', $a)->update(['status' => 'voided', 'voided_at' => $now, 'voided_by' => $this->voiderId, 'void_reason' => 'سبب']);
        });
        $this->assertSame(['voided', 0, 1], [$this->reconciliation($a)->status, $this->activeClaims($a), $this->allClaims($a)]);

        // بعد الإبطال: لا تعديل ولا تراجع ولا إعادة إغلاق ولا تعديل للمطالبة المُفرَج عنها ولا إعادة تنشيطها ولا حذف.
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliations')->where('id', $a)->update(['void_reason' => 'تعديل']), 'تعديل سبب الإبطال');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliations')->where('id', $a)->update(['status' => 'closed']), 'voided → closed');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliations')->where('id', $a)->update(['status' => 'draft']), 'voided → draft');
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->where('reconciliation_id', $a)->update(['released_at' => null]), 'إعادة تنشيط');
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->where('reconciliation_id', $a)->update(['released_at' => '2000-01-01 00:00:00']), 'تعديل وقت الإفراج');
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->where('reconciliation_id', $a)->delete(), 'حذف مطالبة مُفرَج عنها');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->where('reconciliation_id', $a)->where('action', 'void')->update(['reason' => 'غيّرت']), 'تعديل حدث');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->where('reconciliation_id', $a)->where('action', 'void')->delete(), 'حذف حدث');

        // مطالبة جديدة تُدرَج مُفرَجاً عنها مسبقاً ⇒ مرفوضة (لا تحايل على الفريد الجزئي).
        $claim = (array) DB::table('partner_statement_unit_claims')->where('reconciliation_id', $a)->first();
        $this->assertRejected(fn () => DB::table('partner_statement_unit_claims')->insert(['id' => (string) Str::uuid(), 'released_at' => $now] + $claim), 'إدراج مطالبة مُفرَجاً عنها');
    }

    /** @test */
    public function a_new_reconciliation_cannot_be_inserted_directly_as_voided_or_superseded(): void
    {
        $row = (array) DB::table('partner_statement_reconciliations')->where('id', $this->statement([['date' => '2026-09-01', 'credit' => 1000]]))->first();
        foreach (['voided', 'superseded'] as $status) {
            $this->assertRejected(fn () => DB::table('partner_statement_reconciliations')->insert(['id' => (string) Str::uuid(), 'status' => $status, 'period_from' => '2026-01-01', 'period_to' => '2026-01-31'] + $row), "إدراج {$status}");
        }
    }

    // ═══════════════════════════════ فصل المهام القابل للإعداد (D-PS-20) ═══════════════════════════════

    /** يضبط (أو يمسح بـnull) سياسة المستأجر مباشرةً على الصف — لا مسار كتابة للمستخدمين في هذه الشريحة. */
    private function policy(mixed $value, ?string $tenantId = null, bool $absent = false): void
    {
        $tenant = Tenant::query()->findOrFail($tenantId ?? $this->auth['tenant_id']);
        $settings = $tenant->settings ?? [];
        if ($absent) {
            unset($settings['partner_statements']);
        } else {
            $settings['partner_statements'] = ['void_separation' => $value];
        }
        $tenant->update(['settings' => $settings]);
    }

    private function voidEvent(string $id): ?array
    {
        $row = DB::table('partner_statement_reconciliation_events')->where('reconciliation_id', $id)->whereIn('action', ['void', 'supersede'])->orderByDesc('seq')->first();

        return $row === null ? null : ['summary' => json_decode((string) $row->summary, true), 'created_by' => $row->created_by, 'action' => $row->action];
    }

    /** @test */
    public function strict_is_the_default_the_closer_cannot_void_their_own_final_and_the_policy_is_recorded_in_the_audit_log(): void
    {
        // مستأجر بلا أي إعداد (كالمستأجرين القائمين) ⇒ strict.
        $this->assertNull(Tenant::query()->findOrFail($this->auth['tenant_id'])->settings['partner_statements'] ?? null);
        [$id] = $this->finalized('2026-09-01', 100000, $this->retirer);   // المُغلِق يملك صلاحية الإبطال ومع ذلك يُمنع

        $this->assertSame(['available' => false, 'blocked_reason' => 'separation_required', 'separation_policy' => 'strict'], $this->lcStatus($this->retirer, $id)->assertOk()->json('data.void'));
        $denied = $this->void($this->retirer, $id)->assertStatus(403);
        $this->assertSame(['void_separation_required', 'strict'], [$denied->json('reason'), $denied->json('details.policy')]);
        $this->assertSame(['closed', 1, ['mark_reviewed', 'close']], [$this->reconciliation($id)->status, $this->activeClaims($id), $this->actions($id)], 'لا حدث ولا إفراج.');

        // غير المُغلِق يُبطل، والسياسة الفعّالة وقت العملية مسجَّلة بالحدث.
        $this->void($this->voider, $id)->assertCreated();
        $event = $this->voidEvent($id);
        $this->assertSame(['strict', $this->voiderId, 'void'], [$event['summary']['void_separation'], $event['created_by'], $event['action']]);
        // إعادة طلب المُغلِق نفسه بعد الإبطال ترفض أيضاً (لا تُسرِّب حالة ولا تتجاوز الفصل بإعادة الطلب).
        $this->void($this->retirer, $id)->assertStatus(403);
        $this->assertTrue($this->void($this->voider, $id)->assertOk()->json('replayed'));
    }

    /** @test */
    public function any_unknown_or_malformed_stored_policy_fails_closed_to_strict(): void
    {
        [$id] = $this->finalized('2026-09-01', 10000, $this->retirer);
        foreach (['FLEXIBLE', 'loose', '', ' flexible', 1, true, ['flexible']] as $value) {
            $this->policy($value);
            $this->void($this->retirer, $id)->assertStatus(403);
            $this->assertSame('strict', $this->lcStatus($this->retirer, $id)->json('data.void.separation_policy'), json_encode($value));
            $this->assertSame('closed', $this->reconciliation($id)->status);
        }
        $this->policy(null, null, true);
    }

    /** @test */
    public function flexible_lets_the_closer_void_only_with_the_void_permission_and_records_the_policy(): void
    {
        $this->policy('flexible');
        [$mine] = $this->finalized('2026-09-01', 100000, $this->retirer);
        $this->assertSame(['available' => true, 'blocked_reason' => null, 'separation_policy' => 'flexible'], $this->lcStatus($this->retirer, $mine)->json('data.void'));
        $this->void($this->retirer, $mine)->assertCreated();
        $this->assertSame(['voided', $this->retirerId, 'flexible'], [$this->reconciliation($mine)->status, $this->reconciliation($mine)->voided_by, $this->voidEvent($mine)['summary']['void_separation']]);

        // لا منح تلقائي: مُغلِق بلا صلاحية الإبطال يبقى مرفوضاً حتى تحت flexible.
        [$other] = $this->finalized('2026-10-01', 50000, $this->closer, ['period_from' => '2026-10-01', 'period_to' => '2026-10-28']);
        $this->void($this->closer, $other)->assertStatus(403);
        $this->assertSame(['closed', 1], [$this->reconciliation($other)->status, $this->activeClaims($other)]);
    }

    /** @test */
    public function strict_separation_applies_to_every_original_in_a_replacement_and_a_refusal_rolls_everything_back(): void
    {
        $retirer2 = $this->role('ps-retirer2', ['partner_statements.view', 'partner_statements.close', 'partner_statements.void', 'partners.view'], 'retirer2@ps-a3e.test');
        $retirer2Id = (string) User::query()->where('email', 'retirer2@ps-a3e.test')->value('id');
        [$a, , $invoiceA] = $this->finalized('2026-09-01', 100000, $this->retirer);           // أغلقها retirer
        [$a2] = $this->finalized('2026-10-01', 50000, $this->closer, ['period_from' => '2026-10-01', 'period_to' => '2026-10-28']);   // أغلقها closer (بلا صلاحية إبطال)
        [$b, $runB] = $this->candidate($invoiceA);
        $before = [$this->reconciliation($a)->status, $this->reconciliation($a2)->status, $this->activeClaims($a), $this->activeClaims($a2), DB::table('partner_statement_reconciliation_events')->count()];

        // retirer أغلق أحد الأصلين ⇒ مرفوض، أياً كان ترتيب معالجة الأصلين، وتراجع كامل.
        $this->assertSame('void_separation_required', $this->replace($this->retirer, $b, $runB['id'], [$a, $a2])->assertStatus(403)->json('reason'));
        $this->assertSame($before, [$this->reconciliation($a)->status, $this->reconciliation($a2)->status, $this->activeClaims($a), $this->activeClaims($a2), DB::table('partner_statement_reconciliation_events')->count()]);
        $this->assertSame('reviewed', $this->reconciliation($b)->status);

        // مُنفِّذ ليس مُغلِق أيٍّ منهما ينجح، والسياسة مسجَّلة في كل supersede وفي إغلاق البديلة.
        $this->replace($retirer2, $b, $runB['id'], [$a, $a2])->assertCreated();
        foreach ([$a, $a2] as $orig) {
            $event = $this->voidEvent($orig);
            $this->assertSame(['supersede', $retirer2Id, 'strict'], [$event['action'], $event['created_by'], $event['summary']['void_separation']]);
        }
        $close = collect($this->events($retirer2, $b)->json('data'))->firstWhere('action', 'close');
        $this->assertSame('strict', $close['summary']['void_separation']);
    }

    /** @test */
    public function flexible_lets_the_closer_replace_their_own_final_with_the_policy_recorded(): void
    {
        [$a, , $invoice] = $this->finalized('2026-09-01', 100000, $this->retirer);
        [$b, $runB] = $this->candidate($invoice);
        $this->replace($this->retirer, $b, $runB['id'], [$a])->assertStatus(403);
        $this->policy('flexible');
        $this->replace($this->retirer, $b, $runB['id'], [$a])->assertCreated();
        $this->assertSame(['superseded', 'flexible'], [$this->reconciliation($a)->status, $this->voidEvent($a)['summary']['void_separation']]);
        $this->assertSame(1, $this->activeClaims($b));
    }

    /** @test */
    public function the_database_enforces_the_effective_policy_against_raw_sql_and_a_wrongly_recorded_policy(): void
    {
        [$a, $runA] = $this->finalized('2026-09-01', 100000, $this->retirer);
        $t = $this->auth['tenant_id'];
        $now = now()->format('Y-m-d H:i:s');
        $event = fn (string $by, ?string $policy, string $id = null): array => [
            'id' => (string) Str::uuid(), 'tenant_id' => $t, 'reconciliation_id' => $id ?? $a, 'seq' => 3, 'action' => 'void', 'from_status' => 'closed', 'to_status' => 'voided', 'run_id' => $runA['id'],
            'summary' => $policy === null ? '{}' : json_encode(['void_separation' => $policy]), 'reason' => 'سبب', 'created_by' => $by, 'claims_count' => 1, 'created_at' => $now,
        ];

        // strict: المُغلِق مرفوض حتى بسياسة مسجَّلة صحيحة؛ سياسة مسجَّلة ≠ الفعّالة أو غائبة مرفوضة.
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->insert($event($this->retirerId, 'strict')), 'المُغلِق تحت strict');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->insert($event($this->voiderId, 'flexible')), 'سياسة مسجَّلة flexible والفعّالة strict');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->insert($event($this->voiderId, null)), 'سياسة غائبة');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->insert($event($this->retirerId, 'flexible')), 'المُغلِق يزعم flexible');

        // مستأجر آخر بـflexible لا يؤثر على هذا المستأجر (المُشغّل يقرأ صف مستأجر الحدث نفسه).
        $other = $this->registerTenant('ps-other-pol', 'owner@ps-other-pol.test');
        $this->policy('flexible', $other['tenant_id']);
        app(TenantContext::class)->set($t);
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->insert($event($this->retirerId, 'flexible')), 'flexible لمستأجر آخر');
        $this->void($this->retirer, $a)->assertStatus(403);
        $this->assertSame(['closed', 1], [$this->reconciliation($a)->status, $this->activeClaims($a)]);

        // flexible لهذا المستأجر: السياسة المسجَّلة يجب أن تكون flexible؛ strict المسجَّلة ترفض، والمُغلِق يُقبل.
        $this->policy('flexible');
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliation_events')->insert($event($this->retirerId, 'strict')), 'سياسة مسجَّلة strict والفعّالة flexible');
        DB::transaction(function () use ($event, $a, $now): void {
            DB::table('partner_statement_reconciliation_events')->insert($event($this->retirerId, 'flexible'));
            DB::table('partner_statement_reconciliations')->where('id', $a)->update(['status' => 'voided', 'voided_at' => $now, 'voided_by' => $this->retirerId, 'void_reason' => 'سبب']);
        });
        $this->assertSame(['voided', 0], [$this->reconciliation($a)->status, $this->activeClaims($a)]);
    }

    /** @test */
    public function a_retirement_event_accepted_under_one_policy_cannot_complete_the_transition_under_another(): void
    {
        [$a, $runA] = $this->finalized('2026-09-01', 100000, $this->retirer);
        $t = $this->auth['tenant_id'];
        $now = now()->format('Y-m-d H:i:s');
        $event = fn (string $by, string $policy): array => [
            'id' => (string) Str::uuid(), 'tenant_id' => $t, 'reconciliation_id' => $a, 'seq' => 3, 'action' => 'void', 'from_status' => 'closed', 'to_status' => 'voided', 'run_id' => $runA['id'],
            'summary' => json_encode(['void_separation' => $policy]), 'reason' => 'سبب', 'created_by' => $by, 'claims_count' => 1, 'created_at' => $now,
        ];
        $retire = fn (string $by) => DB::table('partner_statement_reconciliations')->where('id', $a)->update(['status' => 'voided', 'voided_at' => $now, 'voided_by' => $by, 'void_reason' => 'سبب']);

        // (1) حدث المُغلِق قُبل تحت flexible وأُلزم (معاملة منفصلة)، ثم صارت السياسة strict ⇒ الانتقال مرفوض (إعادة التحقق عند الانتقال لا عند الحدث وحده).
        $this->policy('flexible');
        $eventId = $event($this->retirerId, 'flexible');
        DB::table('partner_statement_reconciliation_events')->insert($eventId);
        $this->policy('strict');
        $this->assertRejected(fn () => $retire($this->retirerId), 'انتقال المُغلِق بعد تحوّل السياسة إلى strict');
        $this->assertSame(['closed', 1], [$this->reconciliation($a)->status, $this->activeClaims($a)]);

        // (2) والعكس: الحدث مسجَّل strict لغير المُغلِق ثم صارت السياسة flexible ⇒ مرفوض أيضاً (السياسة المسجَّلة ≠ الفعّالة الآن).
        // الحدث الأول باقٍ (سجل لا يُحذف) فنفحص بحدث لاحق.
        $this->policy('strict');
        DB::table('partner_statement_reconciliation_events')->insert(['id' => (string) Str::uuid(), 'seq' => 4] + $event($this->voiderId, 'strict'));
        $this->policy('flexible');
        $this->assertRejected(fn () => $retire($this->voiderId), 'سياسة مسجَّلة strict والفعّالة الآن flexible');
        $this->assertSame(['closed', 1], [$this->reconciliation($a)->status, $this->activeClaims($a)]);

        // ضابط موجب: الحدث الأخير يطابق السياسة الفعّالة الآن وفاعل مسموح ⇒ ينجح.
        $this->policy('strict');
        $this->assertSame(1, DB::transaction(fn () => $retire($this->voiderId)));
        $this->assertSame(['voided', 0], [$this->reconciliation($a)->status, $this->activeClaims($a)]);
    }

    /** @test */
    public function a_branch_restricted_reader_never_sees_the_claim_count_of_an_organisation_final_superseded_by_a_branch_replacement(): void
    {
        $branch = Branch::create(['code' => 'R1', 'name' => 'فرع']);
        [$org] = $this->finalized('2026-09-01', 100000);                       // نهائي مؤسسة (مطالبة واحدة)
        $inBranch = $this->invoice('2026-09-03', 50000, $branch->id);
        [$b, $runB] = $this->ready([['date' => '2026-09-03', 'our' => $inBranch->number, 'credit' => 57500]], ['branch_id' => $branch->id]);
        $this->assertSame('branch', $runB['scope']['kind']);

        $this->replace($this->retirer, $b, $runB['id'], [$org])->assertCreated();   // المُنفِّذ غير مقيَّد: الاستبدال بين نطاقين مختلفين مسموح

        $unrestricted = collect($this->events($this->retirer, $b)->assertOk()->json('data'))->firstWhere('action', 'close');
        $this->assertSame([$org, 1], [$unrestricted['summary']['superseded'][0]['id'], $unrestricted['summary']['superseded'][0]['claims_released']]);

        $restricted = $this->role('ps-redact', ['partner_statements.view', 'partners.view'], 'redact@ps-a3e.test');
        User::query()->where('email', 'redact@ps-a3e.test')->firstOrFail()->branches()->sync([$branch->id]);
        $seen = collect($this->events($restricted, $b)->assertOk()->json('data'))->firstWhere('action', 'close');
        $this->assertNotNull($seen, 'تشغيلة البديلة (نطاق الفرع) مقروءة له.');
        $this->assertSame([$org, null], [$seen['summary']['superseded'][0]['id'], $seen['summary']['superseded'][0]['claims_released']], 'عدد مطالبات نهائي المؤسسة مخفي عنه.');
    }

    /** @test */
    public function the_policy_is_read_through_the_existing_settings_mechanism_and_has_no_user_write_path_yet(): void
    {
        $this->assertSame('strict', Settings::DEFAULTS['partner_statements']['void_separation']);
        $this->assertSame('strict', PartnerStatementVoidSeparation::effective());
        $this->policy('flexible');
        $this->assertSame('flexible', PartnerStatementVoidSeparation::effective());
        $this->policy('anything');
        $this->assertSame('strict', PartnerStatementVoidSeparation::effective());

        // لا متحكّم ولا مسار ولا طلب يكتب هذا الإعداد (الواجهة وقناة التغيير الآمنة المصرَّح بها = PS-A4).
        $files = array_merge(
            glob(base_path('app/Http/**/*.php')) ?: [], glob(base_path('app/Http/*/*/*.php')) ?: [], glob(base_path('app/Http/*/*.php')) ?: [], [base_path('routes/api.php')],
        );
        foreach (array_unique($files) as $file) {
            $this->assertStringNotContainsString('void_separation', (string) file_get_contents($file), $file);
            $this->assertDoesNotMatchRegularExpression("/Settings::put\(\s*['\"]partner_statements['\"]/", (string) file_get_contents($file), $file);
        }
        $writers = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app'), \FilesystemIterator::SKIP_DOTS)) as $f) {
            if ($f->getExtension() === 'php' && preg_match("/Settings::put\(\s*(['\"]partner_statements['\"]|PartnerStatementVoidSeparation::GROUP)/", (string) file_get_contents($f->getPathname())) === 1) {
                $writers[] = $f->getFilename();
            }
        }
        $this->assertSame([], $writers, 'لا كاتب للإعداد في التطبيق.');
    }

    // ═══════════════════════════════ الهجرة والحدود المعمارية ═══════════════════════════════

    /** @test */
    public function the_migration_refuses_rollback_with_retired_rows_and_is_reversible_when_empty(): void
    {
        $migration = require base_path('database/migrations/2027_01_03_010000_add_partner_statement_void_and_supersede.php');
        [$a] = $this->finalized();

        // لا إبطال بعد: يتراجع إلى حراس A3d (النهائي المغلق يبقى) ثم يصعد سليماً.
        $migration->down();
        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasColumn('partner_statement_reconciliations', 'voided_at'));
        $this->assertRejected(fn () => DB::table('partner_statement_reconciliations')->where('id', $a)->update(['status' => 'voided']), 'A3d لا يعرف voided');
        $migration->up();
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumn('partner_statement_reconciliation_events', 'related_reconciliation_id'));

        $this->void($this->voider, $a)->assertCreated();
        try {
            $migration->down();
            $this->fail('لا تراجع بنهائي مُبطَل');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('لا يُتراجع', $e->getMessage());
        }
        $this->assertSame('voided', $this->reconciliation($a)->status);
    }

    /** @test */
    public function the_retirement_path_never_touches_the_ledger_or_writes_claims_by_hand(): void
    {
        $retire = (string) file_get_contents(base_path('app/Services/PartnerStatementRetirementService.php'));
        foreach (['LedgerService', 'JournalEntry', 'JournalLine', 'journal_lines', 'journal_entries', 'account_balances', 'Zatca', 'InvoiceService'] as $needle) {
            $this->assertStringNotContainsString($needle, $retire, "خدمة الإبطال لا تمسّ {$needle}.");
        }
        // الإفراج تفعله القاعدة وحدها: لا كتابة/تحديث/حذف مطالبات من خدمات التطبيق.
        foreach (['PartnerStatementRetirementService', 'PartnerStatementLifecycleService'] as $svc) {
            $code = (string) file_get_contents(base_path("app/Services/{$svc}.php"));
            $this->assertDoesNotMatchRegularExpression('/PartnerStatementUnitClaim::query\(\)[^;]*->(update|delete|forceDelete)\(/', $code, $svc);
            $this->assertDoesNotMatchRegularExpression("/['\"]released_at['\"]\s*=>/", $code, "{$svc} لا يكتب released_at.");
        }
        // الإبطال لا يقرأ الدفتر فلا مِرساة؛ الاستبدال يمرّ بمسار الإغلاق الذي يقفلها.
        $life = (string) file_get_contents(base_path('app/Services/PartnerStatementLifecycleService.php'));
        $void = substr($life, (int) strpos($life, 'public function void('), (int) strpos($life, 'private function performClose(') - (int) strpos($life, 'public function void('));
        $this->assertStringNotContainsString('lockLedgerAnchor', $void);
        $this->assertStringContainsString('performClose($actor, $newId, $input, $replaces, $reason)', $life);
        // الاستبدال يسبق فحص التعارض والتداخل والمطابقة (وإلا حجبت مطالبات الأصل البديلة).
        $close = substr($life, (int) strpos($life, 'private function performClose('));
        $this->assertLessThan(strpos($close, 'overlappingFinals('), strpos($close, 'supersedeFinals('));
        $this->assertLessThan(strpos($close, 'claims->conflicts('), strpos($close, 'supersedeFinals('));
    }
}
