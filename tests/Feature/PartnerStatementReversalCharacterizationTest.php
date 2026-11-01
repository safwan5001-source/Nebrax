<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Purchase;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * IMP-PARTNER-STATEMENTS PS-A2b — اختبار توصيفي لكشف حساب الطرف عند تصفيته بالدور (`partner_role`) والمستند معكوس.
 *
 * `LedgerService::reverse()` ينشئ قيد العكس بلا `source_type/source_id`، وتصفية الدور في `ReportService::partnerStatement` تُبقي السطر
 * فقط إن عُرف دور مصدره؛ فكان سطر العكس يسقط والأصل يبقى فلا يتصفّر المستند المعكوس في كشف الدور (وهو يتصفّر في الكشف غير المصفّى).
 * الإصلاح (أضيق نطاق): دور قيد العكس يُشتق من قيد الأصل (`reversal_of`)؛ لا تغيير في القيود ولا في الأرصدة المخزَّنة ولا في الكشف غير المصفّى.
 *
 * تشغيل: php artisan test --filter=PartnerStatementReversalCharacterizationTest
 */
class PartnerStatementReversalCharacterizationTest extends TestCase
{
    use RefreshDatabase;

    private Partner $both;

    private ReportService $reports;

    protected function setUp(): void
    {
        parent::setUp();
        $tenant = Tenant::create(['name' => 'نبراس الطموح', 'slug' => 'nibras', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        $this->both = Partner::create(['name' => 'طرف مزدوج', 'type' => 'both']);
        $this->reports = app(ReportService::class);
    }

    private function invoice(string $date, int $unitPrice): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->both->id, 'payment_type' => 'credit', 'invoice_date' => $date],
            [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
        );

        return app(InvoiceService::class)->post($invoice);
    }

    private function entryOf(Invoice $invoice): JournalEntry
    {
        return JournalEntry::query()->where('source_type', Invoice::class)->where('source_id', $invoice->id)->firstOrFail();
    }

    /** @return list<array{string,int,int}> [date, debit, credit] */
    private function shape(array $statement): array
    {
        return array_map(fn (array $r): array => [$r['date'], $r['debit'], $r['credit']], $statement['rows']);
    }

    /** @test */
    public function a_reversed_invoice_nets_to_zero_in_the_unfiltered_statement(): void
    {
        $reversed = $this->invoice('2026-09-01', 100000);                 // 1150.00
        $this->invoice('2026-09-05', 20000);                              // 230.00 يبقى
        app(LedgerService::class)->reverse($this->entryOf($reversed), '2026-09-10', 'إلغاء');

        $all = $this->reports->partnerStatement($this->both->id);

        $this->assertSame([['2026-09-01', 115000, 0], ['2026-09-05', 23000, 0], ['2026-09-10', 0, 115000]], $this->shape($all));
        $this->assertSame(23000, $all['closing_balance'], 'الأصل + العاكس = صفر؛ يبقى الرصيد المستند الآخر.');
    }

    /**
     * التوصيف الأصلي (كشف الخلل): قبل الإصلاح كان كشف دور `customer` يُسقط سطر العكس ويُبقي الأصل فيصير الرصيد ١٣٨٠ لا ٢٣٠.
     *
     * @test
     */
    public function a_role_filtered_statement_keeps_the_reversal_line_of_a_reversed_document(): void
    {
        $reversed = $this->invoice('2026-09-01', 100000);
        $this->invoice('2026-09-05', 20000);
        app(LedgerService::class)->reverse($this->entryOf($reversed), '2026-09-10', 'إلغاء');

        $unfiltered = $this->reports->partnerStatement($this->both->id);
        $customer = $this->reports->partnerStatement($this->both->id, ['partner_role' => 'customer']);

        $this->assertSame($this->shape($unfiltered), $this->shape($customer), 'كشف الدور يطابق غير المصفّى حين كل الحركة فواتير مبيعات.');
        $this->assertSame(23000, $customer['closing_balance']);
        $this->assertSame([], $this->reports->partnerStatement($this->both->id, ['partner_role' => 'supplier'])['rows'], 'لا حركة موردين لهذا الطرف.');
    }

    /** @test */
    public function a_reversal_follows_the_role_of_its_original_for_a_purchase_too(): void
    {
        $purchase = Purchase::create([
            'partner_id' => $this->both->id, 'number' => 'PUR-T1', 'purchase_date' => '2026-09-02', 'due_date' => '2026-09-30',
            'status' => 'posted', 'subtotal' => 50000, 'tax_amount' => 7500, 'total' => 57500, 'paid_amount' => 0, 'payment_status' => 'unpaid',
        ]);
        $ledger = app(LedgerService::class);
        $payable = Account::where('code', '2110')->firstOrFail()->id;
        $inventory = Account::where('code', '1140')->firstOrFail()->id;
        $entry = $ledger->post([
            ['account_id' => $inventory, 'debit' => 57500, 'credit' => 0],
            ['account_id' => $payable, 'debit' => 0, 'credit' => 57500, 'partner_type' => Partner::class, 'partner_id' => $this->both->id],
        ], ['entry_date' => '2026-09-02', 'description' => 'شراء', 'source_type' => Purchase::class, 'source_id' => $purchase->id]);
        $ledger->reverse($entry, '2026-09-12', 'إلغاء شراء');

        $supplier = $this->reports->partnerStatement($this->both->id, ['partner_role' => 'supplier']);

        $this->assertSame([['2026-09-02', 0, 57500], ['2026-09-12', 57500, 0]], $this->shape($supplier));
        $this->assertSame(0, $supplier['closing_balance']);
        $this->assertSame([], $this->reports->partnerStatement($this->both->id, ['partner_role' => 'customer'])['rows'], 'عاكس الشراء لا يظهر في كشف العميل.');
    }

    /**
     * يثبّت السلوك القائم الذي لا يغيّره الإصلاح: قيد يدوي موسوم بالطرف بلا مصدر وبلا أصل معكوس يبقى خارج كشف الدور (لا دور له).
     *
     * @test
     */
    public function a_manual_sourceless_entry_stays_outside_a_role_filtered_statement(): void
    {
        $ledger = app(LedgerService::class);
        $ledger->post([
            ['account_id' => Account::where('code', '1130')->firstOrFail()->id, 'debit' => 5000, 'credit' => 0, 'partner_type' => Partner::class, 'partner_id' => $this->both->id],
            ['account_id' => Account::where('code', '4110')->firstOrFail()->id, 'debit' => 0, 'credit' => 5000],
        ], ['entry_date' => '2026-09-03', 'description' => 'قيد يدوي']);

        $this->assertCount(1, $this->reports->partnerStatement($this->both->id)['rows']);
        $this->assertSame([], $this->reports->partnerStatement($this->both->id, ['partner_role' => 'customer'])['rows']);
        $this->assertSame([], $this->reports->partnerStatement($this->both->id, ['partner_role' => 'supplier'])['rows']);
    }
}
