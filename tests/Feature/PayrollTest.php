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

    private function employee(int $basic, int $allowances = 0, bool $active = true): Employee
    {
        return Employee::create([
            'employee_no'  => 'EMP-' . str_pad((string) (Employee::count() + 1), 5, '0', STR_PAD_LEFT),
            'name'         => 'موظف',
            'basic_salary' => $basic,
            'allowances'   => $allowances,
            'is_active'    => $active,
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
