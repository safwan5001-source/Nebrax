<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات وحدة المدفوعات — تثبت أن سندات القبض/الصرف تولّد قيوداً
 * متوازنة عبر LedgerService وتقفل أرصدة الأطراف.
 * تشغيل:  php artisan test --filter=PaymentTest
 */
class PaymentTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected Partner $supplier;
    protected PaymentService $payments;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح',
            'slug' => 'nibras',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->payments = app(PaymentService::class);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    private function entryFor(Payment $payment): JournalEntry
    {
        return JournalEntry::with('lines.account')
            ->where('source_type', Payment::class)
            ->where('source_id', $payment->id)
            ->firstOrFail();
    }

    /** @test */
    public function received_cash_payment_entry_is_balanced_uses_1110_1130_and_links_to_payment(): void
    {
        $payment = $this->payments->create([
            'partner_id' => $this->customer->id, 'amount' => 115000, 'direction' => 'received', 'method' => 'cash',
        ]);
        $posted = $this->payments->post($payment);

        $entry = $this->entryFor($posted);

        // (د) الربط بالمصدر
        $this->assertSame($posted->id, $entry->source_id);
        $this->assertSame(Payment::class, $entry->source_type);

        // (أ) التوازن
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(115000, $entry->lines->sum('debit'));

        // (ب) قبض نقدي يمدِّن 1110 ويُدائن 1130 (مربوط بالطرف)
        $this->assertEquals(115000, $this->line($entry, '1110')->debit);
        $this->assertEquals(115000, $this->line($entry, '1130')->credit);
        $this->assertEquals($this->customer->id, $this->line($entry, '1130')->partner_id);
    }

    /** @test */
    public function received_bank_payment_entry_uses_1120_and_links_to_payment(): void
    {
        $payment = $this->payments->create([
            'partner_id' => $this->customer->id, 'amount' => 80000, 'method' => 'bank',
        ]);
        $posted = $this->payments->post($payment);

        $entry = $this->entryFor($posted);

        $this->assertSame($posted->id, $entry->source_id);
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));

        // قبض بنكي يمدِّن 1120 (لا 1110)
        $this->assertEquals(80000, $this->line($entry, '1120')->debit);
        $this->assertEquals(80000, $this->line($entry, '1130')->credit);
        $this->assertNull($this->line($entry, '1110'));
    }

    /** @test */
    public function paid_payment_entry_is_balanced_uses_2110_and_links_to_payment(): void
    {
        $payment = $this->payments->create([
            'partner_id' => $this->supplier->id, 'amount' => 60000, 'direction' => 'paid', 'method' => 'cash',
        ]);
        $posted = $this->payments->post($payment);

        $entry = $this->entryFor($posted);

        // (د) الربط بالمصدر
        $this->assertSame($posted->id, $entry->source_id);

        // (أ) التوازن
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(60000, $entry->lines->sum('debit'));

        // (ب) صرف يمدِّن 2110 (مربوط بالمورد) ويُدائن 1110
        $this->assertEquals(60000, $this->line($entry, '2110')->debit);
        $this->assertEquals($this->supplier->id, $this->line($entry, '2110')->partner_id);
        $this->assertEquals(60000, $this->line($entry, '1110')->credit);
    }

    /** @test */
    public function it_creates_a_draft_payment(): void
    {
        $payment = $this->payments->create([
            'partner_id' => $this->customer->id,
            'amount'     => 50000,
        ]);

        $this->assertTrue($payment->isDraft());
        $this->assertSame(50000, $payment->amount);
        $this->assertStringStartsWith('REC-', $payment->number);
        $this->assertNull($payment->journal_entry_id);
    }

    /** @test */
    public function it_rejects_a_non_positive_amount(): void
    {
        $this->expectExceptionMessage('موجباً');
        $this->payments->create(['partner_id' => $this->customer->id, 'amount' => 0]);
    }

    /** @test */
    public function it_posts_a_received_payment_crediting_receivables(): void
    {
        $payment = $this->payments->create([
            'partner_id' => $this->customer->id,
            'amount'     => 115000,
            'direction'  => 'received',
            'method'     => 'cash',
        ]);

        $posted = $this->payments->post($payment);

        $this->assertTrue($posted->isPosted());

        $entry = $posted->journalEntry()->with('lines')->first();
        $this->assertEquals(115000, $entry->lines->sum('debit'));
        $this->assertEquals(115000, $entry->lines->sum('credit'));

        // مدين الصندوق، دائن العملاء (رصيد مدين الطبيعة يصبح سالباً = دائن)
        $this->assertEquals(115000,  Account::where('code', '1110')->first()->balance->balance);
        $this->assertEquals(-115000, Account::where('code', '1130')->first()->balance->balance);
    }

    /** @test */
    public function it_posts_a_bank_payment_to_the_bank_account(): void
    {
        $payment = $this->payments->create([
            'partner_id' => $this->customer->id,
            'amount'     => 80000,
            'method'     => 'bank',
        ]);
        $this->payments->post($payment);

        $this->assertEquals(80000, Account::where('code', '1120')->first()->balance->balance);
        $this->assertNull(Account::where('code', '1110')->first()->balance); // لا حركة على الصندوق
    }

    /** @test */
    public function it_posts_a_paid_payment_debiting_payables(): void
    {
        $payment = $this->payments->create([
            'partner_id' => $this->supplier->id,
            'amount'     => 60000,
            'direction'  => 'paid',
            'method'     => 'cash',
        ]);
        $posted = $this->payments->post($payment);

        $this->assertStringStartsWith('PAY-', $posted->number);

        // مدين الموردون (يقلّل التزاماً)، دائن الصندوق
        $this->assertEquals(-60000, Account::where('code', '2110')->first()->balance->balance);
        $this->assertEquals(-60000, Account::where('code', '1110')->first()->balance->balance);

        // سطر الموردين مربوط بالطرف
        $entry  = $posted->journalEntry()->with('lines')->first();
        $apLine = $entry->lines->firstWhere('debit', 60000);
        $this->assertEquals($this->supplier->id, $apLine->partner_id);
    }

    /** @test */
    public function full_cycle_credit_invoice_then_collection_nets_receivables_to_zero(): void
    {
        // فاتورة آجلة 2300 → العملاء مدين 2300
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        app(InvoiceService::class)->post($invoice);
        $this->assertEquals(230000, Account::where('code', '1130')->first()->balance->balance);

        // تحصيل كامل المبلغ → رصيد العملاء يعود صفراً
        $payment = $this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount'     => 230000,
        ]);
        $this->payments->post($payment);

        $this->assertEquals(0, Account::where('code', '1130')->first()->balance->fresh()->balance);
    }

    /** @test */
    public function it_rejects_posting_an_already_posted_payment(): void
    {
        $payment = $this->payments->create(['partner_id' => $this->customer->id, 'amount' => 10000]);
        $this->payments->post($payment);

        $this->expectExceptionMessage('غير مسوّد');
        $this->payments->post($payment->fresh());
    }
}
