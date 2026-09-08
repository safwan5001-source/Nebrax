<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\Branch;
use App\Models\CostCenter;
use App\Models\FiscalYear;
use App\Models\FiscalYearClose;
use App\Models\FiscalYearEvent;
use App\Models\JournalEntry;
use App\Models\Tenant;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\FiscalCloseService;
use App\Services\Accounting\FiscalYearService;
use App\Services\Accounting\LedgerService;
use App\Services\Reporting\ReportService;
use App\Support\AccountingRoles;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * FISCAL-2 — الإقفال السنوي.
 *
 * الإقفال يصفّر حسابات النتيجة مقابل `retained_earnings` (3120 افتراضاً)، ولا
 * يمسّ الأصول ولا الخصوم ولا حقوق الملكية ولا الضريبة، ولا يمحو قائمة الدخل
 * التاريخية، ولا يضاعف صافي الدخل في الميزانية.
 *
 * تشغيل: php artisan test --filter=FiscalYearCloseTest
 */
class FiscalYearCloseTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras-fiscal',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
    }

    // ───────────────────────────── مساعدات ─────────────────────────────

    private function accountId(string $code): string
    {
        return Account::where('code', $code)->firstOrFail()->id;
    }

    private function year(string $start = '2026-01-01', string $end = '2026-12-31', string $name = '2026'): FiscalYear
    {
        $described = app(FiscalYearService::class)->create(
            ['name' => $name, 'start_date' => $start, 'end_date' => $end],
            null,
        );

        return FiscalYear::findOrFail($described['id']);
    }

    /** قيد مبيعات: مدين العملاء / دائن الإيراد. */
    private function revenue(string $date, int $amount, string $revenueCode = '4110'): JournalEntry
    {
        return app(LedgerService::class)->post([
            ['account_id' => $this->accountId('1130'), 'debit' => $amount],
            ['account_id' => $this->accountId($revenueCode), 'credit' => $amount],
        ], ['entry_date' => $date]);
    }

    /** قيد مصروف: مدين المصروف / دائن الموردين. */
    private function expense(string $date, int $amount, string $expenseCode = '5120'): JournalEntry
    {
        return app(LedgerService::class)->post([
            ['account_id' => $this->accountId($expenseCode), 'debit' => $amount],
            ['account_id' => $this->accountId('2110'), 'credit' => $amount],
        ], ['entry_date' => $date]);
    }

    private function close(FiscalYear $year): array
    {
        return app(FiscalCloseService::class)->close($year->id, null);
    }

    private function activeClose(FiscalYear $year): FiscalYearClose
    {
        return $year->closes()->where('status', FiscalYearClose::STATUS_ACTIVE)->firstOrFail();
    }

    private function closeEntry(FiscalYear $year): JournalEntry
    {
        return JournalEntry::with('lines.account')->findOrFail($this->activeClose($year)->journal_entry_id);
    }

    private function lineFor(JournalEntry $entry, string $code): ?\App\Models\JournalLine
    {
        return $entry->lines->first(fn ($line) => $line->account->code === $code);
    }

    private function balanceOf(string $code, array $filters = []): int
    {
        $rows = array_merge(
            app(ReportService::class)->balanceSheet($filters)['assets'],
            app(ReportService::class)->balanceSheet($filters)['liabilities'],
            app(ReportService::class)->balanceSheet($filters)['equity'],
        );

        foreach ($rows as $row) {
            if ($row['code'] === $code) {
                return $row['amount'];
            }
        }

        return 0;
    }

    // ── A. تعريف السنة المالية ──────────────────────────────────────────

    /** @test */
    public function a_calendar_fiscal_year_is_created_open(): void
    {
        $year = $this->year();

        $this->assertSame('open', $year->status);
        $this->assertSame('2026-01-01', $year->start_date->toDateString());
        $this->assertSame('2026-12-31', $year->end_date->toDateString());
        $this->assertSame($this->tenant->id, $year->tenant_id);
    }

    /** @test */
    public function a_non_calendar_fiscal_year_is_supported(): void
    {
        $year = $this->year('2026-04-01', '2027-03-31', 'FY 2026/27');

        $this->assertSame('2026-04-01', $year->start_date->toDateString());
        $this->assertSame('2027-03-31', $year->end_date->toDateString());

        // والإقفال يحترم حدودها لا حدود السنة التقويمية.
        $this->revenue('2027-02-01', 30000);
        $this->revenue('2027-04-05', 90000); // خارج السنة
        $this->close($year);

        $this->assertSame(30000, $this->activeClose($year)->total_revenue);
    }

    /** @test */
    public function overlapping_fiscal_years_are_rejected_and_adjacent_ones_allowed(): void
    {
        $this->year('2026-01-01', '2026-12-31');

        foreach ([
            ['2026-06-01', '2027-05-31'],
            ['2025-06-01', '2026-03-31'],
            ['2026-03-01', '2026-06-30'],
            ['2025-01-01', '2027-12-31'],
            ['2026-12-31', '2027-12-30'],
        ] as [$start, $end]) {
            try {
                $this->year($start, $end, 'x');
                $this->fail("كان يجب رفض التداخل {$start}..{$end}");
            } catch (RuntimeException $e) {
                $this->assertStringContainsString('يتداخل', $e->getMessage());
            }
        }

        // التلاصق مسموح.
        $next = $this->year('2027-01-01', '2027-12-31', '2027');
        $this->assertSame('open', $next->status);
        $this->assertSame(2, FiscalYear::count());
    }

    /** @test */
    public function an_inverted_or_missing_date_range_is_rejected(): void
    {
        $this->assertThrows(fn () => $this->year('2026-12-31', '2026-01-01'), RuntimeException::class);
        $this->assertThrows(
            fn () => app(FiscalYearService::class)->create(['name' => 'x', 'start_date' => '2026-01-01'], null),
            RuntimeException::class,
        );
        $this->assertThrows(
            fn () => app(FiscalYearService::class)->create(['name' => '', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31'], null),
            RuntimeException::class,
        );
    }

    /** @test */
    public function a_closed_years_boundaries_cannot_be_moved(): void
    {
        $year = $this->year();
        $this->revenue('2026-06-01', 50000);
        $this->close($year);

        $this->assertThrows(
            fn () => app(FiscalYearService::class)->update($year->id, ['end_date' => '2026-11-30'], null),
            RuntimeException::class,
        );

        // الاسم وحده يبقى قابلاً للتعديل.
        $renamed = app(FiscalYearService::class)->update($year->id, ['name' => '2026 المعدّلة'], null);
        $this->assertSame('2026 المعدّلة', $renamed['name']);
    }

    // ── B. توجيه الأرباح المرحّلة ────────────────────────────────────────

    /** @test */
    public function the_retained_earnings_role_is_registered_with_3120_as_its_default(): void
    {
        $this->assertTrue(AccountingRoles::exists('retained_earnings'));
        $this->assertSame('3120', AccountingRoles::legacyCodeFor('retained_earnings'));

        $mapping = AccountRoleMapping::where('role_key', 'retained_earnings')->firstOrFail();
        $this->assertSame($this->accountId('3120'), $mapping->account_id);
    }

    /** @test */
    public function the_default_mapping_is_never_the_opening_balances_account(): void
    {
        $mapping = AccountRoleMapping::where('role_key', 'retained_earnings')->firstOrFail();
        $account = Account::findOrFail($mapping->account_id);

        $this->assertNotSame('3130', $account->code);
        $this->assertSame('equity', $account->type);
    }

    /** @test */
    public function a_custom_retained_earnings_mapping_is_used_by_the_close(): void
    {
        $custom = Account::create([
            'tenant_id' => $this->tenant->id, 'code' => '3125', 'name' => 'أرباح مرحّلة مخصصة',
            'type' => 'equity', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true,
        ]);
        app(\App\Services\Accounting\AccountRoutingService::class)->setMapping('retained_earnings', $custom->id, null);

        $year = $this->year();
        $this->revenue('2026-06-01', 50000);
        $this->close($year);

        $entry = $this->closeEntry($year);
        $this->assertSame(50000, (int) $this->lineFor($entry, '3125')->credit);
        $this->assertNull($this->lineFor($entry, '3120'));
        $this->assertSame($custom->id, $this->activeClose($year)->retained_earnings_account_id);
    }

    /** @test */
    public function a_missing_or_invalid_retained_earnings_mapping_blocks_the_close(): void
    {
        $year = $this->year();
        $this->revenue('2026-06-01', 50000);

        AccountRoleMapping::where('role_key', 'retained_earnings')->delete();

        $readiness = app(FiscalCloseService::class)->readiness($year->fresh());
        $this->assertFalse($readiness['can_close']);
        $this->assertContains('retained_earnings', array_column($readiness['blockers'], 'code'));

        $this->assertThrows(fn () => $this->close($year->fresh()), RuntimeException::class);
        $this->assertSame('open', $year->fresh()->status);
        $this->assertSame(0, FiscalYearClose::count());
    }

    /** @test */
    public function a_disabled_retained_earnings_account_fails_closed(): void
    {
        $year = $this->year();
        $this->revenue('2026-06-01', 50000);
        Account::where('code', '3120')->update(['is_active' => false]);

        $readiness = app(FiscalCloseService::class)->readiness($year->fresh());
        $this->assertFalse($readiness['can_close']);
        $this->assertThrows(fn () => $this->close($year->fresh()), RuntimeException::class);
    }

    // ── C. محاسبة الإقفال ───────────────────────────────────────────────

    /** @test */
    public function a_profitable_year_credits_retained_earnings_and_zeroes_the_pl_accounts(): void
    {
        $year = $this->year();
        $this->revenue('2026-03-01', 100000);
        $this->expense('2026-04-01', 40000);

        $this->close($year);
        $entry = $this->closeEntry($year);

        // الإيراد يُقفل بمدين، والمصروف بدائن، والصافي دائناً على 3120.
        $this->assertSame(100000, (int) $this->lineFor($entry, '4110')->debit);
        $this->assertSame(40000, (int) $this->lineFor($entry, '5120')->credit);
        $this->assertSame(60000, (int) $this->lineFor($entry, '3120')->credit);

        $this->assertSame((int) $entry->lines->sum('debit'), (int) $entry->lines->sum('credit'));
        $this->assertSame('2026-12-31', $entry->entry_date->toDateString());

        // وبعد الإقفال يصير رصيد حسابات النتيجة صفراً في ميزان المراجعة.
        $trial = app(ReportService::class)->trialBalance(['to' => '2026-12-31']);
        $codes = array_column($trial['rows'], 'code');
        $this->assertNotContains('4110', $codes);
        $this->assertNotContains('5120', $codes);
        $this->assertTrue($trial['balanced']);
    }

    /** @test */
    public function a_loss_year_debits_retained_earnings(): void
    {
        $year = $this->year();
        $this->revenue('2026-03-01', 30000);
        $this->expense('2026-04-01', 80000);

        $this->close($year);
        $entry = $this->closeEntry($year);

        $this->assertSame(50000, (int) $this->lineFor($entry, '3120')->debit);
        $this->assertSame(-50000, $this->activeClose($year)->net_income);
        $this->assertSame((int) $entry->lines->sum('debit'), (int) $entry->lines->sum('credit'));
    }

    /** @test */
    public function multiple_revenue_and_expense_accounts_each_get_their_own_close_line(): void
    {
        $year = $this->year();
        $this->revenue('2026-02-01', 70000, '4110');
        $this->revenue('2026-02-02', 30000, '4120');
        $this->expense('2026-03-01', 25000, '5120');
        $this->expense('2026-03-02', 15000, '5140');

        $this->close($year);
        $entry = $this->closeEntry($year);

        $this->assertSame(70000, (int) $this->lineFor($entry, '4110')->debit);
        $this->assertSame(30000, (int) $this->lineFor($entry, '4120')->debit);
        $this->assertSame(25000, (int) $this->lineFor($entry, '5120')->credit);
        $this->assertSame(15000, (int) $this->lineFor($entry, '5140')->credit);
        $this->assertSame(60000, (int) $this->lineFor($entry, '3120')->credit);
        $this->assertCount(5, $entry->lines);
    }

    /** @test */
    public function an_account_whose_net_balance_is_zero_gets_no_close_line(): void
    {
        $year = $this->year();
        $this->revenue('2026-02-01', 50000, '4110');
        // 4120 يتحرّك ثم يعود إلى الصفر: لا سطر إقفال له.
        $this->revenue('2026-02-02', 20000, '4120');
        app(LedgerService::class)->post([
            ['account_id' => $this->accountId('4120'), 'debit' => 20000],
            ['account_id' => $this->accountId('1130'), 'credit' => 20000],
        ], ['entry_date' => '2026-02-03']);

        $this->close($year);
        $entry = $this->closeEntry($year);

        $this->assertNull($this->lineFor($entry, '4120'));
        $this->assertSame(50000, (int) $this->lineFor($entry, '4110')->debit);
        $this->assertCount(2, $entry->lines);
    }

    /** @test */
    public function a_break_even_year_closes_without_a_retained_earnings_line(): void
    {
        $year = $this->year();
        $this->revenue('2026-02-01', 50000);
        $this->expense('2026-03-01', 50000);

        $this->close($year);
        $entry = $this->closeEntry($year);

        $this->assertNull($this->lineFor($entry, '3120')); // لا سطر بصفر
        $this->assertCount(2, $entry->lines);
        $this->assertSame(0, $this->activeClose($year)->net_income);
        $this->assertSame((int) $entry->lines->sum('debit'), (int) $entry->lines->sum('credit'));
    }

    /** @test */
    public function a_zero_activity_year_closes_without_creating_any_journal(): void
    {
        $year = $this->year();
        $entriesBefore = JournalEntry::count();

        $described = $this->close($year);

        $this->assertSame('closed', $described['status']);
        $this->assertTrue($described['closed_without_journal']);
        $this->assertSame($entriesBefore, JournalEntry::count()); // لا قيد فارغ
        $this->assertNull($this->activeClose($year)->journal_entry_id);
        $this->assertSame(1, $this->activeClose($year)->generation);

        // ومع ذلك تتميّز عن سنةٍ لم تُقفل.
        $this->assertSame('closed', $year->fresh()->status);
    }

    /** @test */
    public function assets_liabilities_equity_and_vat_accounts_are_never_closed(): void
    {
        $year = $this->year();
        // بيع بضريبة: يحرّك 1130 و4110 و2120 معاً.
        app(LedgerService::class)->post([
            ['account_id' => $this->accountId('1130'), 'debit' => 115000],
            ['account_id' => $this->accountId('4110'), 'credit' => 100000],
            ['account_id' => $this->accountId('2120'), 'credit' => 15000],
        ], ['entry_date' => '2026-05-01']);
        // شراء بضريبة مدخلات.
        app(LedgerService::class)->post([
            ['account_id' => $this->accountId('5120'), 'debit' => 40000],
            ['account_id' => $this->accountId('1150'), 'debit' => 6000],
            ['account_id' => $this->accountId('2110'), 'credit' => 46000],
        ], ['entry_date' => '2026-06-01']);
        // رأس مال وأرصدة افتتاحية.
        app(LedgerService::class)->post([
            ['account_id' => $this->accountId('1110'), 'debit' => 200000],
            ['account_id' => $this->accountId('3110'), 'credit' => 200000],
        ], ['entry_date' => '2026-01-02']);

        $this->close($year);
        $entry = $this->closeEntry($year);

        // القيد يمسّ حسابات النتيجة و3120 فقط.
        $touched = $entry->lines->map(fn ($line) => $line->account->code)->sort()->values()->all();
        $this->assertSame(['3120', '4110', '5120'], $touched);

        foreach (['1110', '1130', '1150', '2110', '2120', '3110', '3130'] as $code) {
            $this->assertNull($this->lineFor($entry, $code), "الحساب {$code} لا يجوز إقفاله");
        }
    }

    /** @test */
    public function the_opening_balances_account_is_never_used_by_the_close(): void
    {
        $year = $this->year();
        $this->revenue('2026-06-01', 50000);
        $this->close($year);

        $this->assertNull($this->lineFor($this->closeEntry($year), '3130'));
        // ولا يتغيّر رصيد 3130 بأي شكل.
        $this->assertSame(0, $this->balanceOf('3130'));
    }

    /** @test */
    public function close_lines_carry_no_branch_partner_or_cost_center_dimension(): void
    {
        $branch = Branch::create(['name' => 'فرع الدمام', 'code' => 'BR-2', 'is_active' => true]);
        app(\App\Tenancy\BranchContext::class)->set($branch->id);

        $year = $this->year();
        $this->revenue('2026-06-01', 50000);
        $this->close($year);

        foreach ($this->closeEntry($year)->lines as $line) {
            $this->assertNull($line->branch_id, 'الإقفال مؤسسيّ فلا يُوسم بفرع');
            $this->assertNull($line->cost_center_id);
            $this->assertNull($line->partner_id);
        }
    }

    /** @test */
    public function the_close_journal_is_identified_structurally_not_by_text(): void
    {
        $year = $this->year();
        $this->revenue('2026-06-01', 50000);
        $this->close($year);

        $close = $this->activeClose($year);
        $entry = $this->closeEntry($year);

        $this->assertSame(FiscalYearClose::class, $entry->source_type);
        $this->assertSame($close->id, $entry->source_id);
        $this->assertSame($year->id, $close->fiscal_year_id);
        $this->assertSame(1, $close->generation);
        $this->assertSame('active', $close->status);
    }

    /** @test */
    public function an_inactive_pl_account_holding_a_balance_blocks_the_close(): void
    {
        $year = $this->year();
        $this->revenue('2026-06-01', 50000);
        Account::where('code', '4110')->update(['is_active' => false]);

        $readiness = app(FiscalCloseService::class)->readiness($year->fresh());
        $this->assertFalse($readiness['can_close']);
        $this->assertContains('unpostable_account', array_column($readiness['blockers'], 'code'));
        $this->assertThrows(fn () => $this->close($year->fresh()), RuntimeException::class);
    }

    /** @test */
    public function activity_outside_the_fiscal_year_is_not_closed(): void
    {
        $year = $this->year('2026-01-01', '2026-12-31');
        $this->revenue('2025-12-31', 11000); // قبل
        $this->revenue('2026-06-01', 50000); // داخل
        $this->revenue('2027-01-01', 22000); // بعد

        $this->close($year);

        $this->assertSame(50000, $this->activeClose($year)->total_revenue);
        $this->assertSame(50000, (int) $this->lineFor($this->closeEntry($year), '4110')->debit);
    }

    // ── D. التقارير ─────────────────────────────────────────────────────

    /** @test */
    public function the_historical_income_statement_survives_the_close(): void
    {
        $year = $this->year();
        $this->revenue('2026-03-01', 100000);
        $this->expense('2026-04-01', 40000);

        $before = app(ReportService::class)->incomeStatement(['from' => '2026-01-01', 'to' => '2026-12-31']);
        $this->close($year);
        $after = app(ReportService::class)->incomeStatement(['from' => '2026-01-01', 'to' => '2026-12-31']);

        $this->assertSame($before, $after);
        $this->assertSame(100000, $after['total_revenue']);
        $this->assertSame(40000, $after['total_expense']);
        $this->assertSame(60000, $after['net_income']);
    }

    /** @test */
    public function the_balance_sheet_at_a_closed_year_end_never_double_counts_net_income(): void
    {
        $year = $this->year();
        $this->revenue('2026-03-01', 100000);
        $this->expense('2026-04-01', 40000);

        $before = app(ReportService::class)->balanceSheet(['to' => '2026-12-31']);
        $this->assertSame(60000, $before['net_income']);
        $this->assertTrue($before['balanced']);

        $this->close($year);
        $after = app(ReportService::class)->balanceSheet(['to' => '2026-12-31']);

        // الربح انتقل إلى حقوق الملكية الحقيقية، وصافي الدخل المشتق صار صفراً.
        $this->assertSame(0, $after['net_income']);
        $this->assertSame(60000, $this->balanceOf('3120', ['to' => '2026-12-31']));
        $this->assertSame($before['total_equity_and_income'], $after['total_equity_and_income']);
        $this->assertTrue($after['balanced']);
    }

    /** @test */
    public function after_a_closed_year_the_balance_sheet_shows_only_the_unclosed_activity(): void
    {
        $year = $this->year();
        $this->revenue('2026-03-01', 100000);
        $this->expense('2026-04-01', 40000);
        $this->close($year);

        // نشاط السنة التالية غير مقفل.
        $this->revenue('2027-02-01', 25000);
        $this->expense('2027-03-01', 10000);

        $sheet = app(ReportService::class)->balanceSheet(['to' => '2027-06-30']);

        $this->assertSame(15000, $sheet['net_income']);           // النشاط غير المقفل وحده
        $this->assertSame(60000, $this->balanceOf('3120', ['to' => '2027-06-30'])); // الربح المقفل
        $this->assertTrue($sheet['balanced']);
    }

    /** @test */
    public function a_balance_sheet_dated_before_the_close_still_shows_the_period_income(): void
    {
        $year = $this->year();
        $this->revenue('2026-03-01', 100000);
        $this->expense('2026-04-01', 40000);
        $this->close($year);

        // قيد الإقفال مؤرَّخ 2026-12-31، فتقريرٌ قبله لا يراه.
        $sheet = app(ReportService::class)->balanceSheet(['to' => '2026-06-30']);

        $this->assertSame(60000, $sheet['net_income']);
        $this->assertSame(0, $this->balanceOf('3120', ['to' => '2026-06-30']));
        $this->assertTrue($sheet['balanced']);
    }

    /** @test */
    public function the_trial_balance_and_general_ledger_show_the_close_journal(): void
    {
        $year = $this->year();
        $this->revenue('2026-03-01', 100000);
        $this->expense('2026-04-01', 40000);
        $this->close($year);

        $trial = app(ReportService::class)->trialBalance(['to' => '2026-12-31']);
        $retained = collect($trial['rows'])->firstWhere('code', '3120');
        $this->assertNotNull($retained);
        $this->assertSame(60000, $retained['credit']);
        $this->assertTrue($trial['balanced']);

        $ledger = app(ReportService::class)->accountLedger($this->accountId('3120'), ['to' => '2026-12-31']);
        $this->assertNotEmpty($ledger['rows']);
        $this->assertSame(60000, (int) $ledger['closing_balance']);

        $revenueLedger = app(ReportService::class)->accountLedger($this->accountId('4110'), ['to' => '2026-12-31']);
        $this->assertSame(0, (int) $revenueLedger['closing_balance']); // القيد ظاهر ويصفّره
    }

    /** @test */
    public function cost_center_profitability_is_not_distorted_by_the_close(): void
    {
        $center = CostCenter::create(['name' => 'مركز أ', 'code' => 'CC-1', 'is_active' => true]);
        $year = $this->year();

        app(LedgerService::class)->post([
            ['account_id' => $this->accountId('1130'), 'debit' => 100000],
            ['account_id' => $this->accountId('4110'), 'credit' => 100000, 'cost_center_id' => $center->id],
        ], ['entry_date' => '2026-03-01']);

        $before = app(ReportService::class)->costCenterProfitability(['from' => '2026-01-01', 'to' => '2026-12-31']);
        $this->close($year);
        $after = app(ReportService::class)->costCenterProfitability(['from' => '2026-01-01', 'to' => '2026-12-31']);

        $this->assertSame($before, $after);
        $this->assertSame(100000, $after['total_revenue']);
    }

    /** @test */
    public function branch_income_statement_is_not_distorted_by_the_close(): void
    {
        $branch = Branch::create(['name' => 'فرع الخبر', 'code' => 'BR-3', 'is_active' => true]);
        app(\App\Tenancy\BranchContext::class)->set($branch->id);

        $year = $this->year();
        $this->revenue('2026-03-01', 100000);
        $this->expense('2026-04-01', 40000);

        $before = app(ReportService::class)->incomeStatement(['from' => '2026-01-01', 'to' => '2026-12-31', 'branch_id' => $branch->id]);
        $this->close($year);
        $after = app(ReportService::class)->incomeStatement(['from' => '2026-01-01', 'to' => '2026-12-31', 'branch_id' => $branch->id]);

        $this->assertSame($before, $after);
        $this->assertSame(60000, $after['net_income']);
        // سطور الإقفال بلا فرع، فلا تتسرّب حتى إلى كتلة «غير الموزَّع».
        $this->assertSame(0, $after['unallocated']['net_income']);
    }
}
