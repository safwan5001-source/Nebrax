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

    /** سند قبض على فاتورة بمبلغ محدّد. */
    private function collect(\App\Models\Invoice $invoice, int $amount): Payment
    {
        return $this->payments->post($this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount'     => $amount,
        ]));
    }

    private function creditInvoice(): \App\Models\Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]] // 2300
        );
        return app(InvoiceService::class)->post($invoice);
    }

    /** @test */
    public function partial_payment_marks_invoice_partial_and_reduces_remaining(): void
    {
        $invoice = $this->creditInvoice();

        $this->collect($invoice, 100000); // 1000 من 2300

        $invoice->refresh();
        $this->assertSame(100000, $invoice->paid_amount);
        $this->assertSame('partial', $invoice->payment_status);
        $this->assertSame(130000, $invoice->remaining());      // 1300 متبقٍ
        $this->assertEquals(130000, Account::where('code', '1130')->first()->balance->balance);
    }

    /** @test */
    public function full_payment_marks_invoice_paid_and_zeroes_remaining(): void
    {
        $invoice = $this->creditInvoice();

        $this->collect($invoice, 230000); // كامل المبلغ

        $invoice->refresh();
        $this->assertSame(230000, $invoice->paid_amount);
        $this->assertSame('paid', $invoice->payment_status);
        $this->assertTrue($invoice->isFullyPaid());
        $this->assertSame(0, $invoice->remaining());
        $this->assertEquals(0, Account::where('code', '1130')->first()->balance->fresh()->balance);
    }

    /** @test */
    public function two_partials_settle_invoice_from_unpaid_to_partial_to_paid(): void
    {
        $invoice = $this->creditInvoice();
        $this->assertSame('unpaid', $invoice->payment_status);

        $this->collect($invoice, 100000);
        $this->assertSame('partial', $invoice->refresh()->payment_status);

        $this->collect($invoice, 130000); // يكمل المبلغ
        $invoice->refresh();
        $this->assertSame('paid', $invoice->payment_status);
        $this->assertSame(230000, $invoice->paid_amount);
        $this->assertSame(0, $invoice->remaining());
    }

    /** @test */
    public function overpayment_beyond_remaining_is_rejected(): void
    {
        $invoice = $this->creditInvoice();
        $this->collect($invoice, 200000); // متبقٍ 30000

        $this->expectExceptionMessage('يتجاوز المتبقي');
        $this->collect($invoice, 50000);  // أكبر من المتبقي
    }

    /** @test */
    public function overpayment_leaves_invoice_and_receivables_unchanged(): void
    {
        $invoice = $this->creditInvoice();

        try {
            $this->collect($invoice, 500000); // 5000 على 2300
        } catch (\RuntimeException $e) {
            // متوقع
        }

        $invoice->refresh();
        $this->assertSame(0, $invoice->paid_amount);
        $this->assertSame('unpaid', $invoice->payment_status);
        // لا قيد ولا حركة على الذمم (التحقق قبل توليد القيد داخل المعاملة)
        $this->assertEquals(230000, Account::where('code', '1130')->first()->balance->balance);
    }

    /** @test */
    public function collecting_on_an_unposted_invoice_is_rejected(): void
    {
        $draft = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000]]
        ); // draft (لم يُرحَّل)

        $this->expectExceptionMessage('غير مرحّلة');
        $this->collect($draft, 50000);
    }

    /** فاتورة آجلة بإجمالي محدّد (وحدة واحدة بسعر معطى + 15%). */
    private function postedInvoice(int $unitPrice): \App\Models\Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]]
        );
        return app(InvoiceService::class)->post($invoice);
    }

    /** @test */
    public function one_payment_allocated_across_two_invoices_settles_both(): void
    {
        $inv1 = $this->postedInvoice(100000); // 115000
        $inv2 = $this->postedInvoice(100000); // 115000

        $payment = $this->payments->create(
            ['partner_id' => $this->customer->id, 'amount' => 230000],
            [
                ['invoice_id' => $inv1->id, 'amount' => 115000],
                ['invoice_id' => $inv2->id, 'amount' => 115000],
            ]
        );
        $posted = $this->payments->post($payment);

        // قيد واحد متوازن: مدين الصندوق 2300 / دائن الذمم 2300
        $entry = $posted->journalEntry()->with('lines.account')->first();
        $this->assertCount(2, $entry->lines);
        $this->assertEquals(230000, $entry->lines->sum('debit'));
        $this->assertEquals(230000, $entry->lines->sum('credit'));
        $this->assertSame($posted->id, $entry->source_id);

        // الفاتورتان مدفوعتان بالكامل
        $this->assertSame('paid', $inv1->refresh()->payment_status);
        $this->assertSame('paid', $inv2->refresh()->payment_status);
        $this->assertEquals(0, Account::where('code', '1130')->first()->balance->balance);
    }

    /** @test */
    public function allocation_can_mix_full_and_partial_invoices(): void
    {
        $inv1 = $this->postedInvoice(100000); // 115000
        $inv2 = $this->postedInvoice(100000); // 115000

        $payment = $this->payments->create(
            ['partner_id' => $this->customer->id, 'amount' => 150000],
            [
                ['invoice_id' => $inv1->id, 'amount' => 115000], // كامل
                ['invoice_id' => $inv2->id, 'amount' => 35000],  // جزئي
            ]
        );
        $this->payments->post($payment);

        $this->assertSame('paid', $inv1->refresh()->payment_status);

        $inv2->refresh();
        $this->assertSame('partial', $inv2->payment_status);
        $this->assertSame(35000, $inv2->paid_amount);
        $this->assertSame(80000, $inv2->remaining());
    }

    /** @test */
    public function allocations_must_sum_to_the_payment_amount(): void
    {
        $inv1 = $this->postedInvoice(100000);
        $inv2 = $this->postedInvoice(100000);

        $this->expectExceptionMessage('مجموع التخصيصات');
        $this->payments->create(
            ['partner_id' => $this->customer->id, 'amount' => 230000],
            [
                ['invoice_id' => $inv1->id, 'amount' => 115000],
                ['invoice_id' => $inv2->id, 'amount' => 100000], // المجموع 215000 ≠ 230000
            ]
        );
    }

    /** @test */
    public function an_allocation_cannot_exceed_its_invoice_remaining(): void
    {
        $inv1 = $this->postedInvoice(100000); // 115000
        $inv2 = $this->postedInvoice(100000); // 115000

        // المجموع 230000 = المبلغ، لكن تخصيص inv1 يتجاوز متبقّيه
        $payment = $this->payments->create(
            ['partner_id' => $this->customer->id, 'amount' => 230000],
            [
                ['invoice_id' => $inv1->id, 'amount' => 150000], // > 115000
                ['invoice_id' => $inv2->id, 'amount' => 80000],
            ]
        );

        $this->expectExceptionMessage('يتجاوز المتبقي');
        $this->payments->post($payment);
    }

    /** @test */
    public function allocated_invoice_must_belong_to_the_payment_partner(): void
    {
        $inv = $this->postedInvoice(100000);
        $other = Partner::create(['name' => 'عميل آخر', 'type' => 'customer']);

        $payment = $this->payments->create(
            ['partner_id' => $other->id, 'amount' => 115000],
            [['invoice_id' => $inv->id, 'amount' => 115000]]
        );

        $this->expectExceptionMessage('لا تخص طرف السند');
        $this->payments->post($payment);
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
