<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\PurchaseService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات وحدة المشتريات — تثبت أن فاتورة المشتريات تولّد قيداً متوازناً
 * صحيحاً (مدين 1140/5150 + 1150، دائن 2110/1110) وتُدخِل البضاعة للمخزون.
 * تشغيل:  php artisan test --filter=PurchaseTest
 */
class PurchaseTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $supplier;
    protected PurchaseService $purchases;

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

        $this->supplier  = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->purchases = app(PurchaseService::class);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    private function trackedProduct(): Product
    {
        return Product::create(['name' => 'بضاعة', 'sale_price' => 10000, 'track_inventory' => true]);
    }

    /** @test */
    public function it_creates_a_draft_purchase_with_computed_totals(): void
    {
        $purchase = $this->purchases->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['quantity' => 10, 'unit_price' => 4000, 'tax_rate' => 15]] // 40000 + 6000 = 46000
        );

        $this->assertTrue($purchase->isDraft());
        $this->assertSame(40000, $purchase->subtotal);
        $this->assertSame(6000,  $purchase->tax_amount);
        $this->assertSame(46000, $purchase->total);
        $this->assertNull($purchase->journal_entry_id);
    }

    /** @test */
    public function credit_purchase_entry_is_balanced_uses_1140_1150_2110_and_links_to_purchase(): void
    {
        $product = $this->trackedProduct();

        $purchase = $this->purchases->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 10, 'unit_price' => 4000, 'tax_rate' => 15]]
        );
        $posted = $this->purchases->post($purchase);

        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Purchase::class)
            ->where('source_id', $posted->id)
            ->firstOrFail();

        // (د) الربط بالمصدر
        $this->assertSame($posted->id, $entry->source_id);
        $this->assertSame(Purchase::class, $entry->source_type);

        // (أ) التوازن
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(46000, $entry->lines->sum('debit'));

        // (ب) الحسابات: مدين 1140 المخزون + 1150 الضريبة، دائن 2110 الموردون
        $this->assertEquals(40000, $this->line($entry, '1140')->debit);
        $this->assertEquals(6000,  $this->line($entry, '1150')->debit);
        $this->assertEquals(46000, $this->line($entry, '2110')->credit);
        $this->assertEquals($this->supplier->id, $this->line($entry, '2110')->partner_id);

        // (ج) الإجماليات مشتقة من السطور
        $this->assertEquals($posted->lines->sum('line_total'), $entry->lines->sum('debit'));
    }

    /** @test */
    public function cash_purchase_credits_the_cash_account_not_payables(): void
    {
        $product = $this->trackedProduct();

        $purchase = $this->purchases->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 5, 'unit_price' => 4000, 'tax_rate' => 15]] // 23000
        );
        $posted = $this->purchases->post($purchase);

        $entry = $posted->journalEntry()->with('lines.account')->first();
        $this->assertEquals(23000, $this->line($entry, '1110')->credit); // الصندوق
        $this->assertNull($this->line($entry, '2110'));                  // لا موردون
    }

    /** @test */
    public function posting_a_purchase_receives_tracked_stock_at_cost(): void
    {
        $product = $this->trackedProduct();

        $purchase = $this->purchases->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 10, 'unit_price' => 4000, 'tax_rate' => 15]]
        );
        $this->purchases->post($purchase);

        $product->refresh();
        $this->assertSame(10, $product->quantity_on_hand);
        $this->assertSame(4000, $product->avg_cost);

        // رصيد المخزون 1140 = 40000 (مرة واحدة فقط — لا ازدواج قيد)
        $this->assertEquals(40000, Account::where('code', '1140')->first()->balance->balance);
        $this->assertSame(1, $product->movements()->count()); // حركة استلام واحدة
    }

    /** @test */
    public function non_tracked_line_goes_to_expense_not_inventory(): void
    {
        $service = Product::create(['name' => 'خدمة شحن', 'type' => 'service', 'track_inventory' => false]);

        $purchase = $this->purchases->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $service->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]] // 23000
        );
        $posted = $this->purchases->post($purchase);

        $entry = $posted->journalEntry()->with('lines.account')->first();
        $this->assertEquals(20000, $this->line($entry, '5150')->debit); // مصروف
        $this->assertNull($this->line($entry, '1140'));                 // لا مخزون
        $this->assertEquals(3000, $this->line($entry, '1150')->debit);  // ضريبة مدخلات
        $this->assertSame(0, $service->fresh()->quantity_on_hand);
    }

    /** @test */
    public function totals_are_derived_from_lines_even_if_the_header_is_tampered(): void
    {
        $product = $this->trackedProduct();

        $purchase = $this->purchases->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 10, 'unit_price' => 4000, 'tax_rate' => 15]]
        );

        $purchase->update(['subtotal' => 1, 'tax_amount' => 1, 'total' => 999999]); // عبث

        $posted = $this->purchases->post($purchase->fresh());

        $this->assertSame(40000, $posted->subtotal);
        $this->assertSame(6000,  $posted->tax_amount);
        $this->assertSame(46000, $posted->total);

        $entry = $posted->journalEntry()->with('lines')->first();
        $this->assertEquals(46000, $entry->lines->sum('debit'));
        $this->assertEquals(46000, $entry->lines->sum('credit'));
    }

    /** @test */
    public function books_stay_balanced_after_a_purchase(): void
    {
        $product = $this->trackedProduct();
        $purchase = $this->purchases->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 10, 'unit_price' => 4000, 'tax_rate' => 15]]
        );
        $this->purchases->post($purchase);

        $tb = app(ReportService::class)->trialBalance();
        $this->assertTrue($tb['balanced']);
        $this->assertEquals($tb['total_debit'], $tb['total_credit']);
    }

    /** @test */
    public function it_rejects_posting_an_already_posted_purchase(): void
    {
        $purchase = $this->purchases->create(
            ['partner_id' => $this->supplier->id],
            [['quantity' => 1, 'unit_price' => 4000]]
        );
        $this->purchases->post($purchase);

        $this->expectExceptionMessage('غير مسوّدة');
        $this->purchases->post($purchase->fresh());
    }

    /** @test */
    public function it_rejects_a_purchase_without_lines(): void
    {
        $this->expectExceptionMessage('سطر واحد على الأقل');
        $this->purchases->create(['partner_id' => $this->supplier->id], []);
    }
}
