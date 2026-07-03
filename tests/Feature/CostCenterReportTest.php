<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CostCenter;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\ExpenseService;
use App\Services\Accounting\InvoiceService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * تقرير الربحية بمركز التكلفة: إيراد الفواتير الموسومة − مصروفات الموسومة = الربح.
 * تشغيل: php artisan test --filter=CostCenterReportTest
 */
class CostCenterReportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'نبراس', 'slug' => 'nibras', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
    }

    /** @test */
    public function it_computes_profit_per_cost_center_from_tagged_entries(): void
    {
        $cc = CostCenter::create(['code' => 'CC-DMM', 'name' => 'فرع الدمام']);
        $other = CostCenter::create(['code' => 'CC-KHB', 'name' => 'فرع الخبر']); // بلا حركة
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $expenseAccount = Account::where('code', '5130')->firstOrFail()->id; // الإيجار

        // فاتورة نقدية 1000 + 15% موسومة بالمركز → إيراد صافٍ 1000 (100000)
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'cash', 'cost_center_id' => $cc->id],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        app(InvoiceService::class)->post($invoice);

        // مصروف 300 موسوم بالمركز → مصروف 30000
        $expense = app(ExpenseService::class)->create([
            'account_id' => $expenseAccount, 'amount' => 30000, 'tax_rate' => 0, 'cost_center_id' => $cc->id,
        ]);
        app(ExpenseService::class)->post($expense);

        $report = app(ReportService::class)->costCenterProfitability();

        $row = collect($report['rows'])->firstWhere('cost_center_id', $cc->id);
        $this->assertSame(100000, $row['revenue']);
        $this->assertSame(30000,  $row['expense']);
        $this->assertSame(70000,  $row['profit']);

        // المركز الآخر بلا حركة = أصفار
        $empty = collect($report['rows'])->firstWhere('cost_center_id', $other->id);
        $this->assertSame(0, $empty['profit']);

        // الإجماليات
        $this->assertSame(100000, $report['total_revenue']);
        $this->assertSame(30000,  $report['total_expense']);
        $this->assertSame(70000,  $report['total_profit']);
    }

    /** @test */
    public function the_report_endpoint_returns_riyal_formatted_rows(): void
    {
        $auth = $this->registerTenant('acme', 'owner@acme.test');

        $this->withToken($auth['token'])->postJson('/api/cost-centers', ['code' => 'CC-01', 'name' => 'فرع'])->assertCreated();

        $this->withToken($auth['token'])->getJson('/api/reports/cost-center-profitability')
            ->assertOk()
            ->assertJsonStructure(['rows' => [['code', 'name', 'revenue', 'expense', 'profit']], 'total_revenue', 'total_expense', 'total_profit']);
    }
}
