<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات وحدة الفوترة — تثبت أن الفاتورة تولّد قيداً متوازناً صحيحاً
 * عبر LedgerService، وتفرّق بين البيع النقدي والآجل.
 * تشغيل:  php artisan test --filter=InvoiceTest
 */
class InvoiceTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected InvoiceService $invoices;

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
        $this->invoices = app(InvoiceService::class);
    }

    /** @test */
    public function it_creates_a_draft_invoice_with_computed_totals(): void
    {
        // سطران: 1000 + 500، ضريبة 15%
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [
                ['description' => 'منتج أ', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15],
                ['description' => 'منتج ب', 'quantity' => 1, 'unit_price' => 50000,  'tax_rate' => 15],
            ]
        );

        $this->assertTrue($invoice->isDraft());
        $this->assertCount(2, $invoice->lines);
        $this->assertSame(150000, $invoice->subtotal);   // 1500.00
        $this->assertSame(22500,  $invoice->tax_amount);  // 225.00
        $this->assertSame(172500, $invoice->total);       // 1725.00
        $this->assertNull($invoice->journal_entry_id);
    }

    /** @test */
    public function it_posts_a_cash_sale_and_generates_a_balanced_entry(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 1150 إجمالاً
        );

        $posted = $this->invoices->post($invoice);

        $this->assertTrue($posted->isPosted());
        $this->assertNotNull($posted->journal_entry_id);

        // القيد متوازن وبثلاثة سطور
        $entry = $posted->journalEntry()->with('lines')->first();
        $this->assertEquals('posted', $entry->status);
        $this->assertCount(3, $entry->lines);
        $this->assertEquals(115000, $entry->lines->sum('debit'));
        $this->assertEquals(115000, $entry->lines->sum('credit'));

        // الأرصدة: الصندوق مدين 1150، المبيعات دائن 1000، الضريبة دائن 150
        $this->assertEquals(115000, Account::where('code', '1110')->first()->balance->balance);
        $this->assertEquals(100000, Account::where('code', '4110')->first()->balance->balance);
        $this->assertEquals(15000,  Account::where('code', '2120')->first()->balance->balance);

        // لا حركة على حساب العملاء (بيع نقدي)
        $this->assertNull(Account::where('code', '1130')->first()->balance);
    }

    /** @test */
    public function it_posts_a_credit_sale_to_receivables(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]] // 2000 + 300 = 2300
        );

        $posted = $this->invoices->post($invoice);

        // العملاء (1130) مدين بالإجمالي، لا حركة على الصندوق
        $this->assertEquals(230000, Account::where('code', '1130')->first()->balance->balance);
        $this->assertNull(Account::where('code', '1110')->first()->balance);

        // سطر العملاء مربوط بالطرف
        $entry = $posted->journalEntry()->with('lines')->first();
        $arLine = $entry->lines->firstWhere('debit', 230000);
        $this->assertEquals(Partner::class, $arLine->partner_type);
        $this->assertEquals($this->customer->id, $arLine->partner_id);
    }

    /** @test */
    public function it_rejects_posting_an_already_posted_invoice(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id],
            [['quantity' => 1, 'unit_price' => 100000]]
        );
        $this->invoices->post($invoice);

        $this->expectExceptionMessage('غير مسوّدة');
        $this->invoices->post($invoice->fresh());
    }

    /** @test */
    public function it_rejects_an_invoice_without_lines(): void
    {
        $this->expectExceptionMessage('سطر واحد على الأقل');
        $this->invoices->create(['partner_id' => $this->customer->id], []);
    }
}
