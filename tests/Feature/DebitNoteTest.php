<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CreditNote;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  الإشعار المدين — نظير الإشعار الدائن على جانب المشتريات
 * ═══════════════════════════════════════════════════════════════
 *  خصمٌ من المورّد **بلا حركة مخزون** (خصم تجاري لاحق · تصحيح سعر · تعويض).
 *
 *  قيده (آجل، 1000 + 15%):
 *    مدين  2110 الموردون                        115000
 *    دائن  5115 مردودات ومسموحات المشتريات      100000
 *    دائن  1150 ضريبة المدخلات                   15000
 *
 *  **لا يمسّ 1140 عمداً**: لا بضاعة تُردّ، فخصمُه من حساب المراقبة كان
 *  يفصله عن دفتر المخزون المساعد صامتاً. اختبار صريح أدناه يحرس ذلك.
 *
 *  تشغيل: php artisan test --filter=DebitNoteTest
 */
class DebitNoteTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $supplier;
    protected Partner $customer;
    protected CreditNoteService $notes;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->notes    = app(CreditNoteService::class);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    private function bal(string $code): int
    {
        return Account::where('code', $code)->first()->balance?->balance ?? 0;
    }

    /** إشعار مدين آجل بقيمة 1000 ريال + 15%. */
    private function debitNote(string $refundType = 'credit'): CreditNote
    {
        $note = $this->notes->create([
            'type' => 'purchase', 'partner_id' => $this->supplier->id,
            'refund_type' => $refundType, 'reason' => 'خصم تجاري لاحق',
        ], [['description' => 'خصم على توريد', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);

        return $this->notes->post($note);
    }

    /** @test */
    public function the_chart_of_accounts_has_the_allowance_account(): void
    {
        $account = Account::where('code', '5115')->first();

        $this->assertNotNull($account, 'حساب 5115 يجب أن يوجد في دليل الحسابات.');
        $this->assertSame('expense', $account->type);
        $this->assertFalse((bool) $account->is_group, 'يجب أن يكون ورقياً ليقبل القيود.');
    }

    /**
     * **جوهر الوحدة.** القيد يخفّض ذمّة المورّد مقابل المسموحات وضريبة المدخلات.
     *
     * @test
     */
    public function a_credit_debit_note_reduces_payables_against_allowance_and_input_vat(): void
    {
        $note  = $this->debitNote();
        $entry = JournalEntry::with('lines.account')->findOrFail($note->journal_entry_id);

        $this->assertSame(100000, (int) $this->line($entry, '5115')->credit);
        $this->assertSame(15000, (int) $this->line($entry, '1150')->credit);
        $this->assertSame(115000, (int) $this->line($entry, '2110')->debit);

        // متوازن، ومربوط بمصدره
        $this->assertSame($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertSame(CreditNote::class, $entry->source_type);
        $this->assertSame($note->id, $entry->source_id);
    }

    /** الذمّة المخفَّضة مربوطة بالمورّد نفسه — فيصحّ كشف حسابه. */
    /** @test */
    public function the_payable_line_is_linked_to_the_supplier(): void
    {
        $note  = $this->debitNote();
        $entry = JournalEntry::with('lines.account')->findOrFail($note->journal_entry_id);
        $payable = $this->line($entry, '2110');

        $this->assertSame(Partner::class, $payable->partner_type);
        $this->assertSame($this->supplier->id, $payable->partner_id);
    }

    /** استرداد نقدي: النقد يُدين بدل ذمّة المورّد. */
    /** @test */
    public function a_cash_debit_note_debits_cash_not_payables(): void
    {
        $note  = $this->debitNote('cash');
        $entry = JournalEntry::with('lines.account')->findOrFail($note->journal_entry_id);

        $this->assertSame(115000, (int) $this->line($entry, '1110')->debit);
        $this->assertNull($this->line($entry, '2110'));
    }

    /**
     * **الضمان الحاسم:** الإشعار المدين لا يمسّ المخزون إطلاقاً — فحساب
     * المراقبة 1140 يبقى مطابقاً لدفتر المخزون المساعد.
     *
     * @test
     */
    public function a_debit_note_never_touches_inventory(): void
    {
        $before = $this->bal('1140');
        $note   = $this->debitNote();
        $entry  = JournalEntry::with('lines.account')->findOrFail($note->journal_entry_id);

        $this->assertNull($this->line($entry, '1140'), 'لا سطر مخزون في الإشعار المدين.');
        $this->assertNull($this->line($entry, '5110'), 'ولا سطر تكلفة بضاعة مباعة.');
        $this->assertSame($before, $this->bal('1140'), 'رصيد المخزون لم يتغيّر.');
    }

    /** المسموحات مصروف مقابل: تخفّض إجمالي المصروفات لا تزيده. */
    /** @test */
    public function the_allowance_reduces_total_expenses(): void
    {
        $this->debitNote();

        $expense = app(\App\Services\Reporting\ReportService::class)->incomeStatement();
        $row = collect($expense['expenses'])->firstWhere('code', '5115');

        $this->assertNotNull($row);
        $this->assertSame(-100000, $row['amount'], 'المسموحات تظهر بمبلغ سالب فتخفّض الإجمالي.');
        $this->assertSame(-100000, $expense['total_expense']);
    }

    /** الإشعار الدائن المستقل يحدد نوع المبيعات صراحةً بعد منع الافتراض الخفي. */
    /** @test */
    public function the_sales_credit_note_is_unchanged(): void
    {
        $note = $this->notes->create([
            'type' => 'sales', 'partner_id' => $this->customer->id, 'refund_type' => 'credit',
        ], [['description' => 'مرتجع', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);
        $note = $this->notes->post($note);

        $this->assertSame('sales', $note->type);
        $entry = JournalEntry::with('lines.account')->findOrFail($note->journal_entry_id);
        $this->assertSame(100000, (int) $this->line($entry, '4110')->debit);
        $this->assertSame(15000, (int) $this->line($entry, '2120')->debit);
        $this->assertSame(115000, (int) $this->line($entry, '1130')->credit);
    }

    /** ترقيم مستقلّ لكل نوع: CN للدائن وDN للمدين. */
    /** @test */
    public function each_type_has_its_own_number_sequence(): void
    {
        $debit = $this->debitNote();
        $credit = $this->notes->create([
            'type' => 'sales', 'partner_id' => $this->customer->id,
        ], [['quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]]);

        $this->assertStringStartsWith('DN-', $debit->number);
        $this->assertStringStartsWith('CN-', $credit->number);
        $this->assertStringEndsWith('-00001', $debit->number);
        $this->assertStringEndsWith('-00001', $credit->number);
    }
}
