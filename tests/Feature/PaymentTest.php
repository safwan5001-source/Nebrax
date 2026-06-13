<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Partner;
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
