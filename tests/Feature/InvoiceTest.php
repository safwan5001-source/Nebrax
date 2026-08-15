<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\PrintTemplates\PrintTemplateService;
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

    /** سطر القيد حسب كود الحساب (يتطلب تحميل lines.account). */
    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    /** @test */
    public function cash_sale_entry_is_balanced_uses_correct_accounts_and_links_to_invoice(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 1150
        );
        $posted = $this->invoices->post($invoice);

        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)
            ->where('source_id', $posted->id)
            ->firstOrFail();

        // (د) القيد مربوط بمصدره
        $this->assertSame($posted->id, $entry->source_id);
        $this->assertSame(Invoice::class, $entry->source_type);

        // (أ) Σ مدين = Σ دائن
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(115000, $entry->lines->sum('debit'));

        // (ب) الحسابات الصحيحة: نقدي يمدِّن 1110، الإيراد يُدائن 4110، الضريبة تُدائن 2120
        $this->assertEquals(115000, $this->line($entry, '1110')->debit);
        $this->assertEquals(100000, $this->line($entry, '4110')->credit);
        $this->assertEquals(15000,  $this->line($entry, '2120')->credit);
        $this->assertNull($this->line($entry, '1130')); // لا عملاء في البيع النقدي

        // (ج) الإجماليات مشتقة من السطور
        $this->assertEquals($posted->lines->sum('line_total'), $entry->lines->sum('debit'));
        $this->assertSame($posted->total, $posted->subtotal + $posted->tax_amount);
    }

    /** @test */
    public function posting_an_invoice_freezes_the_published_print_template_revision(): void
    {
        $templates = app(PrintTemplateService::class);
        $template = $templates->create([
            'name' => 'قالب فاتورة ثابت',
            'document_types' => ['tax_invoice'],
            'definition' => ['template_id' => 'tax-invoice-classic', 'theme_id' => 'blue'],
        ], null);
        $template = $templates->publish($template);
        $templates->assign([
            'document_type' => 'tax_invoice',
            'usage' => 'print',
            'print_template_revision_id' => $template->published_revision_id,
        ], null);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $posted = $this->invoices->post($invoice);

        $frozenRevisionId = $template->published_revision_id;
        $this->assertSame($frozenRevisionId, $posted->print_template_revision_id);

        $templates->updateDraft($template, [
            'definition' => ['template_id' => 'tax-invoice-modern', 'theme_id' => 'violet'],
        ], null);
        $newlyPublished = $templates->publish($template);

        $frozenInvoice = Invoice::with('printTemplateRevision')->findOrFail($posted->id);
        $this->assertSame($frozenRevisionId, $frozenInvoice->print_template_revision_id);
        $this->assertSame('tax-invoice-classic', $frozenInvoice->printTemplateRevision?->definition['template_id']);
        $this->assertNotSame($frozenRevisionId, $newlyPublished->published_revision_id);
    }

    /** @test */
    public function credit_sale_entry_is_balanced_uses_1130_and_links_to_invoice(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]] // 2300
        );
        $posted = $this->invoices->post($invoice);

        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)
            ->where('source_id', $posted->id)
            ->firstOrFail();

        // (د) الربط بالمصدر
        $this->assertSame($posted->id, $entry->source_id);

        // (أ) التوازن
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(230000, $entry->lines->sum('debit'));

        // (ب) آجل يمدِّن 1130 (لا 1110)، الإيراد 4110، الضريبة 2120
        $this->assertEquals(230000, $this->line($entry, '1130')->debit);
        $this->assertEquals(200000, $this->line($entry, '4110')->credit);
        $this->assertEquals(30000,  $this->line($entry, '2120')->credit);
        $this->assertNull($this->line($entry, '1110'));

        // (ج) الإجماليات مشتقة من السطور
        $this->assertEquals($posted->lines->sum('line_total'), $entry->lines->sum('debit'));
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
    public function totals_are_derived_from_lines_even_if_the_header_is_tampered(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 1150 صحيحة
        );

        // عبث مباشر بالرأس (محاكاة كسر الثابتة)
        $invoice->update(['subtotal' => 1, 'tax_amount' => 1, 'total' => 999999]);

        $posted = $this->invoices->post($invoice->fresh());

        // الرأس صُحّح من السطور: total = subtotal + tax_amount دائماً
        $this->assertSame(100000, $posted->subtotal);
        $this->assertSame(15000,  $posted->tax_amount);
        $this->assertSame(115000, $posted->total);
        $this->assertSame($posted->total, $posted->subtotal + $posted->tax_amount);

        // والقيد المتولّد متوازن ومطابق للسطور لا للرأس المعبوث
        $entry = $posted->journalEntry()->with('lines')->first();
        $this->assertEquals(115000, $entry->lines->sum('debit'));
        $this->assertEquals(115000, $entry->lines->sum('credit'));
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

    /** @test */
    public function an_invoice_discount_reduces_the_taxable_base_and_totals(): void
    {
        // 1000 + 15% ضريبة، خصم 200 على مستوى الفاتورة → صافي 800، ضريبة 120، إجمالي 920.
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 20000],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        $this->assertSame(100000, $invoice->subtotal);   // إجمالي السطور قبل الخصم
        $this->assertSame(20000,  $invoice->discount);
        $this->assertSame(12000,  $invoice->tax_amount);  // 15% على 800
        $this->assertSame(92000,  $invoice->total);       // 800 + 120
    }

    /** @test */
    public function a_discounted_cash_sale_posts_a_balanced_entry_with_net_revenue(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 20000],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $posted = $this->invoices->post($invoice);

        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)->where('source_id', $posted->id)->firstOrFail();

        // متوازن: مدين 920 = دائن (800 مبيعات + 120 ضريبة)
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(92000, $entry->lines->sum('debit'));
        $this->assertEquals(92000, $this->line($entry, '1110')->debit);  // الصندوق بالإجمالي بعد الخصم
        $this->assertEquals(80000, $this->line($entry, '4110')->credit); // الإيراد الصافي (بعد الخصم)
        $this->assertEquals(12000, $this->line($entry, '2120')->credit); // الضريبة على الصافي
    }

    /** @test */
    public function it_rejects_a_discount_larger_than_the_subtotal(): void
    {
        $this->expectExceptionMessage('الخصم لا يمكن أن يتجاوز');
        $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 150000],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
    }

    /** @test */
    public function a_line_discount_reduces_the_line_taxable_base_and_invoice_totals(): void
    {
        // سطر 1000 بخصم سطر 200 → صافي 800، ضريبة 120، إجمالي 920.
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15, 'discount' => 20000]]
        );

        $line = $invoice->lines->first();
        $this->assertSame(100000, $line->line_subtotal); // قبل الخصم
        $this->assertSame(20000,  $line->line_discount);
        $this->assertSame(12000,  $line->line_tax);       // 15% على 800
        $this->assertSame(92000,  $line->line_total);     // 800 + 120

        $this->assertSame(80000, $invoice->subtotal);     // صافي السطر
        $this->assertSame(12000, $invoice->tax_amount);
        $this->assertSame(92000, $invoice->total);

        $posted = $this->invoices->post($invoice);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)->where('source_id', $posted->id)->firstOrFail();
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(92000, $this->line($entry, '1110')->debit);
        $this->assertEquals(80000, $this->line($entry, '4110')->credit);
        $this->assertEquals(12000, $this->line($entry, '2120')->credit);
    }

    /** @test */
    public function it_rejects_a_line_discount_larger_than_the_line(): void
    {
        $this->expectExceptionMessage('خصم السطر لا يمكن أن يتجاوز');
        $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'discount' => 150000]]
        );
    }

    /** @test */
    public function shipping_adds_taxable_revenue_on_a_separate_account(): void
    {
        // سلع 1000 + 15% + شحن 100 + 15% → إجمالي 1150 + 115 = 1265.
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'shipping' => 10000],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        $this->assertSame(100000, $invoice->subtotal);
        $this->assertSame(10000,  $invoice->shipping);
        $this->assertSame(16500,  $invoice->tax_amount); // 15000 سلع + 1500 شحن
        $this->assertSame(126500, $invoice->total);       // 100000 + 10000 + 16500

        $posted = $this->invoices->post($invoice);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)->where('source_id', $posted->id)->firstOrFail();

        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(126500, $this->line($entry, '1110')->debit);
        $this->assertEquals(100000, $this->line($entry, '4110')->credit); // إيراد السلع
        $this->assertEquals(10000,  $this->line($entry, '4130')->credit); // إيراد الشحن
        $this->assertEquals(16500,  $this->line($entry, '2120')->credit); // إجمالي الضريبة
    }

    /** @test */
    public function a_positive_adjustment_posts_a_gain_and_balances(): void
    {
        // 1000 + 15% = 1150، تسوية +0.17 (تقريب لأعلى) → إجمالي 1150.17.
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'adjustment' => 17],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $this->assertSame(17,     $invoice->adjustment);
        $this->assertSame(115017, $invoice->total);

        $posted = $this->invoices->post($invoice);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)->where('source_id', $posted->id)->firstOrFail();

        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(115017, $this->line($entry, '1110')->debit);   // العميل يدفع المُقرَّب
        $this->assertEquals(17,     $this->line($entry, '5170')->credit);  // فرق التقريب ربح (دائن)
    }

    /** @test */
    public function a_negative_adjustment_posts_a_loss_and_balances(): void
    {
        // 1000 + 15% = 1150، تسوية −0.50 → إجمالي 1149.50.
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'adjustment' => -50],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $this->assertSame(114950, $invoice->total);

        $posted = $this->invoices->post($invoice);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)->where('source_id', $posted->id)->firstOrFail();

        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(114950, $this->line($entry, '1110')->debit);   // العميل يدفع أقل
        $this->assertEquals(50,     $this->line($entry, '5170')->debit);   // فرق التقريب خسارة (مدين)
    }

    /** @test */
    public function an_invoice_stores_the_salesperson(): void
    {
        $emp = \App\Models\Employee::create(['employee_no' => 'EMP-0001', 'name' => 'مندوب', 'job_title' => 'مبيعات']);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'salesperson_id' => $emp->id],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        $this->assertSame($emp->id, $invoice->salesperson_id);
    }

    /** @test */
    public function invoice_revenue_uses_the_products_custom_sales_account(): void
    {
        $salesAccount = Account::where('code', '4120')->firstOrFail(); // إيرادات الخدمات كحساب مبيعات مخصّص
        $product = Product::create(['name' => 'خدمة', 'sale_price' => 100000, 'sales_account_id' => $salesAccount->id]);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $posted = $this->invoices->post($invoice);

        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)->where('source_id', $posted->id)->firstOrFail();

        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(100000, $this->line($entry, '4120')->credit); // الإيراد على الحساب المخصّص
        $this->assertNull($this->line($entry, '4110'));                    // لا على الافتراضي
    }

    /** @test */
    public function posting_an_invoice_tags_the_revenue_line_with_the_cost_center(): void
    {
        $center = \App\Models\CostCenter::create(['code' => 'CC-01', 'name' => 'فرع الدمام']);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'cost_center_id' => $center->id],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $posted = $this->invoices->post($invoice);

        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)->where('source_id', $posted->id)->firstOrFail();

        // سطر الإيراد (4110) موسوم بمركز التكلفة؛ سطرا النقد والضريبة غير موسومين.
        $this->assertSame($center->id, $this->line($entry, '4110')->cost_center_id);
        $this->assertNull($this->line($entry, '1110')->cost_center_id);
        $this->assertNull($this->line($entry, '2120')->cost_center_id);
    }

    /** @test */
    public function a_credit_sale_within_the_customer_credit_limit_posts_normally(): void
    {
        $this->customer->update(['credit_limit' => 200000]); // 2000.00
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // إجمالي 1150 < الحد
        );

        $posted = $this->invoices->post($invoice);

        $this->assertTrue($posted->isPosted());
    }

    /** @test */
    public function a_credit_sale_exceeding_the_customer_credit_limit_is_rejected(): void
    {
        $this->customer->update(['credit_limit' => 100000]); // 1000.00
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 1150 > الحد
        );

        $this->expectException(\RuntimeException::class);
        $this->invoices->post($invoice);
    }

    /** @test */
    public function the_credit_limit_accumulates_with_the_existing_receivable_balance(): void
    {
        $this->customer->update(['credit_limit' => 200000]); // 2000.00

        // فاتورة آجلة أولى (1150) تُبقي الرصيد المتبقّي دون الحد.
        $first = $this->invoices->post($this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        ));
        $this->assertTrue($first->isPosted());

        // فاتورة ثانية مماثلة: 1150 + 1150 = 2300 > 2000 ⇒ تُرفض بالتراكم.
        $second = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $this->expectException(\RuntimeException::class);
        $this->invoices->post($second);
    }

    /** @test */
    public function a_cash_sale_ignores_the_credit_limit(): void
    {
        $this->customer->update(['credit_limit' => 1]); // حد ضئيل جداً
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        $posted = $this->invoices->post($invoice); // نقدي لا يُنشئ ذمّة ⇒ لا يتأثر بالحد
        $this->assertTrue($posted->isPosted());
    }

    /** @test */
    public function a_draft_invoice_can_be_edited_and_totals_recomputed(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 1000 + 150 = 1150
        );
        $this->assertEquals(115000, $invoice->total);

        $updated = $this->invoices->update(
            $invoice,
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]] // 2000 + 300 = 2300
        );

        $this->assertEquals(230000, $updated->total);
        $this->assertEquals('credit', $updated->payment_type);
        $this->assertCount(1, $updated->lines);            // السطر القديم استُبدل (لا تراكم)
        $this->assertTrue($updated->isDraft());
    }

    /** @test */
    public function a_posted_invoice_cannot_be_edited(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $this->invoices->post($invoice);

        $this->expectException(\RuntimeException::class);
        $this->invoices->update(
            $invoice,
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 5, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
    }

    /** @test */
    public function a_draft_invoice_can_be_deleted_with_its_lines(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $id = $invoice->id;

        $this->invoices->deleteDraft($invoice);

        $this->assertNull(Invoice::find($id));
        $this->assertEquals(0, \App\Models\InvoiceLine::where('invoice_id', $id)->count());
    }

    /** @test */
    public function a_posted_invoice_cannot_be_deleted(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $this->invoices->post($invoice);

        $this->expectException(\RuntimeException::class);
        $this->invoices->deleteDraft($invoice);
    }

    /** @test */
    public function tax_inclusive_invoice_extracts_tax_from_the_price(): void
    {
        // سعر متضمِّن 1150.00 عند 15% ⇒ صافي 1000.00، ضريبة 150.00، إجمالي 1150.00 (لا يُضاف فوقه).
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'tax_inclusive' => true],
            [['quantity' => 1, 'unit_price' => 115000, 'tax_rate' => 15]]
        );

        $this->assertTrue($invoice->tax_inclusive);
        $this->assertSame(100000, $invoice->subtotal);   // الصافي مُستخرَج
        $this->assertSame(15000,  $invoice->tax_amount);
        $this->assertSame(115000, $invoice->total);       // = السعر المتضمِّن (لا تُضاف الضريبة فوقه)

        $posted = $this->invoices->post($invoice);

        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)
            ->where('source_id', $posted->id)
            ->firstOrFail();

        // القيد متوازن ويستخرج الضريبة: مدين 1110 = 115000، دائن 4110 = 100000، دائن 2120 = 15000
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(115000, $this->line($entry, '1110')->debit);
        $this->assertEquals(100000, $this->line($entry, '4110')->credit);
        $this->assertEquals(15000,  $this->line($entry, '2120')->credit);
        $this->assertSame($posted->total, $posted->subtotal + $posted->tax_amount);
    }

    /** @test */
    public function tax_inclusive_invoice_with_line_discount_stays_consistent(): void
    {
        // سعر متضمِّن 1150.00 وخصم سطر متضمِّن 115.00 ⇒ بعد الخصم 1035.00 متضمِّن
        // ⇒ ضريبة مُستخرَجة 135.00، صافي 900.00، إجمالي 1035.00.
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit', 'tax_inclusive' => true],
            [['quantity' => 1, 'unit_price' => 115000, 'tax_rate' => 15, 'discount' => 11500]]
        );

        $this->assertSame(90000, $invoice->subtotal);
        $this->assertSame(13500, $invoice->tax_amount);
        $this->assertSame(103500, $invoice->total);

        // السطر: (line_subtotal − line_discount) = الصافي، و line_total = المبلغ المتضمِّن بعد الخصم
        $line = $invoice->lines->first();
        $this->assertSame(90000, (int) $line->line_subtotal - (int) $line->line_discount);
        $this->assertSame(13500, (int) $line->line_tax);
        $this->assertSame(103500, (int) $line->line_total);

        // الترحيل يوازن ويطابق الإجماليات المشتقّة من السطور
        $posted = $this->invoices->post($invoice);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)
            ->where('source_id', $posted->id)
            ->firstOrFail();
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(103500, $this->line($entry, '1130')->debit);
        $this->assertEquals(90000,  $this->line($entry, '4110')->credit);
        $this->assertEquals(13500,  $this->line($entry, '2120')->credit);
    }

    // ═══════════════════════════════════════════════════════════════
    //  «مدفوع بالفعل» — سند قبض مرحَّل، لا اختصار داخل قيد الفاتورة
    // ═══════════════════════════════════════════════════════════════

    /** @test */
    public function a_paid_already_invoice_posts_to_receivables_then_a_receipt_voucher_settles_it(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'is_paid' => true, 'payment_method' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 1150
        );

        // التأشير يفرض الفاتورة آجلة مهما كان المطلوب — وإلا دخل النقد مرتين.
        $this->assertSame('credit', $invoice->payment_type);

        $posted = $this->invoices->post($invoice);

        // (١) قيد الفاتورة: مدين 1130 العملاء (لا 1110).
        $invoiceEntry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)->where('source_id', $posted->id)->firstOrFail();
        $this->assertEquals(115000, $this->line($invoiceEntry, '1130')->debit);
        $this->assertNull($this->line($invoiceEntry, '1110'));

        // (٢) سند قبض حقيقي مرحَّل، مخصَّص لهذه الفاتورة بكامل إجماليها.
        $payment = Payment::where('direction', 'received')->firstOrFail();
        $this->assertSame('posted', $payment->status);
        $this->assertSame(115000, $payment->amount);
        $this->assertSame('cash', $payment->method);
        $this->assertStringStartsWith('REC-', $payment->number);
        $this->assertSame(115000, (int) $payment->allocations()->sum('amount'));

        // (٣) قيد السند: مدين 1110 الصندوق · دائن 1130 — والأثر الصافي كالبيع النقدي.
        $paymentEntry = JournalEntry::with('lines.account')
            ->where('source_type', Payment::class)->where('source_id', $payment->id)->firstOrFail();
        $this->assertEquals($paymentEntry->lines->sum('debit'), $paymentEntry->lines->sum('credit'));
        $this->assertEquals(115000, $this->line($paymentEntry, '1110')->debit);
        $this->assertEquals(115000, $this->line($paymentEntry, '1130')->credit);

        // (٤) حالة السداد صادقة — فلا تظهر الفاتورة في أعمار الديون.
        $fresh = $posted->fresh();
        $this->assertSame(115000, $fresh->paid_amount);
        $this->assertSame('paid', $fresh->payment_status);
    }

    /** @test */
    public function a_transfer_or_card_settlement_debits_the_bank_not_the_cash_box(): void
    {
        $posted = $this->invoices->post($this->invoices->create(
            ['partner_id' => $this->customer->id, 'is_paid' => true, 'payment_method' => 'transfer'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        ));

        $payment = Payment::where('direction', 'received')->firstOrFail();
        $this->assertSame('bank', $payment->method); // تحويل/بطاقة ⇒ بنك (كنقطة البيع)

        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Payment::class)->where('source_id', $payment->id)->firstOrFail();
        $this->assertEquals(115000, $this->line($entry, '1120')->debit);
        $this->assertNull($this->line($entry, '1110'));
        $this->assertSame('paid', $posted->fresh()->payment_status);
    }

    /** @test */
    public function the_chosen_treasury_account_receives_the_collection(): void
    {
        // خزينة ثانية داخل عائلة النقد (111x) — كخزينة معرضٍ مستقلّة.
        $showroom = Account::create([
            'code' => '1111', 'name' => 'خزينة المعرض', 'type' => 'asset',
            'normal_balance' => 'debit', 'is_group' => false,
        ]);

        $posted = $this->invoices->post($this->invoices->create([
            'partner_id'      => $this->customer->id,
            'is_paid'         => true,
            'payment_method'  => 'cash',
            'cash_account_id' => $showroom->id,
        ], [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]));

        $payment = Payment::where('direction', 'received')->firstOrFail();
        $entry   = JournalEntry::with('lines.account')
            ->where('source_type', Payment::class)->where('source_id', $payment->id)->firstOrFail();

        $this->assertEquals(115000, $this->line($entry, '1111')->debit);
        $this->assertNull($this->line($entry, '1110')); // لا الخزينة الافتراضية
        $this->assertSame('paid', $posted->fresh()->payment_status);
    }

    /** @test */
    public function a_treasury_outside_the_cash_family_is_rejected(): void
    {
        $receivable = Account::where('code', '1130')->firstOrFail();

        $invoice = $this->invoices->create([
            'partner_id'      => $this->customer->id,
            'is_paid'         => true,
            'cash_account_id' => $receivable->id, // العملاء ليس خزينة
        ], [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);

        $this->expectException(\RuntimeException::class);
        $this->invoices->post($invoice);
    }

    /** @test */
    public function the_payment_reference_reaches_the_receipt_voucher(): void
    {
        $this->invoices->post($this->invoices->create([
            'partner_id'        => $this->customer->id,
            'is_paid'           => true,
            'payment_method'    => 'transfer',
            'payment_reference' => 'TRF-99120',
        ], [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]));

        $this->assertSame('TRF-99120', Payment::where('direction', 'received')->firstOrFail()->reference);
    }

    /** @test */
    public function an_unchecked_invoice_creates_no_voucher_and_stays_unpaid(): void
    {
        $posted = $this->invoices->post($this->invoices->create(
            ['partner_id' => $this->customer->id], // بلا `is_paid` — الافتراضي
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        ));

        $this->assertFalse($posted->is_paid);
        $this->assertSame(0, Payment::count());
        $this->assertSame(0, $posted->fresh()->paid_amount);
        $this->assertSame('unpaid', $posted->fresh()->payment_status);
    }

    /** @test */
    public function a_paid_already_invoice_ignores_the_credit_limit(): void
    {
        // الفاتورة آجلة شكلاً، لكن سند القبض يقفلها في المعاملة نفسها فأثرها
        // الصافي على الذمم صفر — وحجبُها كان سيمنع بيعاً مسدَّداً نقداً.
        $this->customer->update(['credit_limit' => 1]);

        $posted = $this->invoices->post($this->invoices->create(
            ['partner_id' => $this->customer->id, 'is_paid' => true],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        ));

        $this->assertTrue($posted->isPosted());
        $this->assertSame('paid', $posted->fresh()->payment_status);
    }

    /** @test */
    public function editing_a_draft_keeps_the_settlement_intent_when_it_is_not_sent(): void
    {
        $invoice = $this->invoices->create([
            'partner_id'        => $this->customer->id,
            'is_paid'           => true,
            'payment_method'    => 'card',
            'payment_reference' => 'POS-771',
        ], [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);

        // تعديل لا يمسّ الدفع (كتغيير ملاحظة) لا يُلغي سداداً أُعلن سابقاً.
        $updated = $this->invoices->update(
            $invoice,
            ['partner_id' => $this->customer->id, 'notes' => 'ملاحظة'],
            [['quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        $this->assertTrue($updated->is_paid);
        $this->assertSame('card', $updated->payment_method);
        $this->assertSame('POS-771', $updated->payment_reference);

        // والسداد يتبع الإجمالي الجديد لا القديم (2300 لا 1150).
        $posted = $this->invoices->post($updated);
        $this->assertSame(230000, Payment::where('direction', 'received')->firstOrFail()->amount);
        $this->assertSame('paid', $posted->fresh()->payment_status);
    }

    /** @test */
    public function unchecking_paid_already_on_a_draft_drops_the_settlement(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'is_paid' => true],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        $updated = $this->invoices->update(
            $invoice,
            ['partner_id' => $this->customer->id, 'is_paid' => false],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $posted = $this->invoices->post($updated);

        $this->assertFalse($updated->is_paid);
        $this->assertSame(0, Payment::count());
        $this->assertSame('unpaid', $posted->fresh()->payment_status);
    }

    /** @test */
    public function default_invoice_remains_tax_exclusive(): void
    {
        // بلا الراية: السلوك الافتراضي (الضريبة تُضاف فوق السعر) — توافق رجعي.
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        $this->assertFalse($invoice->tax_inclusive);
        $this->assertSame(100000, $invoice->subtotal);
        $this->assertSame(15000,  $invoice->tax_amount);
        $this->assertSame(115000, $invoice->total); // الضريبة أُضيفت فوق السعر
    }

    // ── هوية السطر في المستند المطبوع ────────────────────────────

    /**
     * سطرٌ بلا وصف يأخذ اسم المنتج — لقطةً كالوحدة تماماً.
     *
     * الوصف `nullable` في العقد والشاشة تملؤه، لكن لعميل الـ API أن يتركه.
     * وبدون هذا الاحتياط يخرج المستند المطبوع بسطرٍ عنوانه «—»: بلا هوية
     * للعميل ولا للمراجع، ولا لشاشة المرتجع التي تسحب سطور الفاتورة.
     * (نظيرُه في `PurchaseService` منذ #190.)
     */
    /** @test */
    public function a_line_without_a_description_takes_the_product_name(): void
    {
        $product = Product::create(['name' => 'كرتون مياه', 'sale_price' => 14000]);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 14000]]
        );

        $this->assertSame('كرتون مياه', $invoice->lines->first()->description);
    }

    /** ووصفٌ مكتوبٌ صراحةً لا يُستبدَل باسم المنتج. */
    /** @test */
    public function an_explicit_description_wins_over_the_product_name(): void
    {
        $product = Product::create(['name' => 'كرتون مياه', 'sale_price' => 14000]);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'description' => 'مياه — دفعة الخبر',
              'quantity' => 1, 'unit_price' => 14000]]
        );

        $this->assertSame('مياه — دفعة الخبر', $invoice->lines->first()->description);
    }

    /** وسطرٌ بلا منتج أصلاً يبقى بلا وصف — لا اسم يُنسَخ منه. */
    /** @test */
    public function a_line_without_a_product_keeps_a_null_description(): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000]]
        );

        $this->assertNull($invoice->lines->first()->description);
    }
}
