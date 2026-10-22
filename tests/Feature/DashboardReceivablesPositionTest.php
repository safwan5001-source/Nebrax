<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\LedgerService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * مؤشر «ذمم العملاء» في لوحة التحكم: إجمالي حساب 1130 وحده، بنطاق فروع المستخدم كما في `cash-position` وبقية التقارير.
 * لا ترحيل جديد: القيود تُنشأ عبر `LedgerService`، والأرقام تُقارَن بمجموع مستقل من الدفتر ولقطة `/accounts` القديمة.
 */
class DashboardReceivablesPositionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private array $auth;
    private string $tenantId;
    private string $main;
    private string $khobar;
    private string $dammam;

    protected function setUp(): void
    {
        parent::setUp();

        $this->auth = $this->registerTenant('recv-main', 'owner@recv-main.test');
        $this->tenantId = $this->auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);

        $this->main = $this->withToken($this->auth['token'])->getJson('/api/branches')->json('data.0.id');
        $this->khobar = $this->withToken($this->auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])->assertCreated()->json('data.id');
        $this->dammam = $this->withToken($this->auth['token'])->postJson('/api/branches', ['name' => 'فرع الدمام'])->assertCreated()->json('data.id');
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function id(string $code): string
    {
        return (string) Account::where('code', $code)->value('id');
    }

    private function entry(array $lines, string $branch, string $date = '2026-03-02')
    {
        return app(LedgerService::class)->post(
            array_map(fn ($l) => $l + ['branch_id' => $branch], $lines),
            ['entry_date' => $date, 'description' => 'قيد اختبار', 'branch_id' => $branch],
        );
    }

    /** فاتورة آجلة: مدين العملاء ودائن المبيعات. */
    private function sale(int $amount, string $branch)
    {
        return $this->entry([
            ['account_id' => $this->id('1130'), 'debit' => $amount],
            ['account_id' => $this->id('4110'), 'credit' => $amount],
        ], $branch);
    }

    /** تحصيل من عميل: مدين الصندوق ودائن العملاء. */
    private function collection(int $amount, string $branch)
    {
        return $this->entry([
            ['account_id' => $this->id('1110'), 'debit' => $amount],
            ['account_id' => $this->id('1130'), 'credit' => $amount],
        ], $branch, '2026-03-03');
    }

    private function restrictedToken(array $branchIds, string $email = 'restricted@recv.test', string $role = 'owner', ?string $tenantId = null): string
    {
        $user = User::create([
            'tenant_id' => $tenantId ?? $this->tenantId, 'name' => 'محدود', 'email' => $email,
            'password' => bcrypt('secret1234'), 'role' => $role,
        ]);
        $user->branches()->sync($branchIds);

        return $user->createToken('recv-test')->plainTextToken;
    }

    private function position(string $token, string $path = '/api/reports/receivables-position')
    {
        return $this->withToken($token)->getJson($path);
    }

    /** مجموع مستقل من الدفتر لحساب 1130 (مدين − دائن) ضمن الفروع المعطاة. */
    private function ledgerNet(?array $branches = null, ?string $tenant = null): int
    {
        $query = DB::table('journal_lines as l')
            ->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
            ->where('e.tenant_id', $tenant ?? $this->tenantId)
            ->whereIn('e.status', ['posted', 'reversed'])
            ->where('l.account_id', $this->idFor('1130', $tenant));
        if ($branches) {
            $query->whereIn('l.branch_id', $branches);
        }

        return (int) ($query->sum('l.debit') - $query->sum('l.credit'));
    }

    private function idFor(string $code, ?string $tenant): string
    {
        return (string) DB::table('accounts')->where('tenant_id', $tenant ?? $this->tenantId)->where('code', $code)->value('id');
    }

    // ───────────────────────── غير المقيَّد ─────────────────────────

    /** @test */
    public function an_unrestricted_user_gets_the_company_wide_balance_identical_to_the_old_accounts_figure(): void
    {
        $this->sale(100000, $this->main);
        $this->sale(60000, $this->khobar);
        $this->collection(25000, $this->dammam);

        $res = $this->position($this->auth['token'])->assertOk();

        $res->assertExactJson(['balance' => '1350.00']);
        $this->assertSame(135000, $this->ledgerNet());
        // المصدر القديم للمؤشر: رصيد 1130 في قائمة /accounts — يجب أن يطابقه حرفياً.
        $legacy = collect($this->withToken($this->auth['token'])->getJson('/api/accounts')->json('data'))->firstWhere('code', '1130');
        $this->assertSame($legacy['balance'], $res->json('balance'));
        $this->assertSame(135000, $this->reports()->receivablesPosition()['balance']);
    }

    // ───────────────────────── المقيَّد ─────────────────────────

    /** @test */
    public function a_user_restricted_to_one_branch_sees_only_that_branchs_receivables(): void
    {
        $this->sale(100000, $this->main);
        $this->sale(60000, $this->khobar);
        $this->collection(25000, $this->khobar);
        $this->sale(7000, $this->dammam);

        $token = $this->restrictedToken([$this->khobar]);

        $this->position($token)->assertOk()->assertExactJson(['balance' => '350.00']);
        $this->assertSame(35000, $this->ledgerNet([$this->khobar]));
    }

    /** @test */
    public function a_user_restricted_to_several_branches_sees_the_sum_of_exactly_those_branches(): void
    {
        $this->sale(100000, $this->main);
        $this->sale(60000, $this->khobar);
        $this->sale(7000, $this->dammam);
        $this->collection(2000, $this->dammam);

        $token = $this->restrictedToken([$this->khobar, $this->dammam]);

        $this->position($token)->assertOk()->assertExactJson(['balance' => '650.00']);
        $this->assertSame(65000, $this->ledgerNet([$this->khobar, $this->dammam]));
        $this->assertSame(165000, $this->ledgerNet(), 'إجمالي الشركة يشمل الفرع الرئيسي');
        $this->assertNotSame($this->ledgerNet(), $this->ledgerNet([$this->khobar, $this->dammam]), 'الفرع الرئيسي مستبعد من المقيَّد');
    }

    /** @test */
    public function a_branch_without_receivables_is_a_genuine_zero_not_the_company_total(): void
    {
        $this->sale(100000, $this->main);
        $this->sale(60000, $this->khobar);

        $token = $this->restrictedToken([$this->dammam]);

        $this->position($token)->assertOk()->assertExactJson(['balance' => '0.00']);
    }

    /** @test */
    public function cash_and_receivables_share_one_branch_scope_for_the_same_user(): void
    {
        $this->sale(60000, $this->khobar);
        $this->collection(15000, $this->khobar);   // نقد 15000 في الخبر
        $this->collection(99000, $this->main);     // خارج نطاقه
        $this->sale(40000, $this->main);

        $restricted = $this->restrictedToken([$this->khobar]);
        $owner = $this->auth['token'];

        $this->position($restricted, '/api/reports/cash-position')->assertOk()->assertExactJson(['balance' => '150.00']);
        $this->position($restricted)->assertOk()->assertExactJson(['balance' => '450.00']);
        // وغير المقيَّد يرى الشركة كلها في المؤشرين.
        $this->position($owner, '/api/reports/cash-position')->assertOk()->assertExactJson(['balance' => '1140.00']);
        $this->position($owner)->assertOk()->assertExactJson(['balance' => '-140.00']);   // 600 − 150 − 990 + 400
    }

    // ───────────────────────── الإشارة والعكس ─────────────────────────

    /** @test */
    public function a_reversed_entry_nets_to_zero_in_both_scopes(): void
    {
        $sale = $this->sale(80000, $this->khobar);
        app(LedgerService::class)->reverse($sale, '2026-03-04', 'اختبار');

        $this->position($this->auth['token'])->assertOk()->assertExactJson(['balance' => '0.00']);
        $this->position($this->restrictedToken([$this->khobar]))->assertOk()->assertExactJson(['balance' => '0.00']);
        $this->assertSame(0, $this->ledgerNet());
    }

    /** @test */
    public function an_overpaid_customer_gives_a_negative_receivable_with_the_same_sign_in_both_scopes(): void
    {
        $this->sale(10000, $this->khobar);
        $this->collection(30000, $this->khobar);   // دفعة زائدة ⇒ رصيد دائن (سالب)

        $this->position($this->auth['token'])->assertOk()->assertExactJson(['balance' => '-200.00']);
        $this->position($this->restrictedToken([$this->khobar]))->assertOk()->assertExactJson(['balance' => '-200.00']);
    }

    // ───────────────────────── العزل بين المستأجرين ─────────────────────────

    /** @test */
    public function another_tenants_receivables_never_leak_in_either_scope(): void
    {
        $this->sale(10000, $this->khobar);

        $other = $this->registerTenant('recv-other', 'owner@recv-other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $otherBranch = Branch::query()->firstOrFail()->id;
        $this->entry([
            ['account_id' => (string) Account::where('code', '1130')->value('id'), 'debit' => 999000],
            ['account_id' => (string) Account::where('code', '4110')->value('id'), 'credit' => 999000],
        ], $otherBranch);
        app(TenantContext::class)->set($this->tenantId);

        $this->position($this->auth['token'])->assertOk()->assertExactJson(['balance' => '100.00']);
        $this->position($this->restrictedToken([$this->khobar]))->assertOk()->assertExactJson(['balance' => '100.00']);
        // وللمستأجر الآخر رقمه وحده.
        $this->position($other['token'])->assertOk()->assertExactJson(['balance' => '9990.00']);
        $this->assertSame(999000, $this->ledgerNet(null, $other['tenant_id']));
    }

    // ───────────────────────── التفويض وحدّ الكشف ─────────────────────────

    /** @test */
    public function the_endpoint_requires_authentication_and_the_reports_permission_and_exposes_nothing_else(): void
    {
        $this->flushHeaders(); // setUp استعمل توكن المالك: لا يبقى في الطلب غير المصادَق
        $this->getJson('/api/reports/receivables-position')->assertUnauthorized();

        // دور بلا reports.view ⇒ ممنوع (لم يُغيَّر أي تعريف صلاحيات).
        $denied = $this->restrictedToken([$this->khobar], 'self@recv.test', 'self_service');
        $this->position($denied)->assertForbidden();

        $this->sale(12345, $this->khobar);
        $res = $this->position($this->auth['token'])->assertOk();
        $this->assertSame(['balance'], array_keys($res->json()));
        $this->assertStringNotContainsString('العملاء', $res->getContent());
        $this->assertStringNotContainsString($this->khobar, $res->getContent());
    }

    // ───────────────────────── مستأجر قديم/ناقص ─────────────────────────

    /** @test */
    public function a_tenant_without_the_receivables_account_gets_zero_not_an_error(): void
    {
        $tenant = Tenant::create(['name' => 'بلا حسابات', 'slug' => 'recv-empty', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);

        $this->assertSame(['balance' => 0], $this->reports()->receivablesPosition());
        app(TenantContext::class)->set($this->tenantId);
    }

    private function reports(): ReportService
    {
        return app(ReportService::class);
    }
}
