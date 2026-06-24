<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Employee;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\PayrollRun;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\PayrollService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات وحدة الرواتب (HR) — تثبت أن مسيّر الرواتب يولّد قيدين متوازنين:
 *   - الاستحقاق:  مدين 5120 الرواتب / دائن 2130 رواتب مستحقة
 *   - الصرف:      مدين 2130 / دائن 1110|1120
 * مع اشتقاق الإجماليات من السطور والربط بالمصدر PayrollRun.
 * تشغيل:  php artisan test --filter=PayrollTest
 */
class PayrollTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected PayrollService $payroll;

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

        $this->payroll = app(PayrollService::class);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    private function employee(int $basic, int $allowances = 0, bool $active = true, int $gosi = 0, int $other = 0): Employee
    {
        return Employee::create([
            'employee_no'      => 'EMP-' . str_pad((string) (Employee::count() + 1), 5, '0', STR_PAD_LEFT),
            'name'             => 'موظف',
            'basic_salary'     => $basic,
            'allowances'       => $allowances,
            'gosi'             => $gosi,
            'other_deductions' => $other,
            'is_active'        => $active,
        ]);
    }

    /** @test */
    public function it_creates_a_draft_run_with_totals_derived_from_active_employees(): void
    {
        $this->employee(500000, 100000); // gross 600000
        $this->employee(400000);         // gross 400000

        $run = $this->payroll->create(['period' => '2025-06']);

        $this->assertTrue($run->isDraft());
        $this->assertCount(2, $run->items);
        $this->assertSame(1000000, $run->total_gross);
        $this->assertSame(1000000, $run->total_net); // net = gross في هذا الإصدار
        $this->assertNull($run->journal_entry_id);
    }

    /** @test */
    public function inactive_employees_are_excluded_from_the_run(): void
    {
        $this->employee(500000, 0, true);
        $this->employee(900000, 0, false); // غير نشط — يُستبعد

        $run = $this->payroll->create(['period' => '2025-06']);

        $this->assertCount(1, $run->items);
        $this->assertSame(500000, $run->total_gross);
    }

    /** @test */
    public function accrual_entry_is_balanced_debits_5120_credits_2130_and_links_to_run(): void
    {
        $this->employee(500000, 100000); // gross 600000

        $run = $this->payroll->create(['period' => '2025-06']);
        $posted = $this->payroll->post($run);

        $entry = JournalEntry::with('lines.account')
            ->where('source_type', PayrollRun::class)
            ->where('source_id', $posted->id)
            ->firstOrFail();

        // (د) الربط بالمصدر
        $this->assertSame($posted->id, $entry->source_id);
        $this->assertSame(PayrollRun::class, $entry->source_type);

        // (أ) التوازن
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(600000, $entry->lines->sum('debit'));

        // (ب) الحسابات: مدين 5120 الرواتب، دائن 2130 رواتب مستحقة
        $this->assertEquals(600000, $this->line($entry, '5120')->debit);
        $this->assertEquals(600000, $this->line($entry, '2130')->credit);

        // (ج) الإجماليات مشتقة من السطور
        $this->assertEquals($posted->items->sum('gross'), $entry->lines->sum('debit'));

        $this->assertTrue($posted->isPosted());
    }

    /** @test */
    public function deductions_reduce_net_and_credit_2140_gosi_and_2150_other(): void
    {
        // أساسي 500000 + بدلات 100000 = 600000، GOSI 58500، سُلف 41500 → صافي 500000
        $this->employee(500000, 100000, true, 58500, 41500);

        $run = $this->payroll->create(['period' => '2025-06']);
        $this->assertSame(600000, $run->total_gross);
        $this->assertSame(58500, $run->total_gosi);
        $this->assertSame(41500, $run->total_other_deductions);
        $this->assertSame(500000, $run->total_net);

        $posted = $this->payroll->post($run);
        $entry = $posted->journalEntry()->with('lines.account')->first();

        // متوازن: مدين 600000 = دائن (500000 + 58500 + 41500)
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(600000, $entry->lines->sum('debit'));

        $this->assertEquals(600000, $this->line($entry, '5120')->debit);  // الإجمالي مصروف
        $this->assertEquals(500000, $this->line($entry, '2130')->credit); // الصافي للموظفين
        $this->assertEquals(58500,  $this->line($entry, '2140')->credit); // GOSI
        $this->assertEquals(41500,  $this->line($entry, '2150')->credit); // استقطاعات أخرى
    }

    /** @test */
    public function paying_settles_only_net_leaving_deduction_liabilities_outstanding(): void
    {
        $this->employee(600000, 0, true, 60000, 40000); // صافي 500000، خصوم 100000

        $run = $this->payroll->post($this->payroll->create(['period' => '2025-06']));
        $this->payroll->pay($run, 'bank');

        // الصرف بالصافي فقط (البنك أصل: دائن 500000 ⇒ رصيد −500000)
        $this->assertEquals(-500000, Account::where('code', '1120')->first()->balance->balance);
        // 2130 رواتب مستحقة = صفر بعد الصرف، لكن 2140/2150 تبقى مستحقة
        $this->assertEquals(0,     Account::where('code', '2130')->first()->balance->balance);
        $this->assertEquals(60000, Account::where('code', '2140')->first()->balance->balance);
        $this->assertEquals(40000, Account::where('code', '2150')->first()->balance->balance);

        $tb = app(ReportService::class)->trialBalance();
        $this->assertTrue($tb['balanced']);
    }

    /** @test */
    public function it_rejects_an_employee_whose_deductions_exceed_gross(): void
    {
        $this->employee(100000, 0, true, 80000, 50000); // خصوم 130000 > 100000

        $this->expectExceptionMessage('تتجاوز إجمالي راتبه');
        $this->payroll->create(['period' => '2025-06']);
    }

    /** @test */
    public function paying_by_bank_debits_2130_and_credits_1120(): void
    {
        $this->employee(700000);

        $run = $this->payroll->post($this->payroll->create(['period' => '2025-06']));
        $paid = $this->payroll->pay($run, 'bank');

        $entry = $paid->paymentJournalEntry()->with('lines.account')->first();

        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(700000, $this->line($entry, '2130')->debit);  // إقفال الاستحقاق
        $this->assertEquals(700000, $this->line($entry, '1120')->credit); // البنك
        $this->assertNull($this->line($entry, '1110'));                   // لا صندوق
        $this->assertTrue($paid->isPaid());
        $this->assertSame('bank', $paid->pay_method);
    }

    /** @test */
    public function paying_by_cash_credits_1110_not_1120(): void
    {
        $this->employee(300000);

        $run = $this->payroll->post($this->payroll->create(['period' => '2025-06']));
        $paid = $this->payroll->pay($run, 'cash');

        $entry = $paid->paymentJournalEntry()->with('lines.account')->first();
        $this->assertEquals(300000, $this->line($entry, '1110')->credit); // الصندوق
        $this->assertNull($this->line($entry, '1120'));                   // لا بنك
    }

    /** @test */
    public function totals_are_derived_from_items_even_if_the_header_is_tampered(): void
    {
        $this->employee(500000, 100000); // gross 600000

        $run = $this->payroll->create(['period' => '2025-06']);
        $run->update(['total_gross' => 1, 'total_net' => 999999]); // عبث

        $posted = $this->payroll->post($run->fresh());

        $this->assertSame(600000, $posted->total_gross);
        $this->assertSame(600000, $posted->total_net);

        $entry = $posted->journalEntry()->with('lines')->first();
        $this->assertEquals(600000, $entry->lines->sum('debit'));
        $this->assertEquals(600000, $entry->lines->sum('credit'));
    }

    /** @test */
    public function books_stay_balanced_after_accrual_and_payment(): void
    {
        $this->employee(500000, 100000);

        $run = $this->payroll->post($this->payroll->create(['period' => '2025-06']));
        $this->payroll->pay($run, 'bank');

        $tb = app(ReportService::class)->trialBalance();
        $this->assertTrue($tb['balanced']);
        $this->assertEquals($tb['total_debit'], $tb['total_credit']);

        // بعد الاستحقاق ثم الصرف: رصيد 2130 رواتب مستحقة = صفر
        $this->assertEquals(0, Account::where('code', '2130')->first()->balance->balance);
    }

    /** @test */
    public function it_rejects_posting_an_already_posted_run(): void
    {
        $this->employee(300000);
        $run = $this->payroll->post($this->payroll->create(['period' => '2025-06']));

        $this->expectExceptionMessage('غير مسوّد');
        $this->payroll->post($run->fresh());
    }

    /** @test */
    public function it_rejects_paying_a_run_that_is_not_posted(): void
    {
        $this->employee(300000);
        $run = $this->payroll->create(['period' => '2025-06']);

        $this->expectExceptionMessage('لم يُرحَّل');
        $this->payroll->pay($run, 'bank');
    }

    /** @test */
    public function it_rejects_a_run_with_no_active_employees(): void
    {
        $this->employee(300000, 0, false); // الوحيد وغير نشط

        $this->expectExceptionMessage('لا يوجد موظفون نشطون');
        $this->payroll->create(['period' => '2025-06']);
    }
}
