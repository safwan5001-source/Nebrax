<?php

namespace Tests\Feature;

use App\Models\JournalLine;
use App\Models\PayrollRun;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  الرواتب مصروف مركزي **غير موزَّع على فرع**
 * ═══════════════════════════════════════════════════════════════
 *  المسيّر يشمل كل الموظفين بلا تمييز فرع (`PayrollRun` مصنَّف `CompanyWide`).
 *  لكن قيده كان يلتقط **الفرع النشط وقت الترحيل**، فتظهر قائمة دخل ذلك الفرع
 *  محمَّلةً برواتب المؤسسة كلها — رقم يتغيّر بتغيّر من ضغط الزرّ.
 *
 *  الآن يُوسَم `branch_id = null` صراحةً: يظهر في المجمّع، ولا يُحمَّل على فرع،
 *  ويُكشَف في قائمة دخل الفرع تحت بند «غير موزَّع» فلا يبدو ناقصاً بلا تفسير.
 *
 *  تشغيل: php artisan test --filter=PayrollUnallocatedTest
 */
class PayrollUnallocatedTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const SALARY_EXPENSE = '5120';

    private function branch(string $token, string $name): string
    {
        return $this->withToken($token)->postJson('/api/branches', ['name' => $name])
            ->assertCreated()['data']['id'];
    }

    private function mainBranch(string $token): string
    {
        return $this->withToken($token)->getJson('/api/branches')['data'][0]['id'];
    }

    /** مستأجر بفرعين وموظف واحد براتب ٥٠٠٠ ريال. */
    private function scenario(): array
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson('/api/employees', ['name' => 'موظف', 'basic_salary' => 500000])
            ->assertCreated();

        return [$auth, $main, $khobar];
    }

    /** يُنشئ مسيّراً ويرحّله (اختيارياً يصرفه) من فرع محدّد. */
    private function runPayroll(string $token, string $branchId, bool $pay = false): array
    {
        $headers = ['X-Branch-Id' => $branchId];

        $run = $this->withToken($token)->withHeaders($headers)
            ->postJson('/api/payroll-runs', ['period' => '2026-01'])->assertCreated()['data'];

        $this->withToken($token)->withHeaders($headers)
            ->postJson("/api/payroll-runs/{$run['id']}/post")->assertOk();

        if ($pay) {
            $this->withToken($token)->withHeaders($headers)
                ->postJson("/api/payroll-runs/{$run['id']}/pay", ['method' => 'bank'])->assertOk();
        }

        return $run;
    }

    /** @test */
    public function the_accrual_entry_is_stamped_unallocated_not_with_the_active_branch(): void
    {
        [$auth, , $khobar] = $this->scenario();
        $run = $this->runPayroll($auth['token'], $khobar); // رُحِّل من فرع الخبر

        $lines = JournalLine::whereHas('entry', fn ($q) => $q
            ->where('source_type', PayrollRun::class)->where('source_id', $run['id']))->get();

        $this->assertNotEmpty($lines);
        foreach ($lines as $line) {
            $this->assertNull($line->branch_id, 'قيد الرواتب يجب أن يبقى غير موزَّع.');
        }
    }

    /** @test */
    public function the_payment_entry_is_unallocated_too(): void
    {
        [$auth, , $khobar] = $this->scenario();
        $run = $this->runPayroll($auth['token'], $khobar, true);

        $paymentEntryId = PayrollRun::findOrFail($run['id'])->payment_journal_entry_id;
        $this->assertNotNull($paymentEntryId);

        foreach (JournalLine::where('journal_entry_id', $paymentEntryId)->get() as $line) {
            $this->assertNull($line->branch_id);
        }
    }

    /**
     * **جوهر الإصلاح.** قائمة دخل الفرع لا تحمل رواتب المؤسسة، والمجمّع يحملها.
     *
     * @test
     */
    public function branch_income_excludes_salaries_while_the_consolidated_view_includes_them(): void
    {
        [$auth, $main, $khobar] = $this->scenario();
        $this->runPayroll($auth['token'], $khobar);

        $expenseOf = function (?string $branch) use ($auth) {
            $q = $branch ? "?branch_id={$branch}" : '';
            return $this->withToken($auth['token'])->getJson("/api/reports/income-statement{$q}")['total_expense'];
        };

        $this->assertSame('0.00', $expenseOf($khobar), 'الفرع الذي رُحِّل منه لا يتحمّل الرواتب.');
        $this->assertSame('0.00', $expenseOf($main));
        $this->assertSame('5000.00', $expenseOf(null), 'المجمّع يحمل الرواتب كاملةً.');
    }

    /** @test */
    public function the_branch_income_statement_discloses_the_unallocated_amount(): void
    {
        [$auth, , $khobar] = $this->scenario();
        $this->runPayroll($auth['token'], $khobar);

        $filtered = $this->withToken($auth['token'])
            ->getJson("/api/reports/income-statement?branch_id={$khobar}")->assertOk();

        // لا يبدو الفرع ناقصاً بلا تفسير: البند مكشوف صراحةً
        $this->assertSame('5000.00', $filtered['unallocated']['total_expense']);
        $this->assertSame('-5000.00', $filtered['unallocated']['net_income']);
    }

    /** العرض المجمّع لا يحوي البند — غير الموزَّع داخل إجمالياته أصلاً. */
    /** @test */
    public function the_consolidated_statement_has_no_unallocated_block(): void
    {
        [$auth, , $khobar] = $this->scenario();
        $this->runPayroll($auth['token'], $khobar);

        $this->withToken($auth['token'])->getJson('/api/reports/income-statement')
            ->assertOk()->assertJsonMissingPath('unallocated');
    }

    /** التوازن لا يتأثّر: طرفا القيد يأخذان المعاملة نفسها. */
    /** @test */
    public function the_trial_balance_stays_balanced_consolidated_and_per_branch(): void
    {
        [$auth, , $khobar] = $this->scenario();
        $this->runPayroll($auth['token'], $khobar, true);

        foreach ([null, $khobar] as $branch) {
            $q  = $branch ? "?branch_id={$branch}" : '';
            $tb = $this->withToken($auth['token'])->getJson("/api/reports/trial-balance{$q}")->assertOk();

            $this->assertTrue($tb['balanced'], 'ميزان المراجعة يجب أن يبقى متوازناً.');
            $this->assertSame($tb['total_debit'], $tb['total_credit']);
        }
    }

    /** حساب الرواتب 5120 ما زال يحمل المبلغ كاملاً — الوسم لا يمسّ الأرصدة. */
    /** @test */
    public function the_salary_account_balance_is_unchanged(): void
    {
        [$auth, , $khobar] = $this->scenario();
        $this->runPayroll($auth['token'], $khobar);

        $rows = $this->withToken($auth['token'])->getJson('/api/reports/trial-balance')['rows'];
        $salary = collect($rows)->firstWhere('code', self::SALARY_EXPENSE);

        $this->assertNotNull($salary);
        $this->assertSame('5000.00', $salary['debit']);
    }
}
