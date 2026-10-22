<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Asset;
use App\Models\CashBankAccount;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\LedgerService;
use App\Services\Reporting\CashAccountResolver;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * TREASURY-T2 — تقرير التدفق النقدي ومؤشر النقد في لوحة التحكم يشملان كل الخزائن والحسابات البنكية المربوطة بكيانات،
 * لا الحسابين 1110/1120 وحدهما. تعريف «النقد والبنك» = `CashAccountResolver` (كيانات ∪ 1110/1120، دون افتراض أن 111x/112x كلها نقد).
 * لا ترحيل جديد: كل القيود تُنشأ عبر `LedgerService` أو خدمة التحويل الحقيقية، والأرقام تُقارَن بمجموع مستقل من دفتر الأستاذ.
 */
class TreasuryAwareCashReportsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private array $auth;
    private string $tenantId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->auth = $this->registerTenant('t2-main', 'owner@t2-main.test');
        $this->tenantId = $this->auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function id(string $code): string
    {
        return (string) Account::where('code', $code)->value('id');
    }

    /** يرحّل قيداً عبر المحرك (الطريق الوحيد المسموح) ويعيد القيد. */
    private function journal(array $lines, string $date, ?string $branch = null, array $meta = [])
    {
        $meta = ['entry_date' => $date, 'description' => 'قيد اختبار'] + $meta;
        if ($branch !== null) {
            $meta['branch_id'] = $branch;
            $lines = array_map(fn ($l) => $l + ['branch_id' => $branch], $lines);
        }

        return app(LedgerService::class)->post($lines, $meta);
    }

    private function receipt(string $cashAccount, int $amount, string $date, ?string $branch = null): void
    {
        $this->journal([
            ['account_id' => $cashAccount, 'debit' => $amount],
            ['account_id' => $this->id('4110'), 'credit' => $amount],
        ], $date, $branch);
    }

    private function treasury(string $type, string $name): CashBankAccount
    {
        $payload = ['type' => $type, 'name' => $name, 'currency' => 'SAR', 'deposit_scope' => 'all', 'withdraw_scope' => 'all'];
        if ($type === 'bank') {
            $payload += ['bank_name' => 'بنك تجريبي', 'account_number' => 'SA'.random_int(1000, 9999).'0000'];
        }
        $id = $this->withToken($this->auth['token'])->postJson('/api/cash-bank-accounts', $payload)->assertCreated()->json('data.id');

        return CashBankAccount::with('account')->findOrFail($id);
    }

    private function transfer(CashBankAccount $from, CashBankAccount $to, int $amount, string $date): void
    {
        $this->withToken($this->auth['token'])->postJson('/api/cash-bank-transfers', [
            'source_cash_bank_account_id' => $from->id,
            'destination_cash_bank_account_id' => $to->id,
            'amount' => $amount,
            'transfer_date' => $date,
        ])->assertCreated();
    }

    private function entity(string $code): CashBankAccount
    {
        return CashBankAccount::with('account')->whereHas('account', fn ($q) => $q->where('code', $code))->firstOrFail();
    }

    private function reports(): ReportService
    {
        return app(ReportService::class);
    }

    /** مجموع مستقل من الدفتر: مدين − دائن لسطور القيود المرحّلة/المعكوسة على الحسابات المعطاة ضمن النطاق. */
    private function ledgerNet(array $accountIds, ?string $from = null, ?string $to = null, ?array $branches = null, ?string $tenant = null): int
    {
        $query = DB::table('journal_lines as l')
            ->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
            ->where('e.tenant_id', $tenant ?? $this->tenantId)
            ->whereIn('e.status', ['posted', 'reversed'])
            ->whereIn('l.account_id', $accountIds);
        if ($from) {
            $query->whereDate('e.entry_date', '>=', $from);
        }
        if ($to) {
            $query->whereDate('e.entry_date', '<=', $to);
        }
        if ($branches) {
            $query->whereIn('l.branch_id', $branches);
        }

        return (int) ($query->sum('l.debit') - $query->sum('l.credit'));
    }

    private function legacyIds(): array
    {
        return [$this->id('1110'), $this->id('1120')];
    }

    // ───────────────────────── المحلِّل ─────────────────────────

    /** @test */
    public function the_resolver_is_entities_union_legacy_codes_and_never_a_code_prefix_guess(): void
    {
        $cash = $this->treasury('cash', 'خزينة الفرع');   // 1111
        $bank = $this->treasury('bank', 'بنك الفرع');     // 1121

        // حساب أصل بكود يبدأ بـ111 لكنه ليس خزينة ولا مربوطاً بكيان: يجب ألا يدخل.
        $stray = Account::create([
            'parent_id' => Account::where('code', '111')->value('id'), 'code' => '1119', 'name' => 'ليس خزينة', 'type' => 'asset',
            'normal_balance' => 'debit', 'is_group' => false, 'is_system' => false, 'currency' => 'SAR', 'is_active' => true,
        ]);

        $ids = app(CashAccountResolver::class)->accountIds()->all();
        $this->assertEqualsCanonicalizing(
            [$this->id('1110'), $this->id('1120'), $cash->account_id, $bank->account_id],
            $ids,
        );
        $this->assertNotContains($stray->id, $ids);
        $this->assertNotContains($this->id('111'), $ids, 'مجموعة الخزائن التجميعية ليست نقداً');
        $this->assertNotContains($this->id('1130'), $ids);
        $this->assertSame(count($ids), count(array_unique($ids)), 'بلا تكرار');
    }

    /** @test */
    public function the_resolver_is_tenant_scoped(): void
    {
        $this->treasury('cash', 'خزينة A');
        $mine = app(CashAccountResolver::class)->accountIds()->all();

        $other = $this->registerTenant('t2-other', 'owner@t2-other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $theirs = app(CashAccountResolver::class)->accountIds()->all();

        $this->assertCount(3, $mine);
        $this->assertCount(2, $theirs, 'مستأجر آخر لا يرى إلا حسابيه');
        $this->assertEmpty(array_intersect($mine, $theirs), 'لا تسرُّب حسابات بين المستأجرين');
    }

    // ───────────────────────── التدفق النقدي ─────────────────────────

    /** @test */
    public function a_legacy_tenant_with_only_1110_and_1120_reports_exactly_as_before(): void
    {
        $this->receipt($this->id('1110'), 100000, '2026-03-02');
        $this->receipt($this->id('1120'), 50000, '2026-03-03');
        $this->journal([
            ['account_id' => $this->id('5120'), 'debit' => 20000],
            ['account_id' => $this->id('1110'), 'credit' => 20000],
        ], '2026-03-04');

        $flow = $this->reports()->cashFlow(['from' => '2026-03-01', 'to' => '2026-03-31']);

        $this->assertSame(130000, $flow['net_cash_flow']);
        $this->assertSame(150000, $flow['operating']['inflows']);
        $this->assertSame(20000, $flow['operating']['outflows']);
        $this->assertCount(3, $flow['operating']['entries']);
        $this->assertSame($this->ledgerNet($this->legacyIds(), '2026-03-01', '2026-03-31'), $flow['net_cash_flow']);
    }

    /** @test */
    public function receipts_into_an_additional_cash_treasury_1111_are_included(): void
    {
        $extra = $this->treasury('cash', 'خزينة إضافية');
        $this->assertSame('1111', $extra->account->code);
        $this->receipt($this->id('1110'), 100000, '2026-03-02');
        $this->receipt($extra->account_id, 70000, '2026-03-03');

        $flow = $this->reports()->cashFlow(['from' => '2026-03-01', 'to' => '2026-03-31']);

        $this->assertSame(170000, $flow['net_cash_flow'], 'كان 100000 فقط قبل T2');
        $this->assertSame(170000, $this->ledgerNet(app(CashAccountResolver::class)->accountIds()->all(), '2026-03-01', '2026-03-31'));
        $this->assertNotSame($this->ledgerNet($this->legacyIds(), '2026-03-01', '2026-03-31'), $flow['net_cash_flow']);
    }

    /** @test */
    public function payments_from_an_additional_bank_account_1121_are_included(): void
    {
        $bank = $this->treasury('bank', 'بنك إضافي');
        $this->assertSame('1121', $bank->account->code);
        $this->receipt($bank->account_id, 90000, '2026-03-02');
        $this->journal([
            ['account_id' => $this->id('5120'), 'debit' => 25000],
            ['account_id' => $bank->account_id, 'credit' => 25000],
        ], '2026-03-05');

        $flow = $this->reports()->cashFlow(['from' => '2026-03-01', 'to' => '2026-03-31']);

        $this->assertSame(65000, $flow['net_cash_flow']);
        $this->assertSame(90000, $flow['operating']['inflows']);
        $this->assertSame(25000, $flow['operating']['outflows']);
    }

    /** @test */
    public function internal_transfers_between_any_included_treasuries_do_not_inflate_net_cash_flow(): void
    {
        $cash2 = $this->treasury('cash', 'خزينة إضافية');
        $bank2 = $this->treasury('bank', 'بنك إضافي');
        $this->receipt($this->id('1110'), 200000, '2026-03-01');

        // نقد → بنك إضافي، بنك إضافي → نقد إضافي، نقد إضافي → بنك قديم: كلها داخلية.
        $this->transfer($this->entity('1110'), $bank2, 60000, '2026-03-02');
        $this->transfer($bank2, $cash2, 30000, '2026-03-03');
        $this->transfer($cash2, $this->entity('1120'), 10000, '2026-03-04');

        $flow = $this->reports()->cashFlow(['from' => '2026-03-01', 'to' => '2026-03-31']);

        $this->assertSame(200000, $flow['net_cash_flow'], 'التحويلات الداخلية صافيها صفر');
        $this->assertSame(200000, $flow['operating']['inflows']);
        $this->assertSame(0, $flow['operating']['outflows'], 'لا تظهر التحويلات كتدفق خارج');
        $this->assertCount(1, $flow['operating']['entries'], 'التحويلات لا تُسرد');
        $this->assertSame(200000, $this->ledgerNet(app(CashAccountResolver::class)->accountIds()->all(), '2026-03-01', '2026-03-31'));
    }

    /** @test */
    public function an_inactive_treasury_keeps_its_historical_postings_in_the_report_and_the_position(): void
    {
        $extra = $this->treasury('cash', 'خزينة ستُعطَّل');
        $this->receipt($extra->account_id, 40000, '2026-02-10');
        // لا تُعطَّل خزينة لها رصيد قبل نقله: نحوله إلى الرئيسية ثم نعطّلها.
        $this->transfer($extra, $this->entity('1110'), 40000, '2026-02-11');
        $this->withToken($this->auth['token'])->postJson("/api/cash-bank-accounts/{$extra->id}/deactivate")->assertOk();
        $this->assertFalse((bool) $extra->fresh()->is_active);

        $feb = $this->reports()->cashFlow(['from' => '2026-02-01', 'to' => '2026-02-28']);

        $this->assertSame(40000, $feb['net_cash_flow'], 'قيد القبض على الخزينة المعطَّلة باقٍ في الفترة التاريخية');
        $this->assertContains(
            $extra->account_id,
            app(CashAccountResolver::class)->accountIds()->all(),
        );
        $this->assertSame(40000, $this->reports()->cashPosition()['balance'], 'الرصيد الإجمالي لا يتأثر بتعطيل خزينة رصيدها صفر بعد النقل');
    }

    /** @test */
    public function classification_investing_and_financing_still_works_across_all_treasuries(): void
    {
        $extra = $this->treasury('cash', 'خزينة إضافية');
        $this->journal([
            ['account_id' => $extra->account_id, 'debit' => 500000],
            ['account_id' => $this->id('3110'), 'credit' => 500000],
        ], '2026-01-05');
        $equipment = $this->id('1210');
        $this->journal([
            ['account_id' => $equipment, 'debit' => 100000],
            ['account_id' => $extra->account_id, 'credit' => 100000],
        ], '2026-01-12', null, ['source_type' => Asset::class, 'source_id' => (string) Str::uuid()]);

        $flow = $this->reports()->cashFlow(['from' => '2026-01-01', 'to' => '2026-01-31']);

        $this->assertSame(500000, $flow['financing']['net']);
        $this->assertSame(-100000, $flow['investing']['net']);
        $this->assertSame(400000, $flow['net_cash_flow']);
    }

    /** @test */
    public function branch_filters_and_inclusive_date_boundaries_are_preserved(): void
    {
        $main = $this->withToken($this->auth['token'])->getJson('/api/branches')->json('data.0.id');
        $khobar = $this->withToken($this->auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])->assertCreated()->json('data.id');
        $extra = $this->treasury('cash', 'خزينة إضافية');

        $this->receipt($extra->account_id, 10000, '2026-04-01', $main);     // حدّ البداية
        $this->receipt($extra->account_id, 20000, '2026-04-30', $khobar);   // حدّ النهاية
        $this->receipt($this->id('1110'), 40000, '2026-03-31', $main);      // قبل الفترة
        $this->receipt($this->id('1120'), 80000, '2026-05-01', $khobar);    // بعد الفترة

        $all = $this->reports()->cashFlow(['from' => '2026-04-01', 'to' => '2026-04-30']);
        $this->assertSame(30000, $all['net_cash_flow'], 'الحدّان شاملان');

        $onlyKhobar = $this->reports()->cashFlow(['from' => '2026-04-01', 'to' => '2026-04-30', 'branch_id' => $khobar]);
        $this->assertSame(20000, $onlyKhobar['net_cash_flow']);

        $onlyMain = $this->reports()->cashFlow(['from' => '2026-04-01', 'to' => '2026-04-30', 'branch_id' => $main]);
        $this->assertSame(10000, $onlyMain['net_cash_flow']);

        $ids = app(CashAccountResolver::class)->accountIds()->all();
        $this->assertSame($this->ledgerNet($ids, '2026-04-01', '2026-04-30', [$khobar]), $onlyKhobar['net_cash_flow']);
    }

    /** @test */
    public function opening_plus_net_flow_equals_closing_which_equals_the_position(): void
    {
        $extra = $this->treasury('cash', 'خزينة إضافية');
        $bank2 = $this->treasury('bank', 'بنك إضافي');
        $this->receipt($this->id('1110'), 100000, '2026-01-10');          // افتتاحي
        $this->receipt($extra->account_id, 50000, '2026-01-20');          // افتتاحي
        $this->receipt($bank2->account_id, 30000, '2026-02-05');          // الفترة
        $this->transfer($this->entity('1110'), $bank2, 25000, '2026-02-10'); // داخلي
        $this->journal([
            ['account_id' => $this->id('5120'), 'debit' => 12000],
            ['account_id' => $extra->account_id, 'credit' => 12000],
        ], '2026-02-15');                                                  // الفترة
        $this->receipt($this->id('1120'), 7000, '2026-03-02');            // بعد الفترة

        $ids = app(CashAccountResolver::class)->accountIds()->all();
        $opening = $this->ledgerNet($ids, null, '2026-01-31');
        $flow = $this->reports()->cashFlow(['from' => '2026-02-01', 'to' => '2026-02-28']);
        $closing = $this->ledgerNet($ids, null, '2026-02-28');

        $this->assertSame(150000, $opening);
        $this->assertSame(18000, $flow['net_cash_flow']);
        $this->assertSame($closing, $opening + $flow['net_cash_flow'], 'افتتاحي + صافي التدفق = ختامي');
        $this->assertSame(168000, $closing);
        $this->assertSame(
            $this->ledgerNet($ids),
            $this->reports()->cashPosition()['balance'],
            'مؤشر اللوحة = رصيد الدفتر لمجموعة الحسابات ذاتها',
        );
    }

    /** @test */
    public function a_reversed_entry_stays_visible_and_nets_to_zero(): void
    {
        $extra = $this->treasury('cash', 'خزينة إضافية');
        $entry = $this->journal([
            ['account_id' => $extra->account_id, 'debit' => 30000],
            ['account_id' => $this->id('4110'), 'credit' => 30000],
        ], '2026-03-02');
        app(LedgerService::class)->reverse($entry, '2026-03-03', 'اختبار');

        $flow = $this->reports()->cashFlow(['from' => '2026-03-01', 'to' => '2026-03-31']);

        $this->assertSame(0, $flow['net_cash_flow']);
        $this->assertSame(0, $this->reports()->cashPosition()['balance']);
    }

    // ───────────────────────── العزل ─────────────────────────

    /** @test */
    public function another_tenants_treasuries_and_postings_never_leak_into_the_report_or_the_position(): void
    {
        $mine = $this->treasury('cash', 'خزينة A');
        $this->receipt($mine->account_id, 11000, '2026-03-02');

        $other = $this->registerTenant('t2-other', 'owner@t2-other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $theirCash = CashBankAccount::query()->where('type', 'cash')->firstOrFail();
        $this->journal([
            ['account_id' => $theirCash->account_id, 'debit' => 999000],
            ['account_id' => (string) Account::where('code', '4110')->value('id'), 'credit' => 999000],
        ], '2026-03-02');
        $theirFlow = $this->reports()->cashFlow(['from' => '2026-03-01', 'to' => '2026-03-31']);
        $theirPosition = $this->reports()->cashPosition();

        app(TenantContext::class)->set($this->tenantId);
        $myFlow = $this->reports()->cashFlow(['from' => '2026-03-01', 'to' => '2026-03-31']);
        $myPosition = $this->reports()->cashPosition();

        $this->assertSame(999000, $theirFlow['net_cash_flow']);
        $this->assertSame(999000, $theirPosition['balance']);
        $this->assertSame(11000, $myFlow['net_cash_flow']);
        $this->assertSame(11000, $myPosition['balance']);
        $this->assertCount(3, $myPosition['accounts']);
        $this->assertNotContains($theirCash->account_id, array_column($myPosition['accounts'], 'id'));
    }

    // ───────────────────────── مؤشر اللوحة (API) ─────────────────────────

    /** @test */
    public function the_dashboard_endpoint_returns_the_ledger_equivalent_balance_per_account_and_in_total(): void
    {
        $extra = $this->treasury('cash', 'خزينة إضافية');
        $bank2 = $this->treasury('bank', 'بنك إضافي');
        $this->receipt($this->id('1110'), 100000, '2026-03-02');
        $this->receipt($extra->account_id, 70000, '2026-03-03');
        $this->receipt($bank2->account_id, 30000, '2026-03-04');
        $this->transfer($this->entity('1110'), $bank2, 15000, '2026-03-05');

        $res = $this->withToken($this->auth['token'])->getJson('/api/reports/cash-position')->assertOk();

        $res->assertJsonPath('balance', '2000.00');
        $this->assertCount(4, $res->json('accounts'));
        $codes = collect($res->json('accounts'))->pluck('code')->all();
        $this->assertSame(['1110', '1111', '1120', '1121'], $codes);
        $this->assertSame(
            number_format($this->ledgerNet(app(CashAccountResolver::class)->accountIds()->all()) / 100, 2, '.', ''),
            $res->json('balance'),
        );
        $sum = collect($res->json('accounts'))->sum(fn ($a) => (float) $a['balance']);
        $this->assertEqualsWithDelta((float) $res->json('balance'), $sum, 0.001);
    }

    /** @test */
    public function the_dashboard_endpoint_requires_authentication_and_report_permission(): void
    {
        $this->getJson('/api/reports/cash-position')->assertUnauthorized();
    }

    // ───────────────────────── مستأجر فارغ/ناقص التهيئة ─────────────────────────

    /** @test */
    public function a_tenant_with_the_chart_but_without_treasury_entities_still_reports_the_legacy_accounts(): void
    {
        $tenant = Tenant::create(['name' => 'ناقص التهيئة', 'slug' => 't2-partial', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        $this->assertSame(0, CashBankAccount::query()->count());

        $this->receipt($this->id('1110'), 25000, '2026-03-02');

        $this->assertSame(25000, $this->reports()->cashFlow(['from' => '2026-03-01', 'to' => '2026-03-31'])['net_cash_flow']);
        $this->assertSame(25000, $this->reports()->cashPosition()['balance']);
        $this->assertCount(2, $this->reports()->cashPosition()['accounts']);
    }

    /** @test */
    public function a_tenant_without_any_cash_accounts_gets_empty_results_not_errors(): void
    {
        $tenant = Tenant::create(['name' => 'بلا حسابات', 'slug' => 't2-empty', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);

        $flow = $this->reports()->cashFlow(['from' => '2026-03-01', 'to' => '2026-03-31']);

        $this->assertSame(0, $flow['net_cash_flow']);
        $this->assertSame(['balance' => 0, 'accounts' => []], $this->reports()->cashPosition());
        $this->assertSame([], app(CashAccountResolver::class)->accountIds()->all());
    }
}
