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
use App\Services\PartnerStatementReviewService;
use App\Services\TenantApplicationService;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * IMP-PARTNER-STATEMENTS PS-A3b — الربط اليدوي لزوج قيد أصل/عكس **مثبت بـ`reversal_of`** (`link_pair`): العضو يختاره المراجع ولا يُستنتج، الزوج الناقص أو غير المثبت يُرفض،
 * الاستعمال المزدوج لكل طرف، نتائج المحرّك (`reversed_in_books` / `missing_in_books`) لا تتغيّر، حداثة التشغيل، RBAC، بوابة القدرة، العزل، الفروع، سجل التدقيق،
 * قاعدة D-PS-16 (سبب دائم لقبول فرق مالي)، ولا أثر مالي. تشغيل: php artisan test --filter=PartnerStatementPairReviewApiTest
 */
class PartnerStatementPairReviewApiTest extends TestCase
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
        $this->auth = $this->registerTenant('ps-a3b', 'owner@ps-a3b.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->owner = User::query()->where('email', 'owner@ps-a3b.test')->firstOrFail();
        $this->both = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف الأزواج', 'is_active' => true]);
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

    private function reversalOf(JournalEntry $entry): JournalEntry
    {
        return JournalEntry::query()->where('reversal_of', $entry->id)->firstOrFail();
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

    private function pairs(string $token, string $id)
    {
        return $this->withToken($token)->getJson("/api/partner-statement-reconciliations/{$id}/reversed-pairs");
    }

    private function matchRows(string $token, string $id): array
    {
        return $this->withToken($token)->getJson("/api/partner-statement-reconciliations/{$id}/matches?per_page=50")->assertOk()->json('data');
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

    /**
     * فاتورة معكوسة داخل النافذة (زوج مثبت) وكشف يذكرها وإلغاءها. سطر ٢ = قيد الأصل (دائن الكشف = مدين عندنا +)، سطر ٣ = العكس (مدين الكشف = دائن عندنا −).
     *
     * @return array{0: Invoice, 1: string, 2: array<string, mixed>, 3: JournalEntry, 4: JournalEntry}
     */
    private function pairScenario(?string $branchId = null): array
    {
        $invoice = $this->invoice('2026-09-03', 100000, $branchId);
        $original = $this->entryOf($invoice);
        app(LedgerService::class)->reverse($original, '2026-09-06', 'إلغاء');
        $reversal = $this->reversalOf($original);
        $id = $this->statement([
            ['date' => '2026-09-03', 'our' => $invoice->number, 'credit' => 115000],
            ['date' => '2026-09-06', 'debit' => 115000],
        ]);

        return [$invoice, $id, $this->match($this->auth['token'], $id), $original, $reversal];
    }

    // ═══════════════════════════════ الدورة والإثبات ═══════════════════════════════

    /** @test */
    public function a_proven_pair_is_linked_member_by_member_and_the_engine_results_stay_exactly_as_they_were(): void
    {
        [$invoice, $id, $run, $original, $reversal] = $this->pairScenario();
        $token = $this->auth['token'];
        $unit = 'invoice#'.$invoice->id;

        $beforeRows = $this->matchRows($token, $id);
        $statementRows = array_column(array_filter($beforeRows, fn ($r) => $r['side'] === 'statement'), null, 'ordinal');
        $this->assertSame(['amount_difference', 'reversed_in_books'], [$statementRows[2]['outcome'], $statementRows[2]['explanation']['code']]);
        $this->assertSame('missing_in_books', $statementRows[3]['outcome']);
        $before = $this->counts();

        // الأزواج المثبتة تُعرض للمراجع بما يميّز الأصل عن العكس وصافي كل منهما.
        $listed = $this->pairs($token, $id)->assertOk()->json('data');
        $this->assertCount(1, $listed['pairs']);
        $pair = $listed['pairs'][0];
        $this->assertSame([$unit, 'neutralised', true, null], [$pair['unit_key'], $pair['state'], $pair['reviewable'], $pair['blocked_reason']]);
        $this->assertSame([$original->id, 115000, false], [$pair['original']['entry_id'], $pair['original']['net_minor'], $pair['original']['claimed']]);
        $this->assertSame([$reversal->id, -115000, false], [$pair['reversal']['entry_id'], $pair['reversal']['net_minor'], $pair['reversal']['claimed']]);

        // ربط سطر الفاتورة بالأصل وسطر الإلغاء بالعكس — كلٌّ قرار صريح بسبب.
        $first = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'link_pair', 'unit_keys' => [$unit], 'pair_member' => 'original', 'reason' => 'فاتورة ملغاة عندنا لاحقاً'])->assertCreated();
        $this->assertSame(['link_pair', 1, [$unit], 'amount_difference', 'reversed_in_books', 0], [
            $first->json('data.action'), $first->json('data.revision'), $first->json('data.unit_keys'), $first->json('data.engine_outcome'), $first->json('data.engine_code'), $first->json('data.difference_minor'),
        ]);
        $this->assertSame(['original', $original->id, $reversal->id], [$first->json('data.pair.member'), $first->json('data.pair.original_entry_id'), $first->json('data.pair.reversal_entry_id')]);

        $second = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 3), 'action' => 'link_pair', 'unit_keys' => [$unit], 'pair_member' => 'reversal', 'reason' => 'إلغاء الفاتورة'])->assertCreated();
        $this->assertSame(['missing_in_books', 0, -115000], [$second->json('data.engine_outcome'), $second->json('data.difference_minor'), $second->json('data.expected_net_minor')]);

        $after = $this->pairs($token, $id)->assertOk()->json('data.pairs.0');
        $this->assertSame([true, $this->lineId($id, 2), true, $this->lineId($id, 3)], [$after['original']['claimed'], $after['original']['line_id'], $after['reversal']['claimed'], $after['reversal']['line_id']]);

        // نتائج المحرّك الحتمي كما هي حرفياً، ولا أثر مالي، والقرارات في سجلها فقط.
        $this->assertEquals($beforeRows, $this->matchRows($token, $id), 'reversed_in_books وmissing_in_books تبقى كما هي.');
        $this->assertSame($before, $this->counts());
        $this->assertSame(2, $this->decisionCount());

        // السحب يحرّر الطرف ولا يمسّ الآخر.
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear'])->assertCreated();
        $this->assertSame([false, true], [$this->pairs($token, $id)->json('data.pairs.0.original.claimed'), $this->pairs($token, $id)->json('data.pairs.0.reversal.claimed')]);
    }

    /** @test */
    public function the_contract_never_infers_the_member_or_the_pair_and_rejects_malformed_requests(): void
    {
        [$invoice, $id, $run] = $this->pairScenario();
        $active = $this->invoice('2026-09-10', 20000);   // وحدة نشطة بمبلغ ورقم مختلفين
        $token = $this->auth['token'];
        $unit = 'invoice#'.$invoice->id;
        // الدفتر تغيّر بعد التشغيل ⇒ تشغيلة جديدة قبل أي قرار.
        $run = $this->match($token, $id);
        $base = ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'link_pair', 'unit_keys' => [$unit], 'pair_member' => 'original', 'reason' => 'سبب كاف'];

        $this->assertSame('pair_member_required', $this->decide($token, $id, array_diff_key($base, ['pair_member' => 1]))->assertStatus(422)->json('reason'));
        $this->decide($token, $id, ['pair_member' => 'both'] + $base)->assertStatus(422);
        $this->assertSame('reason_required', $this->decide($token, $id, array_diff_key($base, ['reason' => 1]))->assertStatus(422)->json('reason'));
        $this->assertSame('reason_required', $this->decide($token, $id, ['reason' => ' ab '] + $base)->assertStatus(422)->json('reason'));
        $this->assertSame('unit_keys_invalid', $this->decide($token, $id, ['unit_keys' => [$unit, 'x#1']] + $base)->assertStatus(422)->json('reason'));
        $this->assertSame('unit_keys_invalid', $this->decide($token, $id, array_diff_key($base, ['unit_keys' => 1]))->assertStatus(422)->json('reason'));
        $this->assertSame('pair_member_not_allowed', $this->decide($token, $id, ['action' => 'override'] + $base)->assertStatus(422)->json('reason'));
        $this->assertSame('pair_member_not_allowed', $this->decide($token, $id, ['action' => 'clear', 'unit_keys' => []] + $base)->assertStatus(422)->json('reason'));
        $this->decide($token, $id, $base + ['tenant_id' => 'x'])->assertStatus(422);

        // وحدة نشطة (حتى لو طابق مبلغها السطر) ليست زوجاً: لا ربط بالتشابه. ووحدة مجهولة.
        $this->assertSame('unit_not_a_reversed_pair', $this->decide($token, $id, ['unit_keys' => ['invoice#'.$active->id]] + $base)->assertStatus(422)->json('reason'));
        $this->assertSame('unit_not_in_ledger', $this->decide($token, $id, ['unit_keys' => ['invoice#00000000-0000-4000-8000-000000000000']] + $base)->assertStatus(422)->json('reason'));

        // الإجراءات العادية ما زالت ترفض الزوج المعكوس (لا استعمال كقيد نشط).
        $normal = $this->decide($token, $id, ['action' => 'override', 'unit_keys' => [$unit], 'reason' => 'سبب كاف', 'accept_difference' => true] + array_diff_key($base, ['pair_member' => 1]))->assertStatus(422);
        $this->assertSame(['unit_not_reviewable', 'neutralised'], [$normal->json('reason'), $normal->json('details.state')]);

        $this->assertSame(0, $this->decisionCount(), 'لا يُسجَّل شيء عند أي رفض.');
    }

    /** @test */
    public function an_incomplete_chain_is_refused_and_listed_as_not_reviewable_with_its_reason(): void
    {
        $invoice = $this->invoice('2026-09-04', 20000);
        app(LedgerService::class)->reverse($this->entryOf($invoice), '2026-12-20', 'إلغاء متأخر');   // العكس خارج نافذة الفترة ⇒ سلسلة ناقصة
        $id = $this->statement([['date' => '2026-09-04', 'our' => $invoice->number, 'credit' => 23000]]);
        $run = $this->match($this->auth['token'], $id);
        $token = $this->auth['token'];

        $r = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'link_pair', 'unit_keys' => ['invoice#'.$invoice->id], 'pair_member' => 'original', 'reason' => 'سبب كاف', 'accept_difference' => true])->assertStatus(422);
        $this->assertSame(['pair_incomplete', ['reversal_outside_window']], [$r->json('reason'), $r->json('details.reasons')]);

        $pair = $this->pairs($token, $id)->assertOk()->json('data.pairs.0');
        $this->assertSame(['incomplete', false, 'pair_incomplete'], [$pair['state'], $pair['reviewable'], $pair['blocked_reason']]);
        $this->assertArrayNotHasKey('original', $pair);
        $this->assertSame(0, $this->decisionCount());
    }

    /** @test */
    public function longer_or_unproven_chains_are_rejected_by_the_proof_itself(): void
    {
        $service = app(PartnerStatementReviewService::class);
        $prove = new \ReflectionMethod($service, 'provePair');
        $entry = fn (string $id, ?string $of, string $status, int $debit, int $credit): array => ['entry_id' => $id, 'number' => $id, 'date' => '2026-09-03', 'status' => $status, 'reversal_of' => $of, 'debit_minor' => $debit, 'credit_minor' => $credit];
        $unit = fn (array $entries, string $state = 'neutralised'): array => ['key' => 'invoice#x', 'state' => $state, 'reasons' => [], 'entries' => $entries];
        $reason = function (array $u) use ($prove, $service): string {
            try {
                $prove->invoke($service, $u);

                return 'proven';
            } catch (\App\Support\PartnerStatementReviewException $e) {
                return $e->reason;
            }
        };

        $good = [$entry('a', null, 'reversed', 100, 0), $entry('r', 'a', 'posted', 0, 100)];
        $this->assertSame('proven', $reason($unit($good)));
        $this->assertSame('pair_not_simple', $reason($unit([...$good, $entry('z', null, 'posted', 5, 0)])));
        $this->assertSame('pair_not_simple', $reason($unit([$entry('a', null, 'reversed', 100, 0)])));
        // قيدان بلا رابط عكس (مجرد مبلغين متعاكسين): لا إثبات.
        $this->assertSame('pair_not_proven', $reason($unit([$entry('a', null, 'posted', 100, 0), $entry('b', null, 'posted', 0, 100)])));
        // العكس يشير إلى قيد غير موجود، أو الأصل ليس reversed، أو العكس ليس posted، أو الصافيان لا يلغيان بعضهما.
        $this->assertSame('pair_not_proven', $reason($unit([$entry('a', null, 'reversed', 100, 0), $entry('r', 'other', 'posted', 0, 100)])));
        $this->assertSame('pair_not_proven', $reason($unit([$entry('a', null, 'posted', 100, 0), $entry('r', 'a', 'posted', 0, 100)])));
        $this->assertSame('pair_not_proven', $reason($unit([$entry('a', null, 'reversed', 100, 0), $entry('r', 'a', 'reversed', 0, 100)])));
        $this->assertSame('pair_not_proven', $reason($unit([$entry('a', null, 'reversed', 100, 0), $entry('r', 'a', 'posted', 0, 90)])));
        $this->assertSame('pair_not_proven', $reason($unit([$entry('a', null, 'reversed', 0, 0), $entry('r', 'a', 'posted', 0, 0)])));
        $this->assertSame('pair_incomplete', $reason($unit($good, 'incomplete')));
        $this->assertSame('unit_not_a_reversed_pair', $reason($unit($good, 'active')));
    }

    // ═══════════════════════════════ الاستعمال المزدوج وإعادة الطلب ═══════════════════════════════

    /** @test */
    public function each_member_of_the_pair_is_held_by_one_line_at_most_and_replays_are_safe(): void
    {
        $invoice = $this->invoice('2026-09-03', 100000);
        app(LedgerService::class)->reverse($this->entryOf($invoice), '2026-09-06', 'إلغاء');
        $id = $this->statement([
            ['date' => '2026-09-03', 'our' => $invoice->number, 'credit' => 115000],   // ٢
            ['date' => '2026-09-04', 'credit' => 115000],                              // ٣ (تكرار في الكشف)
            ['date' => '2026-09-06', 'debit' => 115000],                               // ٤
        ]);
        $run = $this->match($this->auth['token'], $id);
        $token = $this->auth['token'];
        $unit = 'invoice#'.$invoice->id;
        $link = fn (int $ordinal, string $member, string $reason = 'سبب كاف') => $this->decide($token, $id, [
            'run_id' => $run['id'], 'line_id' => $this->lineId($id, $ordinal), 'action' => 'link_pair', 'unit_keys' => [$unit], 'pair_member' => $member, 'reason' => $reason,
            'accept_difference' => true,   // الاتجاهان يُقارَنان بصافي الطرف؛ الإقرار صريح حيث لا يطابق السطر الطرف
        ]);

        $link(2, 'original')->assertCreated();
        $clash = $link(3, 'original')->assertStatus(409);
        $this->assertSame(['unit_already_decided', $unit.'@original', $this->lineId($id, 2)], [$clash->json('reason'), $clash->json('details.unit_key'), $clash->json('details.line_id')]);
        $link(4, 'reversal')->assertCreated();   // الطرف الآخر حرّ

        // إعادة الطلب نفسه ⇒ replay بلا نسخة جديدة؛ سبب مختلف ⇒ نسخة جديدة.
        $this->assertTrue($link(2, 'original')->assertOk()->json('replayed'));
        $this->assertSame(2, $link(2, 'original', 'سبب آخر')->assertCreated()->json('data.revision'));

        // تغيير عضو السطر نفسه يحرّر الأول ويحجز الثاني (محجوز للسطر ٤ ⇒ رفض).
        // نفس السبب تماماً (كي لا يُميَّز الطلب بالسبب): تغيّر العضو وحده يجب ألا يُعامل إعادةً للقرار الفعّال.
        $this->assertSame('unit_already_decided', $link(2, 'reversal', 'سبب آخر')->assertStatus(409)->json('reason'));
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 4), 'action' => 'clear'])->assertCreated();
        $moved = $link(2, 'reversal')->assertCreated();
        $this->assertSame(['reversal', 3], [$moved->json('data.pair.member'), $moved->json('data.revision')]);
        $link(3, 'original')->assertCreated();   // الأصل صار حراً بعد انتقال السطر ٢

        // لا تعارض مع الوحدة العادية: قرار عادي على وحدة نشطة لا يمسّ رموز الزوج.
        $this->assertSame(6, $this->decisionCount());
    }

    /**
     * Codex #1929 P2: فاتورة سبق تأكيدها/إسنادها لسطر (ادعاء الوحدة العادي) ثم عُكست؛ ربط الأصل لسطر آخر يجب ألا يمرّ — الوحدة محجوزة بقرار فعّال حتى يُسحب. وتعرضه
     * `reversed-pairs` محجوزاً لا حراً.
     *
     * @test
     */
    public function an_ordinary_claim_made_before_the_reversal_still_blocks_linking_the_same_original_to_another_line(): void
    {
        $invoice = $this->invoice('2026-09-03', 100000);
        $unit = 'invoice#'.$invoice->id;
        $id = $this->statement([
            ['date' => '2026-09-03', 'our' => $invoice->number, 'credit' => 115000],   // ٢ ⇒ matched R1
            ['date' => '2026-09-06', 'credit' => 115000],                              // ٣
        ]);
        $token = $this->auth['token'];
        $early = $this->match($token, $id);
        $this->decide($token, $id, ['run_id' => $early['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'confirm'])->assertCreated();

        app(LedgerService::class)->reverse($this->entryOf($invoice), '2026-09-06', 'إلغاء بعد المراجعة');
        $run = $this->match($token, $id);   // الدفتر تغيّر ⇒ تشغيلة جديدة، والوحدة صارت زوجاً معكوساً
        $link = fn (int $ordinal, string $member) => $this->decide($token, $id, [
            'run_id' => $run['id'], 'line_id' => $this->lineId($id, $ordinal), 'action' => 'link_pair', 'unit_keys' => [$unit], 'pair_member' => $member, 'reason' => 'سبب كاف', 'accept_difference' => true,
        ]);

        $shown = $this->pairs($token, $id)->assertOk()->json('data.pairs.0');
        $this->assertSame([true, true, $this->lineId($id, 2)], [$shown['original']['claimed'], $shown['reversal']['claimed'], $shown['original']['line_id']]);
        $clash = $link(3, 'original')->assertStatus(409);
        $this->assertSame(['unit_already_decided', $this->lineId($id, 2)], [$clash->json('reason'), $clash->json('details.line_id')]);
        $this->assertSame('unit_already_decided', $link(3, 'reversal')->assertStatus(409)->json('reason'));
        $this->assertSame(1, $this->decisionCount());

        // بعد سحب القرار القديم تتحرر الوحدة بطرفيها ويصحّ الربط.
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'clear'])->assertCreated();
        $this->assertFalse($this->pairs($token, $id)->json('data.pairs.0.original.claimed'));
        $link(3, 'original')->assertCreated();
        $this->assertTrue($this->pairs($token, $id)->json('data.pairs.0.original.claimed'));
        $this->assertFalse($this->pairs($token, $id)->json('data.pairs.0.reversal.claimed'));
    }

    // ═══════════════════════════════ حداثة التشغيل ═══════════════════════════════

    /** @test */
    public function a_stale_run_cannot_link_a_pair(): void
    {
        [$invoice, $id, $run] = $this->pairScenario();
        $token = $this->auth['token'];
        $payload = ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'link_pair', 'unit_keys' => ['invoice#'.$invoice->id], 'pair_member' => 'original', 'reason' => 'سبب كاف'];

        $this->invoice('2026-09-20', 1000);   // دفتر تغيّر بعد التشغيل
        $stale = $this->decide($token, $id, $payload)->assertStatus(409);
        $this->assertSame(['run_stale', ['ledger_fingerprint']], [$stale->json('reason'), $stale->json('details.causes')]);
        $this->assertSame(0, $this->decisionCount());

        $fresh = $this->match($token, $id);
        $this->decide($token, $id, ['run_id' => $fresh['id']] + $payload)->assertCreated();
        $this->assertSame('run_stale', $this->decide($token, $id, $payload)->assertStatus(409)->json('reason'));
    }

    // ═══════════════════════════════ D-PS-16 ═══════════════════════════════

    /** @test */
    public function accepting_any_financial_difference_always_requires_a_reason_even_inside_the_tolerance(): void
    {
        $this->invoice('2026-09-02', 100000);   // 1150.00
        $id = $this->statement([['date' => '2026-09-02', 'credit' => 115050]], ['amount_tolerance_minor' => 100]);   // فرق ٠٫٥٠ داخل التسامح
        $run = $this->match($this->auth['token'], $id);
        $token = $this->auth['token'];
        $line = $this->lineId($id, 2);

        $row = collect($this->matchRows($token, $id))->firstWhere('side', 'statement');
        $this->assertSame(['matched', 50], [$row['outcome'], $row['difference_minor']]);

        $this->assertSame('reason_required', $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line, 'action' => 'confirm'])->assertStatus(422)->json('reason'));
        $this->assertSame(0, $this->decisionCount());
        $ok = $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line, 'action' => 'confirm', 'reason' => 'فرق تقريب متفق عليه'])->assertCreated();
        $this->assertSame([50, false, 'فرق تقريب متفق عليه'], [$ok->json('data.difference_minor'), $ok->json('data.accepted_difference'), $ok->json('data.reason')]);

        // ولا يوجد إعداد مستأجر يعطّلها: المسار لا يقبل أي معامل سياسة.
        $this->decide($token, $id, ['run_id' => $run['id'], 'line_id' => $line, 'action' => 'confirm', 'reason_required' => false])->assertStatus(422);
    }

    // ═══════════════════════════════ RBAC وبوابة القدرة والعزل والفروع ═══════════════════════════════

    /** @test */
    public function permissions_gate_and_tenant_isolation_apply_to_pair_review(): void
    {
        [$invoice, $id, $run] = $this->pairScenario();
        $payload = ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'link_pair', 'unit_keys' => ['invoice#'.$invoice->id], 'pair_member' => 'original', 'reason' => 'سبب كاف'];

        $viewer = $this->role('ps-pv', ['partner_statements.view', 'partners.view'], 'pv@ps-a3b.test');
        $this->pairs($viewer, $id)->assertOk();
        $this->decide($viewer, $id, $payload)->assertForbidden();

        $reconcileOnly = $this->role('ps-pr', ['partner_statements.reconcile', 'partners.view'], 'pr@ps-a3b.test');
        $this->decide($reconcileOnly, $id, $payload)->assertForbidden();
        $this->pairs($reconcileOnly, $id)->assertForbidden();

        $noPartners = $this->role('ps-pn', ['partner_statements.view', 'partner_statements.reconcile'], 'pn@ps-a3b.test');
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->pairs($noPartners, $id)->assertStatus(422)->json('message'));
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->decide($noPartners, $id, $payload)->assertStatus(422)->json('message'));

        $none = $this->role('ps-p0', ['reports.view'], 'p0@ps-a3b.test');
        $this->pairs($none, $id)->assertForbidden();
        $this->decide($none, $id, $payload)->assertForbidden();

        // مستأجر آخر: الرفض الموحَّد لكلا المسارين.
        $other = $this->registerTenant('ps-a3b-other', 'owner@other-a3b.test');
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->pairs($other['token'], $id)->assertStatus(422)->json('message'));
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->decide($other['token'], $id, $payload)->assertStatus(422)->json('message'));
        $this->assertSame(0, $this->decisionCount());

        // بوابة القدرة: التعليق يسمح بالقراءة ويمنع الربط؛ ومستأجر لم يفعّلها: ٤٠٣.
        $this->assertSame('suspended', app(TenantApplicationService::class)->disable('accounting.partner_statements', null)->status);
        $this->pairs($this->auth['token'], $id)->assertOk();
        $this->decide($this->auth['token'], $id, $payload)->assertForbidden();
        $off = $this->registerTenant('ps-a3b-off', 'owner@off-a3b.test', autoEnableApplications: false);
        $uuid = '00000000-0000-4000-8000-000000000000';
        $this->pairs($off['token'], $uuid)->assertForbidden();
        $this->decide($off['token'], $uuid, ['run_id' => $uuid, 'line_id' => $uuid, 'action' => 'clear'])->assertForbidden();
    }

    /** @test */
    public function a_branch_restricted_reviewer_sees_and_links_only_pairs_inside_their_branches(): void
    {
        $inside = Branch::create(['code' => 'IN', 'name' => 'فرع داخل']);
        $outside = Branch::create(['code' => 'OUT', 'name' => 'فرع خارج']);
        $mine = $this->invoice('2026-09-03', 100000, $inside->id);
        $foreign = $this->invoice('2026-09-04', 50000, $outside->id);
        $ledger = app(LedgerService::class);
        $ledger->reverse($this->entryOf($mine), '2026-09-06', 'إلغاء');
        $ledger->reverse($this->entryOf($foreign), '2026-09-07', 'إلغاء');
        $token = $this->role('ps-pb', ['partner_statements.view', 'partner_statements.reconcile', 'partners.view'], 'pb@ps-a3b.test');
        User::query()->where('email', 'pb@ps-a3b.test')->firstOrFail()->branches()->sync([$inside->id]);

        $id = $this->statement([['date' => '2026-09-03', 'credit' => 115000], ['date' => '2026-09-04', 'credit' => 57500]]);
        $orgRun = $this->match($this->auth['token'], $id);
        $own = $this->match($token, $id);

        // غير المقيَّد يرى الزوجين؛ المقيَّد زوجه فقط.
        $this->assertCount(2, $this->pairs($this->auth['token'], $id)->assertOk()->json('data.pairs'));
        $restricted = $this->pairs($token, $id)->assertOk();
        $this->assertSame(['invoice#'.$mine->id], array_column($restricted->json('data.pairs'), 'unit_key'));
        $this->assertStringNotContainsString($foreign->id, (string) $restricted->getContent());

        // ربط زوج الفرع الآخر مرفوض له (ليس في دفتره)، وعلى تشغيلة المؤسسة (الرفض الموحَّد).
        $attempt = fn (string $runId, Invoice $invoice, int $ordinal) => $this->decide($token, $id, [
            'run_id' => $runId, 'line_id' => $this->lineId($id, $ordinal), 'action' => 'link_pair', 'unit_keys' => ['invoice#'.$invoice->id], 'pair_member' => 'original', 'reason' => 'سبب كاف',
        ]);
        $this->assertSame('unit_not_in_ledger', $attempt($own['id'], $foreign, 3)->assertStatus(422)->json('reason'));
        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $attempt($orgRun['id'], $mine, 2)->assertStatus(422)->json('message'));

        // قرار غير المقيَّد على تشغيلة المؤسسة يحجز الطرف: يظهر له محجوزاً بلا هوية السطر، ولا يستطيع حجزه.
        $this->decide($this->auth['token'], $id, ['run_id' => $orgRun['id'], 'line_id' => $this->lineId($id, 3), 'action' => 'link_pair', 'unit_keys' => ['invoice#'.$mine->id], 'pair_member' => 'original', 'reason' => 'سبب كاف', 'accept_difference' => true])->assertCreated();
        $seen = $this->pairs($token, $id)->assertOk()->json('data.pairs.0.original');
        $this->assertSame([true, null], [$seen['claimed'], $seen['line_id']]);
        $clash = $attempt($own['id'], $mine, 2)->assertStatus(409);
        $this->assertSame(['unit_already_decided', 'invoice#'.$mine->id.'@original'], [$clash->json('reason'), $clash->json('details.unit_key')]);
    }

    // ═══════════════════════════════ سجل لا يتغيّر وحراس القاعدة ═══════════════════════════════

    /** @test */
    public function the_database_guards_the_link_pair_shape_and_the_migration_is_reversible_only_without_pair_links(): void
    {
        [$invoice, $id, $run] = $this->pairScenario();
        $this->decide($this->auth['token'], $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'link_pair', 'unit_keys' => ['invoice#'.$invoice->id], 'pair_member' => 'original', 'reason' => 'سبب كاف'])->assertCreated();
        $row = (array) DB::table('partner_statement_review_decisions')->first();
        $make = fn (array $over): array => $over + ['id' => (string) Str::uuid(), 'revision' => 2] + $row;
        $rejects = function (array $over, string $why) use ($make): void {
            try {
                DB::transaction(fn () => DB::table('partner_statement_review_decisions')->insert($make($over)));
                $this->fail($why);
            } catch (QueryException) {
                $this->addToAssertionCount(1);
            }
        };

        $rejects(['pair_member' => null], 'link_pair بلا عضو');
        $rejects(['pair_member' => 'both'], 'عضو غير صالح');
        $rejects(['pair_reversal_entry_id' => $row['pair_original_entry_id']], 'قيدان متطابقان');
        $rejects(['pair_original_entry_id' => null], 'قيد أصل غائب');
        $rejects(['unit_keys' => '["a","b"]'], 'وحدتان لـlink_pair');
        $rejects(['reason' => null], 'link_pair بلا سبب');
        $rejects(['action' => 'override'], 'override يحمل أعمدة الزوج');
        $rejects(['action' => 'confirm', 'reason' => null], 'confirm يحمل أعمدة الزوج');
        $rejects(['action' => 'invented'], 'إجراء غير معروف');
        $this->assertSame(1, $this->decisionCount());

        // التراجع يرفض ما دام فيه link_pair (سجل تدقيق).
        $migration = require base_path('database/migrations/2026_12_29_010000_add_pair_link_to_partner_statement_review_decisions.php');
        try {
            $migration->down();
            $this->fail('down() يجب أن يرفض');
        } catch (\RuntimeException) {
            $this->addToAssertionCount(1);
        }
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumn('partner_statement_review_decisions', 'pair_member'));
    }

    /** @test */
    public function the_migration_rolls_back_and_forward_cleanly_when_no_pair_link_exists(): void
    {
        $migration = require base_path('database/migrations/2026_12_29_010000_add_pair_link_to_partner_statement_review_decisions.php');
        $migration->down();
        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasColumn('partner_statement_review_decisions', 'pair_member'));
        $migration->up();
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumn('partner_statement_review_decisions', 'engine_code'));

        // بعد إعادة الصعود يعمل الربط كاملاً.
        [$invoice, $id, $run] = $this->pairScenario();
        $this->decide($this->auth['token'], $id, ['run_id' => $run['id'], 'line_id' => $this->lineId($id, 2), 'action' => 'link_pair', 'unit_keys' => ['invoice#'.$invoice->id], 'pair_member' => 'original', 'reason' => 'سبب كاف'])->assertCreated();
        $this->assertSame(1, $this->decisionCount());
    }
}
