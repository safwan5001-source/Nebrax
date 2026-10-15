<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountBalance;
use App\Models\Branch;
use App\Models\CreditNote;
use App\Models\Expense;
use App\Models\FiscalYear;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\ManualJournal;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\AccountingDateGuard;
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\ExpenseService;
use App\Services\Accounting\FiscalCloseService;
use App\Services\Accounting\FiscalYearClosedException;
use App\Services\Accounting\FiscalYearService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\ManualJournalService;
use App\Services\Accounting\PaymentService;
use App\Services\Accounting\PurchaseService;
use App\Services\Accounting\ReturnService;
use App\Services\Reporting\ReportService;
use App\Services\TenantApplicationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * FC-3 — سنةٌ مالية مقفلة (`status = closed`) ترفض كل ترحيل/عكس يقع تاريخه المحاسبي داخل حدّيها الشاملين.
 *
 * الإنفاذ في `AccountingDateGuard` وحده (داخل `LedgerService::post/reverse`)، إلزاميٌّ بلا إعداد مستأجر ولا
 * مفتاح تجاوز. التصحيح بفتح السنة رسمياً أو بتاريخ فترة مفتوحة. قفل الفترة (ACC-6) باقٍ مستقلاً.
 *
 * «اليوم» مثبَّت على 2027-03-15 (سنة 2027 مفتوحة) كي تكون التصحيحات «بتاريخ اليوم» واقعة في فترة مفتوحة.
 * تشغيل: php artisan test --filter=FiscalYearClosedPostingTest
 */
class FiscalYearClosedPostingTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected User $user;
    protected Partner $customer;
    protected Partner $supplier;
    protected Product $service;
    protected FiscalYear $y26;
    protected FiscalYear $y27;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2027-03-15 10:00:00'));

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras-fc3', 'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(TenantApplicationService::class)->enable('purchases.cycle', null);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->service = Product::create(['name' => 'خدمة', 'track_inventory' => false]);

        $this->user = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مدير',
            'email' => 'admin@fc3.sa', 'password' => bcrypt('secret1234'), 'role' => 'owner',
        ]);
        Sanctum::actingAs($this->user);

        $this->y26 = $this->year('2026');
        $this->y27 = $this->year('2027');
    }

    /** `SetTenant` ينسى المستأجر بعد كل طلب؛ فيُعاد سياق التهيئة ليتابع الاختبار بالخدمات مباشرة. */
    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $tenant = app(TenantContext::class);
        $setup = $tenant->id();

        try {
            return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
        } finally {
            $setup === null ? $tenant->forget() : $tenant->set($setup);
        }
    }

    // ───────────────────────────── مساعدات ─────────────────────────────

    private function year(string $y): FiscalYear
    {
        return FiscalYear::findOrFail(app(FiscalYearService::class)->create(
            ['name' => $y, 'start_date' => "{$y}-01-01", 'end_date' => "{$y}-12-31"], null
        )['id']);
    }

    private function id(string $code): string
    {
        return Account::where('code', $code)->firstOrFail()->id;
    }

    /** قيد إيراد بسيط (مدين العملاء / دائن المبيعات). */
    private function revenue(string $date, int $amount, string|null|false $branch = false): JournalEntry
    {
        $meta = ['entry_date' => $date];
        if ($branch !== false) {
            $meta['branch_id'] = $branch;
        }

        return app(LedgerService::class)->post([
            ['account_id' => $this->id('1130'), 'debit' => $amount],
            ['account_id' => $this->id('4110'), 'credit' => $amount],
        ], $meta);
    }

    private function close(FiscalYear $year): void
    {
        app(FiscalCloseService::class)->close($year->id, null);
    }

    private function reopen(FiscalYear $year): void
    {
        app(FiscalCloseService::class)->reopen($year->id, 'تصحيح قيد متأخر', null);
    }

    private function draftInvoice(string $date): Invoice
    {
        return app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit', 'invoice_date' => $date],
            [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );
    }

    private function draftPurchase(string $date): Purchase
    {
        return app(PurchaseService::class)->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'purchase_date' => $date],
            [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );
    }

    private function draftReturn(Invoice $invoice, string $date): ReturnDocument
    {
        $line = $invoice->lines->first();

        return app(ReturnService::class)->create([
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id, 'return_date' => $date,
        ], [[
            'product_id' => $line->product_id, 'source_line_id' => $line->id,
            'quantity' => 1, 'unit_price' => (int) $line->unit_price, 'tax_rate' => 15,
        ]]);
    }

    private function draftNote(Invoice $invoice, string $date): string
    {
        return $this->postJson('/api/credit-notes', [
            'partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id, 'note_date' => $date,
            'items' => [['source_line_id' => $invoice->lines->first()->id, 'quantity' => 1]],
        ])->assertCreated()->json('data.id');
    }

    private function draftManual(string $date, int $amount = 5000): ManualJournal
    {
        return app(ManualJournalService::class)->create(['entry_date' => $date, 'description' => 'قيد يدوي'], [
            ['account_id' => $this->id('1130'), 'debit' => $amount],
            ['account_id' => $this->id('4110'), 'credit' => $amount],
        ]);
    }

    /** لقطة كل ما يكتبه المحرك: القيود، السطور، الأرصدة المجمّعة، وآخر رقم قيد. */
    private function ledgerState(): array
    {
        return [
            'entries' => JournalEntry::query()->orderBy('id')->get(['id', 'number', 'status', 'entry_date'])->toArray(),
            'lines' => JournalLine::query()->orderBy('id')->get(['id', 'account_id', 'debit', 'credit'])->toArray(),
            'balances' => AccountBalance::query()->orderBy('account_id')->get()->map(fn ($b) => $b->only(['account_id', 'debit', 'credit']))->toArray(),
        ];
    }

    /** يتوقع رفض «سنة مقفلة» تحديداً، دون أي أثر في الدفتر. */
    private function assertRejectedByClosedYear(callable $attempt, string $label): FiscalYearClosedException
    {
        $before = $this->ledgerState();
        try {
            $attempt();
        } catch (FiscalYearClosedException $e) {
            $this->assertInstanceOf(AccountingPeriodLockedException::class, $e, 'يرث نوع ACC-6');
            $this->assertStringContainsString('«2026»', $e->getMessage());
            $this->assertSame($before, $this->ledgerState(), "{$label}: أثرٌ جزئي في الدفتر بعد الرفض");

            return $e;
        }
        $this->fail("{$label}: كان يجب أن يُرفض بسنة مالية مقفلة");
    }

    private function assertBooksBalanced(): void
    {
        $this->assertSame((int) JournalLine::sum('debit'), (int) JournalLine::sum('credit'));
    }

    // ───────────── 1. الحدود الشاملة ─────────────

    /** @test */
    public function postings_dated_inside_a_closed_year_are_rejected_on_both_inclusive_boundaries(): void
    {
        $this->revenue('2026-03-01', 100000);
        $this->close($this->y26);

        foreach (['2026-01-01', '2026-06-15', '2026-12-31'] as $date) {
            $this->assertRejectedByClosedYear(fn () => $this->revenue($date, 1000), "قيد {$date}");
        }

        // اليوم السابق للبداية والتالي للنهاية مفتوحان (لا سنة مقفلة تشملهما).
        $this->revenue('2025-12-31', 1000);
        $this->revenue('2027-01-01', 1000);
        $this->assertBooksBalanced();
    }

    /** @test */
    public function the_rejection_names_the_closed_year_and_its_correction_path(): void
    {
        $this->close($this->y26);

        $e = $this->assertRejectedByClosedYear(fn () => $this->revenue('2026-07-01', 1000), 'رسالة');
        $this->assertStringContainsString('2026-01-01 إلى 2026-12-31', $e->getMessage());
        $this->assertStringContainsString('افتح السنة المالية رسمياً', $e->getMessage());
        $this->assertStringContainsString('2026-07-01', $e->getMessage());
    }

    // ───────────── 2. المستندات: رفض آمن بلا ترقيم ولا آثار ZATCA ─────────────

    /** @test */
    public function an_invoice_dated_in_a_closed_year_stays_draft_and_consumes_no_number_icv_or_zatca_artefact(): void
    {
        $posted = app(InvoiceService::class)->post($this->draftInvoice('2026-11-01'));   // ICV 1
        $draft = $this->draftInvoice('2026-12-10');
        $this->close($this->y26);

        $this->assertRejectedByClosedYear(fn () => app(InvoiceService::class)->post($draft->fresh()), 'فاتورة');

        $draft = $draft->fresh();
        $this->assertSame('draft', $draft->status);
        $this->assertNull($draft->zatca_icv);
        $this->assertNull($draft->zatca_qr);
        $this->assertNull($draft->zatca_xml);
        $this->assertNull($draft->journal_entry_id);

        // لا فجوة ولا تكرار في ICV: الفاتورة التالية في فترة مفتوحة تأخذ الرقم التالي مباشرة.
        $next = app(InvoiceService::class)->post($this->draftInvoice('2027-03-15'));
        $this->assertSame((int) $posted->zatca_icv + 1, (int) $next->zatca_icv);
    }

    /** @test */
    public function purchases_payments_expenses_and_manual_journals_dated_in_a_closed_year_are_rejected_and_stay_draft(): void
    {
        $purchase = $this->draftPurchase('2026-10-01');
        $payment = app(PaymentService::class)->create(['partner_id' => $this->customer->id, 'amount' => 10000, 'payment_date' => '2026-10-02']);
        $expense = app(ExpenseService::class)->create([
            'account_id' => $this->id('5130'), 'amount' => 10000, 'tax_rate' => 15, 'payment_method' => 'cash', 'expense_date' => '2026-10-03',
        ]);
        $manual = $this->draftManual('2026-10-04');
        $this->close($this->y26);

        $this->assertRejectedByClosedYear(fn () => app(PurchaseService::class)->post($purchase->fresh()), 'مشتريات');
        $this->assertRejectedByClosedYear(fn () => app(PaymentService::class)->post($payment->fresh()), 'سند');
        $this->assertRejectedByClosedYear(fn () => app(ExpenseService::class)->post($expense->fresh()), 'مصروف');
        $this->assertRejectedByClosedYear(fn () => app(ManualJournalService::class)->post($manual->fresh()), 'قيد يدوي');

        $this->assertSame('draft', Purchase::findOrFail($purchase->id)->status);
        $this->assertSame('draft', Payment::findOrFail($payment->id)->status);
        $this->assertSame('draft', Expense::findOrFail($expense->id)->status);
        $this->assertSame('draft', ManualJournal::findOrFail($manual->id)->status);
    }

    /** @test */
    public function returns_and_credit_notes_dated_in_a_closed_year_are_rejected(): void
    {
        $invoice = app(InvoiceService::class)->post($this->draftInvoice('2026-11-01'));
        $return = $this->draftReturn($invoice, '2026-12-05');
        $noteId = $this->draftNote($invoice, '2026-12-06');
        $this->close($this->y26);

        $this->assertRejectedByClosedYear(fn () => app(ReturnService::class)->post($return->fresh()), 'مرتجع');
        $this->assertSame('draft', $return->fresh()->status);

        $before = $this->ledgerState();
        $this->postJson("/api/credit-notes/{$noteId}/post")->assertStatus(422)
            ->assertJsonPath('message', fn (string $m) => str_contains($m, '«2026»'));
        $this->assertSame($before, $this->ledgerState());
        $this->assertSame('draft', CreditNote::findOrFail($noteId)->status);
    }

    // ───────────── 3. التصحيح بتاريخ فترة مفتوحة ─────────────

    /** @test */
    public function closed_year_documents_are_corrected_in_the_open_period_without_touching_the_closed_year(): void
    {
        $invoice = app(InvoiceService::class)->post($this->draftInvoice('2026-11-01'));
        $second = app(InvoiceService::class)->post($this->draftInvoice('2026-11-05'));
        $manual = app(ManualJournalService::class)->post($this->draftManual('2026-11-02'));
        $entry = $this->revenue('2026-11-03', 7000);
        $this->close($this->y26);
        $pl26 = app(FiscalCloseService::class)->profitAndLoss($this->y26->fresh());
        $sheet26 = app(ReportService::class)->balanceSheet(['to' => '2026-12-31']);

        // مرتجع وإشعار دائن بتاريخ اليوم (2027-03-15) على فواتير 2026: مقبولان.
        $return = app(ReturnService::class)->post($this->draftReturn($invoice, '2027-03-15'));
        $this->assertSame('posted', $return->status);
        $noteId = $this->draftNote($second, '2027-03-15');
        $this->postJson("/api/credit-notes/{$noteId}/post")->assertOk();

        // عكس قيد 2026 بتاريخ اليوم مقبول؛ وبتاريخ داخل 2026 مرفوض (عبر المحرك وعبر القيد اليدوي).
        $this->assertRejectedByClosedYear(fn () => app(LedgerService::class)->reverse($entry->fresh(), '2026-12-20'), 'عكس داخل السنة');
        $this->assertRejectedByClosedYear(fn () => app(ManualJournalService::class)->reverse($manual->fresh(), '2026-12-20'), 'عكس يدوي داخل السنة');
        $reversal = app(LedgerService::class)->reverse($entry->fresh(), '2027-03-15');
        $this->assertSame('2027-03-15', $reversal->entry_date->toDateString());
        $this->assertSame('reversed', $entry->fresh()->status);
        $default = app(ManualJournalService::class)->reverse($manual->fresh());           // افتراضيّه اليوم
        $this->assertSame('reversed', $default->status);

        // نتيجة 2026 وميزانيتها حتى نهايتها لم تتغيّر.
        $this->assertEquals($pl26, app(FiscalCloseService::class)->profitAndLoss($this->y26->fresh()));
        $this->assertSame($sheet26, app(ReportService::class)->balanceSheet(['to' => '2026-12-31']));
        $this->assertBooksBalanced();
    }

    // ───────────── 4. الإقفال والفتح وإعادة الإقفال ─────────────

    /** @test */
    public function close_reopen_and_reclose_generations_toggle_the_protection_and_keep_their_own_journals(): void
    {
        $this->revenue('2026-03-01', 100000);

        $this->close($this->y26);                                                           // قيد الإقفال نفسه مرّ (الحالة closing داخل معاملته)
        $gen1 = $this->y26->fresh()->closes()->where('generation', 1)->firstOrFail();
        $this->assertSame('2026-12-31', JournalEntry::findOrFail($gen1->journal_entry_id)->entry_date->toDateString());
        $this->assertRejectedByClosedYear(fn () => $this->revenue('2026-05-01', 25000), 'بعد الجيل 1');

        $this->reopen($this->y26);                                                          // عكس الإقفال بتاريخ 2026-12-31 مرّ (reopening)
        $gen1 = $gen1->fresh();
        $this->assertSame('2026-12-31', JournalEntry::findOrFail($gen1->reversal_entry_id)->entry_date->toDateString());
        $this->assertSame(FiscalYear::STATUS_OPEN, $this->y26->fresh()->status);

        $this->revenue('2026-05-01', 25000);                                                // التصحيح بعد الفتح الرسمي
        $this->close($this->y26->fresh());
        $gen2 = $this->y26->fresh()->closes()->where('generation', 2)->firstOrFail();
        $this->assertSame(125000, (int) $gen2->total_revenue);
        $this->assertSame(100000, (int) $gen1->total_revenue);
        $this->assertRejectedByClosedYear(fn () => $this->revenue('2026-06-01', 1000), 'بعد الجيل 2');
        $this->assertBooksBalanced();
    }

    // ───────────── 5. استقلال قفل الفترة ─────────────

    /** @test */
    public function period_locks_stay_independent_and_releasing_one_never_opens_a_closed_year(): void
    {
        $this->revenue('2026-02-01', 1000);
        $lock = app(AccountingPeriodLockService::class)->create('2026-01-01', '2026-06-30', 'نصف السنة', null);
        $this->close($this->y26);                                                           // القفل لا يشمل نهاية السنة

        // داخل القفل: سبب الرفض قفل الفترة (يُفحص أولاً)؛ خارجه داخل السنة: السنة المقفلة.
        try {
            $this->revenue('2026-03-01', 1000);
            $this->fail('كان يجب أن يُرفض');
        } catch (AccountingPeriodLockedException $e) {
            $this->assertNotInstanceOf(FiscalYearClosedException::class, $e);
        }
        $this->assertRejectedByClosedYear(fn () => $this->revenue('2026-09-01', 1000), 'خارج القفل');

        // تحرير القفل لا يفتح السنة المقفلة.
        app(AccountingPeriodLockService::class)->release($lock['id'], 'انتهت المراجعة', null);
        $this->assertRejectedByClosedYear(fn () => $this->revenue('2026-03-01', 1000), 'بعد تحرير القفل');

        // وقفل فترة في سنة مفتوحة يعمل كما هو.
        app(AccountingPeriodLockService::class)->create('2027-02-01', '2027-02-28', 'شباط', null);
        $this->assertThrows(fn () => $this->revenue('2027-02-10', 1000), AccountingPeriodLockedException::class);
        $this->revenue('2027-03-15', 1000);
    }

    // ───────────── 6. العزل: المستأجر والفروع ─────────────

    /** @test */
    public function another_tenants_open_year_is_unaffected_and_every_branch_of_the_closing_tenant_is_blocked(): void
    {
        $x = Branch::create(['code' => '00002', 'name' => 'فرع س', 'is_main' => false]);
        $this->close($this->y26);

        $this->assertRejectedByClosedYear(fn () => $this->revenue('2026-08-01', 1000, $x->id), 'فرع س');
        $this->assertRejectedByClosedYear(fn () => $this->revenue('2026-08-01', 1000, null), 'بلا فرع');

        $other = Tenant::create(['name' => 'ب', 'slug' => 'tenant-b-fc3', 'vat_number' => '300000000000011', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        $this->year('2026');                                                                // سنة ب مفتوحة
        $entry = $this->revenue('2026-08-01', 1000);
        $this->assertSame($other->id, $entry->tenant_id);
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(0, JournalEntry::whereDate('entry_date', '2026-08-01')->count()); // لا شيء لدى أ
    }

    // ───────────── 7. ثبات تقارير السنة المقفلة ─────────────

    /** @test */
    public function rejected_backdating_leaves_the_closed_years_vat_report_pl_and_readiness_unchanged(): void
    {
        app(InvoiceService::class)->post($this->draftInvoice('2026-04-01'));
        $draft = $this->draftInvoice('2026-12-20');
        $this->close($this->y26);

        $snapshot = fn () => [
            'tax' => app(ReportService::class)->taxReport(['to' => '2026-12-31']),
            'income' => app(ReportService::class)->incomeStatement(['from' => '2026-01-01', 'to' => '2026-12-31']),
            'vat' => collect(app(FiscalCloseService::class)->readiness($this->y26->fresh())['info'])->firstWhere('code', 'vat_balances')['details'],
        ];
        $before = $snapshot();
        $this->assertSame(15000, $before['vat']['tax_output']);

        $this->assertRejectedByClosedYear(fn () => app(InvoiceService::class)->post($draft->fresh()), 'فاتورة رجعية');
        $this->assertRejectedByClosedYear(fn () => app(LedgerService::class)->post([
            ['account_id' => $this->id('1130'), 'debit' => 11500],
            ['account_id' => $this->id('2120'), 'credit' => 11500],
        ], ['entry_date' => '2026-12-30']), 'ضريبة رجعية');

        $this->assertSame($before, $snapshot());
    }

    // ───────────── 8. الـAPI: 422 بالعقد القائم ─────────────

    /** @test */
    public function the_manual_journal_post_endpoint_answers_422_with_the_fiscal_year_message(): void
    {
        $manual = $this->draftManual('2026-09-09');
        $this->close($this->y26);
        $before = $this->ledgerState();

        $this->postJson("/api/manual-journals/{$manual->id}/post")
            ->assertStatus(422)
            ->assertJsonPath('message', fn (string $m) => str_contains($m, 'السنة المالية «2026»') && str_contains($m, '2026-09-09'));

        $this->assertSame($before, $this->ledgerState());
        $this->assertSame('draft', $manual->fresh()->status);
    }

    // ───────────── 9. الجاهزية: الإفصاح قبل الإقفال ─────────────

    /** @test */
    public function readiness_states_that_postings_dated_in_the_year_are_rejected_after_close(): void
    {
        $this->draftInvoice('2026-12-20');                                                  // مسودة داخل السنة
        $readiness = app(FiscalCloseService::class)->readiness($this->y26->fresh());

        $close = collect($readiness['info'])->firstWhere('code', 'close_date');
        $this->assertTrue($close['details']['posting_blocked_after_close']);
        $this->assertFalse($close['details']['year_not_ended']);                            // اليوم 2027-03-15
        $this->assertStringContainsString('يُرفض كل ترحيل أو عكس مؤرَّخ من 2026-01-01 إلى 2026-12-31', $close['message']);
        $drafts = collect($readiness['warnings'])->firstWhere('code', 'drafts.invoices');
        $this->assertStringContainsString('بعد الإقفال يُرفض ترحيل أي مستند مؤرَّخ داخل السنة', $drafts['message']);

        // سنةٌ لم تنتهِ: يُقال صراحةً إن الإقفال يوقف ترحيل عمليات اليوم (بلا تغيير شدّة).
        $this->travelTo(Carbon::parse('2027-06-01 09:00:00'));
        $open = collect(app(FiscalCloseService::class)->readiness($this->y27->fresh())['info'])->firstWhere('code', 'close_date');
        $this->assertTrue($open['details']['year_not_ended']);
        $this->assertStringContainsString('السنة لم تنتهِ بعد', $open['message']);
    }

    // ───────────── 10. لا تجاوز ─────────────

    /** @test */
    public function there_is_no_bypass_argument_setting_or_alternative_path_around_the_guard(): void
    {
        $ledger = new \ReflectionClass(LedgerService::class);
        $public = collect($ledger->getMethods(\ReflectionMethod::IS_PUBLIC))->reject(fn ($m) => $m->isConstructor())->map(fn ($m) => $m->getName())->sort()->values()->all();
        $this->assertSame(['post', 'reverse'], $public);

        $guard = new \ReflectionClass(AccountingDateGuard::class);
        $this->assertSame(['activeLockFor', 'assertOpen'], collect($guard->getMethods(\ReflectionMethod::IS_PUBLIC))
            ->reject(fn ($m) => $m->isConstructor())->map(fn ($m) => $m->getName())->sort()->values()->all());
        foreach (['assertOpen', 'activeLockFor'] as $method) {
            $this->assertSame(['date'] + ($method === 'assertOpen' ? [1 => 'context'] : []),
                array_map(fn ($p) => $p->getName(), $guard->getMethod($method)->getParameters()));
        }

        // لا إعداد مستأجر ولا مفتاح تجاوز في كود الحارس (بعد تجريد التعليقات).
        $code = '';
        foreach (token_get_all(file_get_contents(app_path('Services/Accounting/AccountingDateGuard.php'))) as $token) {
            if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $code .= is_array($token) ? $token[1] : $token;
        }
        foreach (['Settings::', 'BranchSettings', 'skipLock', 'bypass', 'force', 'disableGuard', 'config('] as $needle) {
            $this->assertStringNotContainsString($needle, $code, "مفتاح/إعداد في الحارس: {$needle}");
        }

        // والمحرك لا يزال المسار الوحيد للقيود: لا كتابة مباشرة خارج LedgerService.
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path())) as $file) {
            if ($file->getExtension() !== 'php' || str_ends_with($file->getPathname(), 'Services/Accounting/LedgerService.php')) {
                continue;
            }
            $this->assertDoesNotMatchRegularExpression('/\b(JournalEntry|JournalLine)::(create|insert)\(/', file_get_contents($file->getPathname()), $file->getPathname());
        }
    }
}
