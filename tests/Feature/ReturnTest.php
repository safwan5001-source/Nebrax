<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\PurchaseService;
use App\Services\Accounting\ReturnService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات المرتجعات — مبيعات (إشعار دائن) ومشتريات (إشعار مدين).
 * تثبت أن القيد العكسي متوازن، يستخدم الحسابات الصحيحة، إجمالياته مشتقة،
 * ومربوط بمصدره، وأن المخزون يُعالَج صحيحاً.
 * تشغيل:  php artisan test --filter=ReturnTest
 */
class ReturnTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected Partner $supplier;
    protected ReturnService $returns;

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
        $this->returns  = app(ReturnService::class);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    private function bal(string $code): int
    {
        return Account::where('code', $code)->first()->balance?->balance ?? 0;
    }

    // ───────────────────────── مرتجع المبيعات ─────────────────────────

    /** @test */
    public function sales_return_reverses_revenue_vat_receivable_and_restocks_with_cogs(): void
    {
        $product = Product::create([
            'name' => 'بضاعة', 'track_inventory' => true, 'quantity_on_hand' => 10, 'avg_cost' => 4000,
        ]);

        $return = $this->returns->create(
            ['type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]] // 230000
        );
        $posted = $this->returns->post($return);

        // القيد الرئيسي: مدين 4110 + 2120 / دائن 1130 — متوازن ومربوط بالمصدر
        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $this->assertSame($posted->id, $entry->source_id);
        $this->assertSame(ReturnDocument::class, $entry->source_type);
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(200000, $this->line($entry, '4110')->debit);  // عكس الإيراد
        $this->assertEquals(30000,  $this->line($entry, '2120')->debit);  // عكس ضريبة المخرجات
        $this->assertEquals(230000, $this->line($entry, '1130')->credit); // تخفيض ذمم العميل
        $this->assertEquals($this->customer->id, $this->line($entry, '1130')->partner_id);

        // (ج) الإجماليات مشتقة من السطور
        $this->assertEquals($posted->lines->sum('line_total'), $entry->lines->sum('credit'));

        // قيد عكس التكلفة: مدين 1140 / دائن 5110 بالتكلفة (2×4000)
        $cogs = JournalEntry::with('lines.account')->findOrFail($posted->cogs_entry_id);
        $this->assertEquals(8000, $this->line($cogs, '1140')->debit);
        $this->assertEquals(8000, $this->line($cogs, '5110')->credit);

        // المخزون عاد للزيادة
        $this->assertSame(12, $product->fresh()->quantity_on_hand);
    }

    /** @test */
    public function cash_sales_return_credits_cash_not_receivables(): void
    {
        $return = $this->returns->create(
            ['type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 115000
        );
        $posted = $this->returns->post($return);

        $entry = $posted->journalEntry()->with('lines.account')->first();
        $this->assertEquals(115000, $this->line($entry, '1110')->credit); // رد نقدي
        $this->assertNull($this->line($entry, '1130'));
    }

    /** @test */
    public function non_tracked_sales_return_generates_no_cogs_entry(): void
    {
        $service = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false]);

        $return = $this->returns->create(
            ['type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['product_id' => $service->id, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $posted = $this->returns->post($return);

        $this->assertNull($posted->cogs_entry_id);
        $this->assertEquals(0, $this->bal('5110'));
    }

    // ───────────────────────── مرتجع المشتريات ─────────────────────────

    /** @test */
    public function purchase_return_reverses_inventory_input_vat_and_payable(): void
    {
        $product = Product::create(['name' => 'بضاعة', 'track_inventory' => true]);

        // شراء آجل 10×4000 (+15%) — يبني المخزون والذمم الدائنة
        $purchase = app(PurchaseService::class)->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 10, 'unit_price' => 4000, 'tax_rate' => 15]]
        );
        app(PurchaseService::class)->post($purchase);
        $this->assertEquals(46000, $this->bal('2110'));
        $this->assertEquals(40000, $this->bal('1140'));

        // مرتجع مشتريات 2×4000
        $return = $this->returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 4000, 'tax_rate' => 15]] // 9200
        );
        $posted = $this->returns->post($return);

        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $this->assertSame($posted->id, $entry->source_id);
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(9200, $this->line($entry, '2110')->debit);   // تخفيض الذمم الدائنة
        $this->assertEquals($this->supplier->id, $this->line($entry, '2110')->partner_id);
        $this->assertEquals(8000, $this->line($entry, '1140')->credit);  // إخراج المخزون
        $this->assertEquals(1200, $this->line($entry, '1150')->credit);  // عكس ضريبة المدخلات

        // الأرصدة بعد المرتجع
        $this->assertEquals(36800, $this->bal('2110')); // 46000 − 9200
        $this->assertEquals(32000, $this->bal('1140')); // 40000 − 8000
        $this->assertEquals(4800,  $this->bal('1150')); // 6000 − 1200

        // المخزون نقص
        $this->assertSame(8, $product->fresh()->quantity_on_hand);
    }

    /** @test */
    public function cash_purchase_return_debits_cash_not_payables(): void
    {
        $product = Product::create(['name' => 'بضاعة', 'track_inventory' => true, 'quantity_on_hand' => 10, 'avg_cost' => 4000]);

        $return = $this->returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 4000, 'tax_rate' => 15]]
        );
        $posted = $this->returns->post($return);

        $entry = $posted->journalEntry()->with('lines.account')->first();
        $this->assertEquals(9200, $this->line($entry, '1110')->debit); // استرداد نقدي
        $this->assertNull($this->line($entry, '2110'));
    }

    /** @test */
    public function non_tracked_purchase_return_credits_expense_not_inventory(): void
    {
        $service = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false]);

        $return = $this->returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $service->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]]
        );
        $posted = $this->returns->post($return);

        $entry = $posted->journalEntry()->with('lines.account')->first();
        $this->assertEquals(20000, $this->line($entry, '5150')->credit); // عكس المصروف
        $this->assertNull($this->line($entry, '1140'));
    }

    // ───────────────────────── عامة ─────────────────────────

    /** @test */
    public function totals_are_derived_from_lines_even_if_the_header_is_tampered(): void
    {
        $return = $this->returns->create(
            ['type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $return->update(['subtotal' => 1, 'tax_amount' => 1, 'total' => 999999]);

        $posted = $this->returns->post($return->fresh());

        $this->assertSame(100000, $posted->subtotal);
        $this->assertSame(15000,  $posted->tax_amount);
        $this->assertSame(115000, $posted->total);

        $entry = $posted->journalEntry()->with('lines')->first();
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(115000, $entry->lines->sum('debit'));
    }

    /** @test */
    public function books_stay_balanced_after_returns(): void
    {
        $this->returns->post($this->returns->create(
            ['type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        ));

        $tb = app(ReportService::class)->trialBalance();
        $this->assertTrue($tb['balanced']);
        $this->assertEquals($tb['total_debit'], $tb['total_credit']);
    }

    /** @test */
    public function it_rejects_an_invalid_return_type(): void
    {
        $this->expectExceptionMessage("نوع المرتجع");
        $this->returns->create(
            ['type' => 'foo', 'partner_id' => $this->customer->id],
            [['quantity' => 1, 'unit_price' => 1000]]
        );
    }

    /** @test */
    public function it_rejects_posting_an_already_posted_return(): void
    {
        $return = $this->returns->create(
            ['type' => 'sales', 'partner_id' => $this->customer->id],
            [['quantity' => 1, 'unit_price' => 100000]]
        );
        $this->returns->post($return);

        $this->expectExceptionMessage('غير مسوّد');
        $this->returns->post($return->fresh());
    }

    /** @test */
    public function it_rejects_a_return_without_lines(): void
    {
        $this->expectExceptionMessage('سطر واحد على الأقل');
        $this->returns->create(['type' => 'sales', 'partner_id' => $this->customer->id], []);
    }
}
