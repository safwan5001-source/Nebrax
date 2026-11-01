<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Role;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Reporting\PartnerLedgerCandidates;
use App\Services\Reporting\ReportService;
use App\Services\PartnerStatementImportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * IMP-PARTNER-STATEMENTS PS-A2b — مصدر مرشّحي المطابقة (`PartnerLedgerCandidates`) + مفاتيح D-PS-10 الإضافية على صفوف الكشف.
 * تشغيل: php artisan test --filter=PartnerLedgerCandidatesTest
 */
class PartnerLedgerCandidatesTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private array $auth;

    private User $owner;

    private Partner $both;

    private PartnerLedgerCandidates $candidates;

    protected function setUp(): void
    {
        parent::setUp();
        $this->auth = $this->registerTenant('ps-a2b', 'owner@ps-a2b.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->owner = User::query()->where('email', 'owner@ps-a2b.test')->firstOrFail();
        $this->both = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف مزدوج', 'is_active' => true]);
        $this->candidates = app(PartnerLedgerCandidates::class);
        $this->actingAs($this->owner);
    }

    // ═══════════════════════════════ أدوات ═══════════════════════════════

    private function invoice(string $date, int $unitPrice, ?string $branchId = null, ?Partner $partner = null): Invoice
    {
        $invoices = app(InvoiceService::class);
        $data = ['partner_id' => ($partner ?? $this->both)->id, 'payment_type' => 'credit', 'invoice_date' => $date];
        $context = app(\App\Tenancy\BranchContext::class);
        // سطور الدفتر تُوسَم بالفرع النشط وقت الترحيل (كما في أي طلب HTTP) — نحاكيه صراحةً.
        $branchId !== null ? $context->set($branchId) : $context->forget();
        try {
            return $invoices->post($invoices->create($data, [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]]));
        } finally {
            $context->forget();
        }
    }

    private function entryOf(Invoice $invoice): JournalEntry
    {
        return JournalEntry::query()->where('source_type', Invoice::class)->where('source_id', $invoice->id)->firstOrFail();
    }

    private function opts(array $over = []): array
    {
        return $over + ['partner_id' => $this->both->id, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30'];
    }

    /** @return array<string, array<string, mixed>> الوحدات بمفتاح مستندها */
    private function units(array $result): array
    {
        $by = [];
        foreach ($result['units'] as $unit) {
            $by[$unit['key']] = $unit;
        }

        return $by;
    }

    private function thrown(callable $fn): \Throwable
    {
        try {
            $fn();
        } catch (\Throwable $e) {
            return $e;
        }
        $this->fail('كان يجب أن يرمي.');
    }

    // ═══════════════════════════════ مفاتيح D-PS-10 ═══════════════════════════════

    /** @test */
    public function statement_rows_carry_entry_id_status_and_reversal_link_additively(): void
    {
        $invoice = $this->invoice('2026-09-01', 100000);
        $reversal = app(LedgerService::class)->reverse($this->entryOf($invoice), '2026-09-10', 'إلغاء');

        $rows = app(ReportService::class)->partnerStatement($this->both->id)['rows'];

        $this->assertCount(2, $rows);
        $this->assertSame([$this->entryOf($invoice)->id, 'reversed', null], [$rows[0]['entry_id'], $rows[0]['entry_status'], $rows[0]['reversal_of']]);
        $this->assertSame([$reversal->id, 'posted', $this->entryOf($invoice)->id], [$rows[1]['entry_id'], $rows[1]['entry_status'], $rows[1]['reversal_of']]);
    }

    /** @test */
    public function the_http_report_response_is_unchanged_because_it_whitelists_its_keys(): void
    {
        $this->invoice('2026-09-01', 100000);

        $row = $this->withToken($this->auth['token'])->getJson("/api/reports/partner-statement/{$this->both->id}")->assertOk()->json('rows.0');

        $this->assertSame(['date', 'number', 'description', 'debit', 'credit', 'balance', 'source'], array_keys($row));
    }

    // ═══════════════════════════════ المرشحون ═══════════════════════════════

    /** @test */
    public function candidates_are_document_units_from_the_statement_source_with_a_stable_fingerprint(): void
    {
        $invoice = $this->invoice('2026-09-01', 100000);
        $this->invoice('2026-09-12', 20000);

        $result = $this->candidates->for($this->owner, $this->opts());

        $this->assertSame(['organization', null], [$result['scope']['kind'], $result['scope']['branch_ids']]);
        $this->assertSame(['2026-08-29', '2026-10-03'], [$result['window']['from'], $result['window']['to']]);
        $this->assertCount(2, $result['units']);
        $unit = $this->units($result)['invoice#'.$invoice->id];
        $this->assertSame(['invoice', 'active', true, true, 'debit', 115000, 0, '2026-09-01'], [$unit['kind'], $unit['state'], $unit['matchable'], $unit['in_period'], $unit['direction'], $unit['debit_minor'], $unit['credit_minor'], $unit['date']]);
        $this->assertSame(['units' => 2, 'matchable' => 2, 'neutralised' => 0, 'incomplete' => 0, 'matchable_debit_minor' => 138000, 'matchable_credit_minor' => 0, 'rows_net_minor' => 138000], $result['totals']);
        $this->assertSame($result['fingerprint'], $this->candidates->for($this->owner, $this->opts())['fingerprint']);

        $this->invoice('2026-09-20', 5000);
        $this->assertNotSame($result['fingerprint'], $this->candidates->for($this->owner, $this->opts())['fingerprint'], 'تغيّر الدفتر يغيّر البصمة.');
    }

    /** @test */
    public function the_tolerance_window_widens_the_search_and_flags_out_of_period_units(): void
    {
        $this->invoice('2026-08-30', 10000);   // خارج الفترة بيومين ⇒ داخل النافذة
        $this->invoice('2026-08-20', 10000);   // بعيد ⇒ خارج النافذة
        $this->invoice('2026-10-02', 10000);

        $result = $this->candidates->for($this->owner, $this->opts(['date_tolerance_days' => 3]));
        $this->assertSame([['2026-08-30', false], ['2026-10-02', false]], array_map(fn (array $u): array => [$u['date'], $u['in_period']], $result['units']));

        $this->assertCount(0, $this->candidates->for($this->owner, $this->opts(['date_tolerance_days' => 0]))['units']);
    }

    /** @test */
    public function the_role_splits_a_both_partner_so_the_other_side_never_leaks(): void
    {
        $this->invoice('2026-09-01', 100000);

        $this->assertCount(1, $this->candidates->for($this->owner, $this->opts())['units']);
        $this->assertCount(0, $this->candidates->for($this->owner, $this->opts(['role' => 'supplier']))['units']);
    }

    // ═══════════════════════════════ القيود المعكوسة ═══════════════════════════════

    /** @test */
    public function a_fully_reversed_document_is_neutralised_and_never_counted_twice(): void
    {
        $reversed = $this->invoice('2026-09-01', 100000);
        $kept = $this->invoice('2026-09-05', 20000);
        app(LedgerService::class)->reverse($this->entryOf($reversed), '2026-09-10', 'إلغاء');

        $result = $this->candidates->for($this->owner, $this->opts());
        $units = $this->units($result);

        $this->assertCount(2, $units);
        $pair = $units['invoice#'.$reversed->id];
        $this->assertSame(['neutralised', false, 0, 2], [$pair['state'], $pair['matchable'], $pair['net_minor'], count($pair['entry_ids'])]);
        $this->assertSame(['active', true], [$units['invoice#'.$kept->id]['state'], $units['invoice#'.$kept->id]['matchable']]);
        $this->assertSame(23000, $result['totals']['matchable_debit_minor'], 'الزوج المتعادل لا يدخل مجاميع المرشحين.');
        $this->assertSame(23000, $result['totals']['rows_net_minor'], 'صافي الوحدات = صافي الكشف (لا مضاعفة).');
        $this->assertSame(1, $result['totals']['neutralised']);
    }

    /** @test */
    public function a_reversal_pair_cut_by_the_window_is_incomplete_not_matchable_and_says_why(): void
    {
        $original = $this->invoice('2026-09-01', 100000);
        app(LedgerService::class)->reverse($this->entryOf($original), '2026-12-15', 'إلغاء متأخر');

        // النافذة تنتهي قبل العكس: الأصل ظاهر وعكسه خارجها.
        $first = $this->units($this->candidates->for($this->owner, $this->opts()))['invoice#'.$original->id];
        $this->assertSame(['incomplete', false, ['reversal_outside_window']], [$first['state'], $first['matchable'], $first['reasons']]);

        // النافذة تبدأ بعد الأصل: العكس ظاهر وأصله خارجها.
        $second = $this->candidates->for($this->owner, $this->opts(['period_from' => '2026-12-01', 'period_to' => '2026-12-31']));
        $this->assertCount(1, $second['units']);
        $this->assertSame(['incomplete', false, ['reversal_original_outside_window']], [$second['units'][0]['state'], $second['units'][0]['matchable'], $second['units'][0]['reasons']]);
        $this->assertSame(0, $second['totals']['matchable'], 'عاكس بلا أصل ظاهر لا يُطابَق.');
    }

    /** @test */
    public function a_reinstated_document_reversed_then_reversed_again_is_active_once(): void
    {
        $invoice = $this->invoice('2026-09-01', 100000);
        $ledger = app(LedgerService::class);
        $first = $ledger->reverse($this->entryOf($invoice), '2026-09-10', 'إلغاء');
        $ledger->reverse($first, '2026-09-15', 'إعادة تفعيل');

        $result = $this->candidates->for($this->owner, $this->opts());

        $this->assertCount(1, $result['units']);
        $unit = $result['units'][0];
        $this->assertSame(['active', true, 3, 115000, 115000], [$unit['state'], $unit['matchable'], count($unit['entry_ids']), $unit['net_minor'], $result['totals']['matchable_debit_minor']], 'المبلغ مرة واحدة لا ثلاثاً.');
    }

    // ═══════════════════════════════ الفروع والصلاحيات والعزل ═══════════════════════════════

    /** @test */
    public function a_branch_restricted_actor_only_sees_their_branch_and_is_never_labelled_organization_wide(): void
    {
        $inside = Branch::create(['code' => 'IN', 'name' => 'فرع داخل']);
        $outside = Branch::create(['code' => 'OUT', 'name' => 'فرع خارج']);
        $this->invoice('2026-09-01', 100000, $inside->id);
        $this->invoice('2026-09-02', 70000, $outside->id);

        $this->customRole('ps-branch', ['partner_statements.view', 'partners.view', 'reports.view']);
        $restricted = User::create(['tenant_id' => $this->auth['tenant_id'], 'name' => 'مقيَّد', 'email' => 'r@ps-a2b.test', 'password' => 'password123', 'role' => 'ps-branch']);
        $restricted->branches()->sync([$inside->id]);
        $this->actingAs($restricted);

        $result = $this->candidates->for($restricted, $this->opts());
        $this->assertSame(['branch', [$inside->id]], [$result['scope']['kind'], $result['scope']['branch_ids']]);
        $this->assertSame([115000], array_column($result['units'], 'debit_minor'), 'قيود الفرع الآخر لا تُعاد.');

        $this->assertSame('هذا الفرع خارج نطاق صلاحياتك.', $this->thrown(fn () => $this->candidates->for($restricted, $this->opts(['branch_id' => $outside->id])))->getMessage());

        // مالك غير مقيَّد: الفلتر الاختياري يضيّق، وبدونه «مؤسسة».
        $this->actingAs($this->owner);
        $this->assertSame([80500], array_column($this->candidates->for($this->owner, $this->opts(['branch_id' => $outside->id]))['units'], 'debit_minor'));
        $this->assertSame('organization', $this->candidates->for($this->owner, $this->opts())['scope']['kind']);

        // مقيَّد بفرعين بلا فلتر ⇒ مجموعة مقيَّدة لا «المؤسسة».
        $restricted->branches()->sync([$inside->id, $outside->id]);
        $this->actingAs($restricted->fresh());
        $set = $this->candidates->for($restricted->fresh(), $this->opts());
        $this->assertSame('restricted_set', $set['scope']['kind']);
        $this->assertCount(2, $set['units']);
    }

    /** @test */
    public function permissions_are_required_and_every_unavailable_partner_gets_one_refusal(): void
    {
        $this->invoice('2026-09-01', 100000);
        $message = PartnerStatementImportService::PARTNER_UNAVAILABLE;

        $this->customRole('ps-none', ['reports.view']);
        $noView = User::create(['tenant_id' => $this->auth['tenant_id'], 'name' => 'x', 'email' => 'n@ps-a2b.test', 'password' => 'password123', 'role' => 'ps-none']);
        $this->actingAs($noView);
        $this->assertSame($message, $this->thrown(fn () => $this->candidates->for($noView, $this->opts()))->getMessage(), 'بلا partner_statements.view.');

        $this->customRole('ps-partners-only', ['partners.view', 'reports.view']);
        $partnersOnly = User::create(['tenant_id' => $this->auth['tenant_id'], 'name' => 'w', 'email' => 'w@ps-a2b.test', 'password' => 'password123', 'role' => 'ps-partners-only']);
        $this->actingAs($partnersOnly);
        $this->assertSame($message, $this->thrown(fn () => $this->candidates->for($partnersOnly, $this->opts()))->getMessage(), 'partners.view وحده لا يكفي بلا partner_statements.view.');

        $this->customRole('ps-nopartners', ['partner_statements.view']);
        $noPartners = User::create(['tenant_id' => $this->auth['tenant_id'], 'name' => 'y', 'email' => 'p@ps-a2b.test', 'password' => 'password123', 'role' => 'ps-nopartners']);
        $this->actingAs($noPartners);
        $this->assertSame($message, $this->thrown(fn () => $this->candidates->for($noPartners, $this->opts()))->getMessage(), 'بلا partners.view.');

        $this->actingAs($this->owner);
        $customerOnly = Partner::create(['type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل فقط', 'is_active' => true]);
        $this->assertSame($message, $this->thrown(fn () => $this->candidates->for($this->owner, $this->opts(['partner_id' => $customerOnly->id, 'role' => 'supplier'])))->getMessage());
        $this->assertSame($message, $this->thrown(fn () => $this->candidates->for($this->owner, $this->opts(['partner_id' => (string) \Illuminate\Support\Str::uuid()])))->getMessage());
    }

    /** @test */
    public function another_tenants_partner_and_ledger_are_unreachable(): void
    {
        $this->invoice('2026-09-01', 100000);
        $other = $this->registerTenant('ps-a2b-other', 'owner@other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $foreign = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف مستأجر آخر', 'is_active' => true]);
        $this->invoice('2026-09-01', 555000, null, $foreign);
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->actingAs($this->owner);

        $this->assertSame(PartnerStatementImportService::PARTNER_UNAVAILABLE, $this->thrown(fn () => $this->candidates->for($this->owner, $this->opts(['partner_id' => $foreign->id])))->getMessage());
        $own = $this->candidates->for($this->owner, $this->opts());
        $this->assertSame([115000], array_column($own['units'], 'debit_minor'));
    }

    /** @test */
    public function it_fails_closed_without_the_actor_being_authenticated(): void
    {
        $this->invoice('2026-09-01', 100000);

        auth()->logout();
        $this->assertInstanceOf(LogicException::class, $this->thrown(fn () => $this->candidates->for($this->owner, $this->opts())));

        $this->customRole('ps-other', ['partner_statements.view', 'partners.view']);
        $other = User::create(['tenant_id' => $this->auth['tenant_id'], 'name' => 'z', 'email' => 'o@ps-a2b.test', 'password' => 'password123', 'role' => 'ps-other']);
        $this->actingAs($other);
        $this->assertInstanceOf(LogicException::class, $this->thrown(fn () => $this->candidates->for($this->owner, $this->opts())), 'فاعل مُمرَّر غير المصادَق عليه.');
    }

    // ═══════════════════════════════ لا أثر مالي والجدار ═══════════════════════════════

    /** @test */
    public function reading_candidates_writes_nothing(): void
    {
        $this->invoice('2026-09-01', 100000);
        $tables = ['journal_entries', 'journal_lines', 'account_balances', 'invoices', 'purchases', 'payments', 'stock_movements', 'partner_statement_reconciliations', 'partner_statement_lines'];
        $count = fn (): array => array_map(fn (string $t): int => DB::table($t)->count(), array_combine($tables, $tables));
        $balances = DB::table('account_balances')->orderBy('id')->get()->all();
        $before = $count();

        $this->candidates->for($this->owner, $this->opts());

        $this->assertSame($before, $count());
        $this->assertEquals($balances, DB::table('account_balances')->orderBy('id')->get()->all());
    }

    /** @test */
    public function the_candidate_source_references_no_financial_writer(): void
    {
        $source = '';
        foreach (token_get_all((string) file_get_contents(base_path('app/Services/Reporting/PartnerLedgerCandidates.php'))) as $token) {
            if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $source .= is_array($token) ? $token[1] : $token;
        }
        foreach (['LedgerService', 'JournalEntry', 'JournalLine', 'InventoryService', 'Zatca', 'InvoiceService', 'PurchaseService', 'PaymentService', 'ReturnService', 'CreditNoteService', 'DB::table', '::create(', '->save('] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $source, "مصدر المرشحين لا يرجع إلى {$forbidden}.");
        }
    }

    private function customRole(string $slug, array $permissions): void
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
    }
}
