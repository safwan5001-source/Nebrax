<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Asset;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\LedgerService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * تقارير الحسابات العامة الإضافية: القيود اليومية، التدفق النقدي المباشر، والضريبة.
 * كل الأرقام في الخدمة هللات، وتتحول إلى ريال عند حد API فقط.
 */
class GeneralReportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private Tenant $tenant;
    private LedgerService $ledger;
    private ReportService $reports;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'شركة التقارير',
            'slug' => 'general-reports',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->ledger = app(LedgerService::class);
        $this->reports = app(ReportService::class);
    }

    private function account(string $code): string
    {
        return Account::where('code', $code)->value('id');
    }

    /** @test */
    public function journal_entries_keep_all_lines_when_filtered_by_one_account(): void
    {
        $cash = $this->account('1110');
        $revenue = $this->account('4110');
        $vat = $this->account('2120');

        $this->ledger->post([
            ['account_id' => $cash, 'debit' => 115000],
            ['account_id' => $revenue, 'credit' => 100000],
            ['account_id' => $vat, 'credit' => 15000],
        ], ['description' => 'بيع نقدي', 'entry_date' => '2026-01-15']);

        $report = $this->reports->journalEntries([
            'from' => '2026-01-01',
            'to' => '2026-01-31',
            'account_id' => $cash,
        ]);

        $this->assertCount(1, $report['rows']);
        $this->assertCount(3, $report['rows'][0]['lines']);
        $this->assertSame(115000, $report['rows'][0]['debit']);
        $this->assertSame(115000, $report['rows'][0]['credit']);
        $this->assertSame(115000, $report['total_debit']);
        $this->assertSame(115000, $report['total_credit']);
    }

    /** @test */
    public function direct_cash_flow_classifies_operating_investing_and_financing_without_internal_transfers(): void
    {
        $cash = $this->account('1110');
        $bank = $this->account('1120');
        $capital = $this->account('3110');
        $rent = $this->account('5130');
        $equipment = $this->account('1210');

        // تمويل: ضخ رأس مال في الصندوق.
        $this->ledger->post([
            ['account_id' => $cash, 'debit' => 500000],
            ['account_id' => $capital, 'credit' => 500000],
        ], ['description' => 'ضخ رأس مال', 'entry_date' => '2026-01-10']);
        // تشغيلي: دفع إيجار من الصندوق.
        $this->ledger->post([
            ['account_id' => $rent, 'debit' => 20000],
            ['account_id' => $cash, 'credit' => 20000],
        ], ['description' => 'إيجار', 'entry_date' => '2026-01-11']);
        // استثماري: شراء أصل ثابت نقداً.
        $this->ledger->post([
            ['account_id' => $equipment, 'debit' => 100000],
            ['account_id' => $cash, 'credit' => 100000],
        ], [
            'description' => 'شراء معدات',
            'entry_date' => '2026-01-12',
            'source_type' => Asset::class,
            'source_id' => (string) Str::uuid(),
        ]);
        // تحويل داخلي: لا يظهر كتدفق للمنشأة.
        $this->ledger->post([
            ['account_id' => $bank, 'debit' => 50000],
            ['account_id' => $cash, 'credit' => 50000],
        ], ['description' => 'تحويل داخلي', 'entry_date' => '2026-01-13']);

        $flow = $this->reports->cashFlow(['from' => '2026-01-01', 'to' => '2026-01-31']);

        $this->assertSame(500000, $flow['financing']['inflows']);
        $this->assertSame(500000, $flow['financing']['net']);
        $this->assertSame(20000, $flow['operating']['outflows']);
        $this->assertSame(-20000, $flow['operating']['net']);
        $this->assertSame(100000, $flow['investing']['outflows']);
        $this->assertSame(-100000, $flow['investing']['net']);
        $this->assertSame(380000, $flow['net_cash_flow']);
        $this->assertCount(1, $flow['financing']['entries']);
        $this->assertCount(1, $flow['operating']['entries']);
        $this->assertCount(1, $flow['investing']['entries']);
    }

    /** @test */
    public function tax_report_uses_only_posted_vat_account_movements(): void
    {
        $cash = $this->account('1110');
        $revenue = $this->account('4110');
        $vatOutput = $this->account('2120');
        $vatInput = $this->account('1150');
        $inventory = $this->account('1140');

        $this->ledger->post([
            ['account_id' => $cash, 'debit' => 115000],
            ['account_id' => $revenue, 'credit' => 100000],
            ['account_id' => $vatOutput, 'credit' => 15000],
        ], ['description' => 'بيع خاضع للضريبة', 'entry_date' => '2026-02-02']);
        $this->ledger->post([
            ['account_id' => $inventory, 'debit' => 50000],
            ['account_id' => $vatInput, 'debit' => 7500],
            ['account_id' => $cash, 'credit' => 57500],
        ], ['description' => 'شراء خاضع للضريبة', 'entry_date' => '2026-02-03']);

        $tax = $this->reports->taxReport(['from' => '2026-02-01', 'to' => '2026-02-28']);

        $this->assertSame(7500, $tax['input_vat']);
        $this->assertSame(15000, $tax['output_vat']);
        $this->assertSame(7500, $tax['net_vat']);
        $this->assertSame('payable', $tax['status']);
    }

    /** @test */
    public function new_general_report_endpoints_require_authentication_and_validate_dates(): void
    {
        $this->getJson('/api/reports/journal-entries')->assertUnauthorized();
        $token = $this->registerTenant()['token'];

        $this->withToken($token)
            ->getJson('/api/reports/cash-flow?from=2026-02-01&to=2026-01-01')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['to']);

        $this->withToken($token)
            ->getJson('/api/reports/tax-report')
            ->assertOk()
            ->assertJsonPath('net_vat', '0.00');
    }
}
