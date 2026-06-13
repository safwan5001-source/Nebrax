<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات قائمة الدخل والميزانية العمومية.
 * تثبت: صافي الدخل = إيرادات − مصروفات، ومعادلة الميزانية
 * (أصول = خصوم + حقوق ملكية + صافي الدخل).
 * تشغيل:  php artisan test --filter=FinancialStatementsTest
 */
class FinancialStatementsTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected LedgerService $ledger;
    protected ReportService $reports;

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
        $this->ledger   = app(LedgerService::class);
        $this->reports  = app(ReportService::class);
    }

    private function acc(string $code): string
    {
        return Account::where('code', $code)->first()->id;
    }

    /** @test */
    public function income_statement_is_empty_with_no_activity(): void
    {
        $is = $this->reports->incomeStatement();

        $this->assertSame([], $is['revenues']);
        $this->assertSame([], $is['expenses']);
        $this->assertSame(0, $is['net_income']);
    }

    /** @test */
    public function income_statement_computes_net_income(): void
    {
        // مبيعات نقدية 1000 (إيراد)
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        app(InvoiceService::class)->post($invoice);

        // مصروف إيجار 200 (مدين 5130 / دائن 1110)
        $this->ledger->post([
            ['account_id' => $this->acc('5130'), 'debit'  => 20000],
            ['account_id' => $this->acc('1110'), 'credit' => 20000],
        ], ['description' => 'إيجار']);

        $is = $this->reports->incomeStatement();

        $this->assertEquals(100000, $is['total_revenue']);
        $this->assertEquals(20000,  $is['total_expense']);
        $this->assertEquals(80000,  $is['net_income']);

        $rev = collect($is['revenues'])->keyBy('code');
        $exp = collect($is['expenses'])->keyBy('code');
        $this->assertEquals(100000, $rev['4110']['amount']);
        $this->assertEquals(20000,  $exp['5130']['amount']);
    }

    /** @test */
    public function balance_sheet_satisfies_the_accounting_equation(): void
    {
        // 1) ضخ رأس مال 5000 (مدين 1110 / دائن 3110)
        $this->ledger->post([
            ['account_id' => $this->acc('1110'), 'debit'  => 500000],
            ['account_id' => $this->acc('3110'), 'credit' => 500000],
        ], ['description' => 'رأس المال']);

        // 2) مبيعات نقدية 1000 + ضريبة 150 = 1150
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        app(InvoiceService::class)->post($invoice);

        // 3) مصروف إيجار 200
        $this->ledger->post([
            ['account_id' => $this->acc('5130'), 'debit'  => 20000],
            ['account_id' => $this->acc('1110'), 'credit' => 20000],
        ], ['description' => 'إيجار']);

        $bs = $this->reports->balanceSheet();

        // الصندوق = 500000 + 115000 − 20000 = 595000
        $this->assertEquals(595000, $bs['total_assets']);
        $this->assertEquals(15000,  $bs['total_liabilities']); // ضريبة المخرجات
        $this->assertEquals(500000, $bs['total_equity']);      // رأس المال
        $this->assertEquals(80000,  $bs['net_income']);        // 100000 − 20000

        // المعادلة: أصول = خصوم + (حقوق ملكية + صافي الدخل)
        $this->assertEquals(
            $bs['total_assets'],
            $bs['total_liabilities'] + $bs['total_equity_and_income']
        );
        $this->assertTrue($bs['balanced']);
    }

    /** @test */
    public function balance_sheet_is_balanced_and_empty_for_a_new_tenant(): void
    {
        $tenantB = Tenant::create(['name' => 'شركة ثانية', 'slug' => 'other']);
        app(TenantContext::class)->set($tenantB->id);

        $bs = $this->reports->balanceSheet();

        $this->assertSame(0, $bs['total_assets']);
        $this->assertSame(0, $bs['total_liabilities']);
        $this->assertSame(0, $bs['net_income']);
        $this->assertTrue($bs['balanced']);
    }
}
