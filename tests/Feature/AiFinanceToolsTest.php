<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\Partner;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PurchaseService;
use App\Services\AiAssistantToolRegistry;
use App\Services\MockAiAssistantProvider;
use App\Services\Reporting\ReportService;
use App\Support\AiAssistantDataCategory;
use App\Support\Money;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AWJ Intelligence — AI-02B: أدوات التقارير المالية الثلاث (قراءة فقط) فوق ReportService.
 *
 * الزمن مجمَّد: 2026-10-20 10:00 بتوقيت الرياض (اليوم المحلي للمستأجر = 2026-10-20).
 *
 * تشغيل: php artisan test --filter=AiFinanceToolsTest
 */
class AiFinanceToolsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiAssistant;

    private const TODAY = '2026-10-20';
    private const SECRET_NAME = 'عميل-سري-CANARY';

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow('2026-10-20 10:00:00 Asia/Riyadh');
        Http::preventStrayRequests();
        Http::fake();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        Http::assertNothingSent();

        parent::tearDown();
    }

    // ───────────────────────── fixtures ─────────────────────────

    /** مستأجر جاهز مع موافقة الرسائل والملخصات المالية. */
    private function financeTenant(string $slug = 'fin-a'): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        config(['ai_assistant.enabled' => true]);
        $this->aiOptIn($auth['tenant_id'], [AiAssistantDataCategory::ASSISTANT_MESSAGES, AiAssistantDataCategory::FINANCIAL_SUMMARY]);

        return $auth;
    }

    private function inTenant(string $tenantId, ?string $branchId, \Closure $fn): mixed
    {
        $tenant = app(TenantContext::class);
        $branch = app(BranchContext::class);
        $prevTenant = $tenant->id();
        $prevBranch = $branch->id();
        $tenant->set($tenantId);
        $branch->set($branchId);

        try {
            return $fn();
        } finally {
            $prevTenant === null ? $tenant->forget() : $tenant->set($prevTenant);
            $branch->set($prevBranch);
        }
    }

    private function mainBranch(string $tenantId): string
    {
        return $this->inTenant($tenantId, null, fn () => Branch::query()->orderBy('created_at')->firstOrFail()->id);
    }

    private function newBranch(string $token, string $name = 'فرع الخبر'): string
    {
        return $this->withToken($token)->postJson('/api/branches', ['name' => $name])->assertCreated()['data']['id'];
    }

    private function partner(string $tenantId, string $type, string $name): string
    {
        return $this->inTenant($tenantId, null, fn () => Partner::create(['name' => $name, 'type' => $type])->id);
    }

    /** فاتورة آجلة مرحَّلة؛ تُعيد المعرّف. */
    private function invoice(string $tenantId, ?string $branchId, string $partnerId, string $date, int $unitPrice, int $qty = 1, ?string $due = null): string
    {
        return $this->inTenant($tenantId, $branchId, function () use ($partnerId, $date, $unitPrice, $qty, $due) {
            $service = app(InvoiceService::class);
            $invoice = $service->create(
                ['partner_id' => $partnerId, 'payment_type' => 'credit', 'invoice_date' => $date, 'due_date' => $due],
                [['quantity' => $qty, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
            );

            return $service->post($invoice)->id;
        });
    }

    private function purchase(string $tenantId, ?string $branchId, string $partnerId, string $date, int $unitPrice, int $qty = 1): string
    {
        return $this->inTenant($tenantId, $branchId, function () use ($partnerId, $date, $unitPrice, $qty) {
            $service = app(PurchaseService::class);
            $purchase = $service->create(
                ['partner_id' => $partnerId, 'payment_type' => 'credit', 'purchase_date' => $date],
                [['quantity' => $qty, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
            );

            return $service->post($purchase)->id;
        });
    }

    /** مصروف بلا فرع (يظهر كـ«غير موزَّع» عند التصفية بفرع). */
    private function expense(string $tenantId, string $date, int $amount): void
    {
        $this->inTenant($tenantId, null, function () use ($date, $amount) {
            app(LedgerService::class)->post([
                ['account_id' => Account::where('code', '5130')->firstOrFail()->id, 'debit' => $amount],
                ['account_id' => Account::where('code', '1110')->firstOrFail()->id, 'credit' => $amount],
            ], ['entry_date' => $date, 'description' => 'مصروف اختبار']);
        });
    }

    /** يحقن مخطط أدوات المزوّد التجريبي (يتجاوز المخطِّط الافتراضي بالكلمات المفتاحية). */
    private function plan(array $calls): void
    {
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(fn () => $calls));
    }

    private function runTool(string $token, string $tool, array $arguments, array $payload = []): \Illuminate\Testing\TestResponse
    {
        $this->plan([['name' => $tool, 'arguments' => $arguments]]);

        return $this->aiAsk($token, $payload);
    }

    /** نتيجة الأداة الأولى من ردّ ناجح. */
    private function toolResult(\Illuminate\Testing\TestResponse $res): array
    {
        $res->assertOk();

        return $res->json('data.tool_calls.0.result');
    }

    /** ما تُرجعه ReportService مباشرةً لفاعل بعينه (مصدر الحقيقة للمطابقة). */
    private function direct(string $tenantId, string $userId, callable $call): mixed
    {
        return $this->inTenant($tenantId, null, function () use ($userId, $call) {
            Auth::guard()->setUser(User::query()->findOrFail($userId));

            return $call(app(ReportService::class));
        });
    }

    private function ownerId(string $tenantId): string
    {
        return $this->inTenant($tenantId, null, fn () => User::query()->where('role', 'owner')->firstOrFail()->id);
    }

    private function customRoleToken(string $tenantId, string $slug, array $permissions, string $email): string
    {
        $this->inTenant($tenantId, null, fn () => Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]));

        return $this->tokenForRole($tenantId, $slug, $email);
    }

    /** @return list<int|string> كل قيم `minor` في بنية متداخلة. */
    private function minors(array $node): array
    {
        $found = [];
        array_walk_recursive($node, function ($v, $k) use (&$found) {
            if ($k === 'minor') {
                $found[] = $v;
            }
        });

        return $found;
    }

    // ───────────────────────── قائمة الدخل: المطابقة ─────────────────────────

    /** @test */
    public function income_statement_matches_report_service_exactly_with_inclusive_date_boundaries(): void
    {
        $auth = $this->financeTenant();
        $customer = $this->partner($auth['tenant_id'], 'customer', 'عميل');
        $tid = $auth['tenant_id'];
        $branch = $this->mainBranch($tid);

        $this->invoice($tid, $branch, $customer, '2026-09-30', 500000);       // قبل الفترة
        $this->invoice($tid, $branch, $customer, '2026-10-01', 100000);       // حدّ البداية (يدخل)
        $this->invoice($tid, $branch, $customer, '2026-10-15', 33333, 3);     // تقريب: 99,999 + ضريبة
        $this->invoice($tid, $branch, $customer, '2026-10-20', 7777);         // حدّ النهاية (يدخل)
        $this->invoice($tid, $branch, $customer, '2026-10-21', 900000);       // بعد الفترة (مؤرَّخ مستقبلاً)
        $this->expense($tid, '2026-10-10', 20001);

        $res = $this->runTool($auth['token'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']);
        $result = $this->toolResult($res);

        $expected = $this->direct($tid, $this->ownerId($tid), fn (ReportService $r) => $r->incomeStatement(['from' => '2026-10-01', 'to' => '2026-10-20']));
        $this->assertSame(100000 + 99999 + 7777, $expected['total_revenue'], 'fixture sanity: boundaries are inclusive, outside dates excluded');

        foreach (['total_revenue', 'total_expense', 'net_income'] as $key) {
            $this->assertSame($expected[$key], $result['totals'][$key]['minor'], $key);
            $this->assertSame(Money::toRiyal($expected[$key]), $result['totals'][$key]['decimal'], $key);
        }
        $this->assertSame(
            array_map(fn ($r) => [$r['code'], $r['name'], $r['amount']], $expected['revenues']),
            array_map(fn ($r) => [$r['code'], $r['name'], $r['amount']['minor']], $result['revenues']),
        );
        $this->assertSame(
            array_map(fn ($r) => [$r['code'], $r['amount']], $expected['expenses']),
            array_map(fn ($r) => [$r['code'], $r['amount']['minor']], $result['expenses']),
        );
        $this->assertSame(20001, $result['totals']['total_expense']['minor']);
        // صافي دخل سالب يُنسَّق بلا float.
        $this->assertSame($expected['net_income'], $result['totals']['net_income']['minor']);
    }

    /** @test */
    public function money_is_integer_minor_units_with_explicit_sar_and_never_a_float(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $this->invoice($tid, $this->mainBranch($tid), $this->partner($tid, 'customer', 'عميل'), '2026-10-05', 33333, 3);
        $this->expense($tid, '2026-10-06', 5);

        $result = $this->toolResult($this->runTool($auth['token'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']));

        $this->assertSame(['SAR', 2], [$result['currency'], $result['minor_unit']]);
        $this->assertSame('sar_only_pilot_tenant_currency_verified', $result['currency_assumption']);
        $minors = $this->minors($result);
        $this->assertNotEmpty($minors);
        foreach ($minors as $minor) {
            $this->assertIsInt($minor);
        }
        $this->assertSame('0.05', $this->money(5));
        $this->assertSame('-0.05', $this->money(-5));
        $this->assertSame('1150.00', $this->money(115000));
        // لا أعداد عشرية في أي موضع من النتيجة.
        array_walk_recursive($result, fn ($v) => $this->assertFalse(is_float($v)));
    }

    private function money(int $minor): string
    {
        return Money::toRiyal($minor);
    }

    /** @test */
    public function income_statement_labels_period_basis_timezone_and_cites_its_source(): void
    {
        $auth = $this->financeTenant();

        $result = $this->toolResult($this->runTool($auth['token'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']));

        $this->assertSame('income_statement', $result['report']);
        $this->assertSame(['from' => '2026-10-01', 'to' => '2026-10-20', 'inclusive' => true], $result['period']);
        $this->assertSame('Asia/Riyadh', $result['timezone']);
        $this->assertSame(
            ['method' => 'accrual_ledger', 'entries' => 'posted_and_reversed', 'date_field' => 'entry_date', 'excludes' => 'fiscal_year_closing_entries'],
            $result['basis'],
        );
        $this->assertSame('ReportService::incomeStatement', $result['sources'][0]['service']);
        $this->assertSame('/api/reports/income-statement?from=2026-10-01&to=2026-10-20', $result['sources'][0]['api_path']);
        $this->assertSame('/reports/general/income-statement', $result['sources'][0]['ui_path']);
        $this->assertSame(Carbon::now('UTC')->toIso8601String(), $result['generated_at']);
        $this->assertSame(['mode' => 'not_applicable', 'ids' => []], $result['scope']['warehouse']);
    }

    // ───────────────────────── أعمار الديون: المطابقة والأساس ─────────────────────────

    /** @test */
    public function receivables_aging_matches_report_service_at_every_bucket_boundary(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $branch = $this->mainBranch($tid);
        $customer = $this->partner($tid, 'customer', self::SECRET_NAME);

        // أيام التأخر بالنسبة لليوم 2026-10-20 (مرجع العمر = الاستحقاق): 0 و30 | 31 و60 | 61 و90 | 91 | غير مستحق
        foreach ([['2026-10-20', 100], ['2026-09-20', 200], ['2026-09-19', 300], ['2026-08-21', 400], ['2026-08-20', 500], ['2026-07-22', 600], ['2026-07-21', 700], ['2026-11-30', 800]] as [$due, $price]) {
            $this->invoice($tid, $branch, $customer, '2026-06-01', $price * 100, 1, $due);
        }

        $result = $this->toolResult($this->runTool($auth['token'], 'finance.receivables_aging', ['as_of' => self::TODAY]));
        $expected = $this->direct($tid, $this->ownerId($tid), fn (ReportService $r) => $r->aging('receivable', ['as_of' => self::TODAY]));

        foreach (['b0_30', 'b31_60', 'b61_90', 'b90_plus', 'total'] as $bucket) {
            $this->assertSame($expected['totals'][$bucket], $result['totals'][$bucket]['minor'], $bucket);
            $this->assertSame($expected['rows'][0][$bucket], $result['rows'][0][$bucket]['minor'], "row {$bucket}");
        }
        // الحدود: 0/30 ← b0_30 (مع غير المستحق)، 31/60 ← b31_60، 61/90 ← b61_90، 91 ← b90_plus.
        $this->assertSame((100 + 200 + 800) * 115, $result['totals']['b0_30']['minor'], 'b0_30 = due today, 30d late, not yet due');
        $this->assertSame((300 + 400) * 115, $result['totals']['b31_60']['minor']);
        $this->assertSame((500 + 600) * 115, $result['totals']['b61_90']['minor']);
        $this->assertSame(700 * 115, $result['totals']['b90_plus']['minor']);
        $this->assertSame($expected['rows'][0]['partner_id'], $result['rows'][0]['partner_id']);
        $this->assertSame(self::SECRET_NAME, $result['rows'][0]['name']);
        $this->assertSame([], $result['warnings']);
    }

    /** @test */
    public function payables_aging_matches_report_service_and_labels_its_basis(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $supplier = $this->partner($tid, 'supplier', 'مورد');
        $this->purchase($tid, $this->mainBranch($tid), $supplier, '2026-10-01', 4000, 10);   // 46,000
        $this->purchase($tid, $this->mainBranch($tid), $supplier, '2026-06-01', 1000, 3);

        $result = $this->toolResult($this->runTool($auth['token'], 'finance.payables_aging', ['as_of' => self::TODAY]));
        $expected = $this->direct($tid, $this->ownerId($tid), fn (ReportService $r) => $r->aging('payable', ['as_of' => self::TODAY]));

        $this->assertSame('payables_aging', $result['report']);
        $this->assertSame($expected['totals']['total'], $result['totals']['total']['minor']);
        $this->assertSame($expected['totals']['b90_plus'], $result['totals']['b90_plus']['minor']);
        $this->assertSame([
            'method' => 'document_remaining_balance',
            'documents' => 'posted_purchases_not_fully_paid',
            'balance_semantics' => 'current_outstanding_balance',
            'age_reference' => 'due_date_else_document_date',
            'reconciled_to_control_ledger' => false,
        ], $result['basis']);
        $this->assertSame(['b0_30', 'b31_60', 'b61_90', 'b90_plus'], array_column($result['buckets'], 'key'));
        $this->assertSame('/api/reports/aging/payable?as_of=2026-10-20', $result['sources'][0]['api_path']);
        $this->assertSame('/reports/purchases/aging', $result['sources'][0]['ui_path']);
    }

    /** @test */
    public function a_past_as_of_is_flagged_as_not_historical_because_balances_are_current(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $this->invoice($tid, $this->mainBranch($tid), $this->partner($tid, 'customer', 'عميل'), '2026-05-01', 100000);

        $result = $this->toolResult($this->runTool($auth['token'], 'finance.receivables_aging', ['as_of' => '2026-08-01']));

        $this->assertSame([['code' => 'as_of_not_historical']], $result['warnings']);
        $this->assertSame('current_outstanding_balance', $result['basis']['balance_semantics']);
        $expected = $this->direct($tid, $this->ownerId($tid), fn (ReportService $r) => $r->aging('receivable', ['as_of' => '2026-08-01']));
        $this->assertSame($expected['totals']['total'], $result['totals']['total']['minor']);
    }

    // ───────────────────────── تواريخ ومنطقة زمنية وحدود ─────────────────────────

    /** @test */
    public function dates_are_validated_in_the_tenants_timezone_not_utc(): void
    {
        $auth = $this->financeTenant();
        // 22:30 UTC في 2026-10-20 = 01:30 في 2026-10-21 بالرياض: اليوم المحلي هو 21.
        Carbon::setTestNow('2026-10-20 22:30:00 UTC');

        $this->toolResult($this->runTool($auth['token'], 'finance.receivables_aging', ['as_of' => '2026-10-21']));
        $this->runTool($auth['token'], 'finance.receivables_aging', ['as_of' => '2026-10-22'])
            ->assertStatus(422)->assertJsonPath('error.code', 'invalid_tool_arguments');
    }

    /** @test */
    public function malformed_or_out_of_bounds_tool_arguments_are_rejected_before_any_report_runs(): void
    {
        $auth = $this->financeTenant();
        $reads = 0;
        DB::listen(function ($q) use (&$reads) {
            if (str_contains($q->sql, 'journal_lines') || str_contains($q->sql, '"invoices"')) {
                $reads++;
            }
        });

        $bad = [
            ['finance.income_statement', []],
            ['finance.income_statement', ['from' => '2026-10-01']],
            ['finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20', 'branch_id' => 'x']],     // مفتاح مجهول
            ['finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20', 'sql' => 'select 1']],
            ['finance.income_statement', ['from' => '2026-13-01', 'to' => '2026-10-20']],
            ['finance.income_statement', ['from' => '2026-02-30', 'to' => '2026-10-20']],
            ['finance.income_statement', ['from' => '20261001', 'to' => '2026-10-20']],
            ['finance.income_statement', ['from' => '1999-01-01', 'to' => '2026-10-20']],
            ['finance.income_statement', ['from' => ['2026-10-01'], 'to' => '2026-10-20']],
            ['finance.income_statement', ['from' => '2026-10-20', 'to' => '2026-10-01']],                          // معكوسة
            ['finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-21']],                          // مستقبل
            ['finance.income_statement', ['from' => '2025-10-19', 'to' => '2026-10-20']],                          // 367 يوماً
            ['finance.receivables_aging', []],
            ['finance.receivables_aging', ['as_of' => 'today']],
            ['finance.payables_aging', ['as_of' => '2026-10-20', 'extra' => 1]],
        ];
        foreach ($bad as $i => [$tool, $args]) {
            $res = $this->runTool($auth['token'], $tool, $args);
            $res->assertStatus(422);
            $this->assertSame('invalid_tool_arguments', $res->json('error.code'), "case {$i}");
        }
        $this->assertSame(0, $reads, 'no report query runs for invalid arguments');

        // 366 يوماً شاملة الطرفين مقبولة.
        $this->toolResult($this->runTool($auth['token'], 'finance.income_statement', ['from' => '2025-10-20', 'to' => '2026-10-20']));
    }

    // ───────────────────────── SAR فقط ─────────────────────────

    /** @test */
    public function a_non_sar_tenant_is_refused_before_any_financial_read(): void
    {
        $auth = $this->financeTenant();
        Tenant::whereKey($auth['tenant_id'])->update(['currency' => 'USD']);
        $reads = 0;
        DB::listen(function ($q) use (&$reads) {
            if (str_contains($q->sql, 'journal_lines')) {
                $reads++;
            }
        });

        $res = $this->runTool($auth['token'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']);

        $res->assertStatus(422)->assertJsonPath('error.code', 'currency_unsupported');
        $this->assertSame(0, $reads);
        $this->assertArrayNotHasKey('data', $res->json());
    }

    // ───────────────────────── التفويض والموافقة ─────────────────────────

    /** @test */
    public function financial_summary_consent_is_required_independently_of_message_consent(): void
    {
        $auth = $this->financeTenant();
        $this->aiOptIn($auth['tenant_id'], [AiAssistantDataCategory::ASSISTANT_MESSAGES]);

        $this->runTool($auth['token'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20'])
            ->assertForbidden()->assertJsonPath('error.code', 'consent_required');
    }

    /** @test */
    public function the_report_permission_is_required_in_addition_to_the_assistant_permission(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $token = $this->customRoleToken($tid, 'ai_only', ['ai.assistant.use'], 'aionly@fin.test');

        $res = $this->runTool($token, 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']);

        $res->assertForbidden()->assertJsonPath('error.code', 'tool_permission_denied');
        $this->assertArrayNotHasKey('data', $res->json());
        // ولا يكفي reports.view وحدها بلا صلاحية المساعد.
        $reportsOnly = $this->customRoleToken($tid, 'reports_only', ['reports.view'], 'repo@fin.test');
        $this->runTool($reportsOnly, 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20'])->assertForbidden();
    }

    /** @test */
    public function the_default_accountant_can_use_the_tools_once_consent_exists(): void
    {
        $auth = $this->financeTenant();
        $token = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@fin.test');

        $this->toolResult($this->runTool($token, 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']));
        $this->toolResult($this->runTool($token, 'finance.receivables_aging', ['as_of' => self::TODAY]));
    }

    /** @test */
    public function reports_view_revoked_after_planning_blocks_execution_with_no_report_read(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $token = $this->tokenForRole($tid, 'accountant', 'acc@fin.test');
        $reads = 0;
        DB::listen(function ($q) use (&$reads) {
            if (str_contains($q->sql, 'journal_lines')) {
                $reads++;
            }
        });
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(function () use ($tid) {
            $this->inTenant($tid, null, fn () => Role::where('slug', 'accountant')->update(['permissions' => array_values(array_diff(\App\Support\Rbac::MATRIX['accountant'], ['reports.view']))]));

            return [['name' => 'finance.income_statement', 'arguments' => ['from' => '2026-10-01', 'to' => '2026-10-20']]];
        }));

        $this->aiAsk($token)->assertForbidden()->assertJsonPath('error.code', 'tool_permission_denied');

        $this->assertSame(0, $reads);
    }

    /** @test */
    public function partner_names_are_withheld_without_partners_view_while_totals_stay_exact(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $customer = $this->partner($tid, 'customer', self::SECRET_NAME);
        $this->invoice($tid, $this->mainBranch($tid), $customer, '2026-06-01', 100000, 1, '2026-06-01');
        $withheld = $this->customRoleToken($tid, 'fin_no_partners', ['ai.assistant.use', 'reports.view'], 'np@fin.test');
        $included = $this->customRoleToken($tid, 'fin_partners', ['ai.assistant.use', 'reports.view', 'partners.view'], 'wp@fin.test');

        $a = $this->runTool($withheld, 'finance.receivables_aging', ['as_of' => self::TODAY]);
        $b = $this->runTool($included, 'finance.receivables_aging', ['as_of' => self::TODAY]);

        $resultA = $this->toolResult($a);
        $resultB = $this->toolResult($b);
        $this->assertSame('withheld', $resultA['partner_detail']);
        $this->assertSame([], $resultA['rows']);
        $this->assertStringNotContainsString(self::SECRET_NAME, $a->getContent());
        $this->assertStringNotContainsString($customer, $a->getContent());
        $this->assertSame('included', $resultB['partner_detail']);
        $this->assertSame(self::SECRET_NAME, $resultB['rows'][0]['name']);
        $this->assertSame($resultB['totals'], $resultA['totals'], 'withholding detail never changes the numbers');
    }

    // ───────────────────────── العزل: مستأجر / فرع / مخزن ─────────────────────────

    /** @test */
    public function another_tenants_documents_never_appear(): void
    {
        $a = $this->financeTenant('fin-a');
        $b = $this->financeTenant('fin-b');
        $this->invoice($b['tenant_id'], $this->mainBranch($b['tenant_id']), $this->partner($b['tenant_id'], 'customer', self::SECRET_NAME), '2026-10-05', 99999900);
        $this->invoice($a['tenant_id'], $this->mainBranch($a['tenant_id']), $this->partner($a['tenant_id'], 'customer', 'عميل أ'), '2026-10-05', 100000);

        $income = $this->runTool($a['token'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']);
        $aging = $this->runTool($a['token'], 'finance.receivables_aging', ['as_of' => self::TODAY]);

        $this->assertSame(100000, $this->toolResult($income)['totals']['total_revenue']['minor']);
        $this->assertStringNotContainsString(self::SECRET_NAME, $aging->getContent());
        $this->assertSame(115000, $this->toolResult($aging)['totals']['total']['minor']);
    }

    /** @test */
    public function branch_scope_filters_results_and_reports_unallocated_explicitly(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $main = $this->mainBranch($tid);
        $other = $this->newBranch($auth['token']);
        $customer = $this->partner($tid, 'customer', 'عميل');
        $this->invoice($tid, $main, $customer, '2026-10-05', 100000);
        $this->invoice($tid, $other, $customer, '2026-10-06', 300000);
        $this->expense($tid, '2026-10-07', 4000);       // بلا فرع

        $all = $this->toolResult($this->runTool($auth['token'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']));
        $onlyOther = $this->toolResult($this->runTool($auth['token'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20'], ['scope' => ['branch_ids' => [$other]]]));

        $this->assertSame(400000, $all['totals']['total_revenue']['minor']);
        $this->assertArrayNotHasKey('unallocated', $all);
        $this->assertSame(['mode' => 'selected', 'ids' => [$other]], $onlyOther['scope']['branch']);
        $this->assertSame(300000, $onlyOther['totals']['total_revenue']['minor']);
        $expected = $this->direct($tid, $this->ownerId($tid), fn (ReportService $r) => $r->incomeStatement(['from' => '2026-10-01', 'to' => '2026-10-20', 'branch_id' => [$other]]));
        $this->assertSame($expected['unallocated']['total_expense'], $onlyOther['unallocated']['total_expense']['minor']);
        $this->assertSame(4000, $onlyOther['unallocated']['total_expense']['minor']);
        $this->assertStringContainsString('branch_id', $onlyOther['sources'][0]['api_path']);

        $aging = $this->toolResult($this->runTool($auth['token'], 'finance.receivables_aging', ['as_of' => self::TODAY], ['scope' => ['branch_ids' => [$main]]]));
        $this->assertSame(115000, $aging['totals']['total']['minor']);
    }

    /** @test */
    public function a_restricted_user_is_pinned_to_their_branches_and_a_forbidden_branch_is_rejected_not_widened(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $main = $this->mainBranch($tid);
        $other = $this->newBranch($auth['token']);
        $customer = $this->partner($tid, 'customer', 'عميل');
        $this->invoice($tid, $main, $customer, '2026-10-05', 100000);
        $this->invoice($tid, $other, $customer, '2026-10-06', 300000);
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'مقيَّد', 'email' => 'br@fin.test', 'password' => 'password123', 'role' => 'admin', 'branch_ids' => [$other],
        ])->assertCreated();
        $token = $this->postJson('/api/login', ['email' => 'br@fin.test', 'password' => 'password123'])->assertOk()['token'];

        // بلا طلب نطاق: مقيَّد بفرعه فقط (لا الكل).
        $income = $this->toolResult($this->runTool($token, 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']));
        $this->assertSame(['mode' => 'assigned', 'ids' => [$other]], $income['scope']['branch']);
        $this->assertSame(300000, $income['totals']['total_revenue']['minor']);
        $aging = $this->toolResult($this->runTool($token, 'finance.receivables_aging', ['as_of' => self::TODAY]));
        $this->assertSame(345000, $aging['totals']['total']['minor']);

        // فرع ممنوع صراحةً: رفض، لا بيانات.
        $denied = $this->runTool($token, 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20'], ['scope' => ['branch_ids' => [$main]]]);
        $denied->assertForbidden()->assertJsonPath('error.code', 'branch_scope_forbidden');
        $this->assertArrayNotHasKey('data', $denied->json());
    }

    /** @test */
    public function a_branch_revoked_between_planning_and_execution_is_enforced_with_the_fresh_actor(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $main = $this->mainBranch($tid);
        $other = $this->newBranch($auth['token']);
        $this->invoice($tid, $main, $this->partner($tid, 'customer', 'عميل'), '2026-10-05', 100000);
        $this->invoice($tid, $other, $this->partner($tid, 'customer', 'عميل ٢'), '2026-10-06', 300000);
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'مقيَّد', 'email' => 'br@fin.test', 'password' => 'password123', 'role' => 'admin', 'branch_ids' => [$main, $other],
        ])->assertCreated();
        $token = $this->postJson('/api/login', ['email' => 'br@fin.test', 'password' => 'password123'])->assertOk()['token'];
        $userId = $this->inTenant($tid, null, fn () => User::where('email', 'br@fin.test')->firstOrFail()->id);

        // يطلب الفرعين، ثم يُسحب أحدهما أثناء الطلب (بعد التخطيط): الطلب كله يُرفض لا يتّسع ولا يتقلّص صامتاً.
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(function () use ($tid, $userId, $other) {
            $this->inTenant($tid, null, fn () => DB::table('branch_user')->where('user_id', $userId)->where('branch_id', $other)->delete());

            return [['name' => 'finance.income_statement', 'arguments' => ['from' => '2026-10-01', 'to' => '2026-10-20']]];
        }));

        $res = $this->aiAsk($token, ['scope' => ['branch_ids' => [$main, $other]]]);

        $res->assertForbidden()->assertJsonPath('error.code', 'branch_scope_forbidden');
        $this->assertArrayNotHasKey('data', $res->json());
    }

    /** @test */
    public function warehouse_selection_is_rejected_for_warehouse_less_tools_and_cross_tenant_ids_are_forbidden(): void
    {
        $a = $this->financeTenant('fin-a');
        $b = $this->financeTenant('fin-b');
        $warehouseA = $this->withToken($a['token'])->getJson('/api/warehouses')['data'][0]['id'];
        $warehouseB = $this->withToken($b['token'])->getJson('/api/warehouses')['data'][0]['id'];
        $branchB = $this->mainBranch($b['tenant_id']);

        $this->runTool($a['token'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20'], ['scope' => ['warehouse_ids' => [$warehouseA]]])
            ->assertStatus(422)->assertJsonPath('error.code', 'scope_not_supported');
        $this->runTool($a['token'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20'], ['scope' => ['warehouse_ids' => [$warehouseB]]])
            ->assertForbidden()->assertJsonPath('error.code', 'warehouse_scope_forbidden');
        $this->runTool($a['token'], 'finance.receivables_aging', ['as_of' => self::TODAY], ['scope' => ['branch_ids' => [$branchB]]])
            ->assertForbidden()->assertJsonPath('error.code', 'branch_scope_forbidden');
    }

    /** @test */
    public function a_warehouse_restricted_user_gets_company_wide_financials_like_the_existing_reports(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $mine = $this->withToken($auth['token'])->getJson('/api/warehouses')['data'][0]['id'];
        $this->invoice($tid, $this->mainBranch($tid), $this->partner($tid, 'customer', 'عميل'), '2026-10-05', 100000);
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'مقيَّد مخزن', 'email' => 'wh@fin.test', 'password' => 'password123', 'role' => 'admin', 'warehouse_ids' => [$mine],
        ])->assertCreated();
        $token = $this->postJson('/api/login', ['email' => 'wh@fin.test', 'password' => 'password123'])->assertOk()['token'];

        $res = $this->runTool($token, 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']);

        $result = $this->toolResult($res);
        $this->assertSame(100000, $result['totals']['total_revenue']['minor']);
        $this->assertSame(['mode' => 'not_applicable', 'ids' => []], $result['scope']['warehouse']);
        $this->assertSame('assigned', $res->json('data.scope.warehouse.mode'));
    }

    // ───────────────────────── المخطِّط الحتمي والتدقيق ─────────────────────────

    /** @test */
    public function the_default_mock_planner_runs_the_right_tool_from_arabic_and_english_keywords(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $this->invoice($tid, $this->mainBranch($tid), $this->partner($tid, 'customer', 'عميل'), '2026-10-05', 100000);

        $cases = [
            'show me the income statement please' => 'finance.income_statement',
            'اعرض قائمة الدخل' => 'finance.income_statement',
            'receivables aging report' => 'finance.receivables_aging',
            'أعمار الذمم المدينة' => 'finance.receivables_aging',
            'payables aging' => 'finance.payables_aging',
            'أعمار الذمم الدائنة' => 'finance.payables_aging',
        ];
        foreach ($cases as $message => $tool) {
            $res = $this->aiAsk($auth['token'], ['message' => $message])->assertOk();
            $this->assertSame([$tool], array_column($res->json('data.tool_calls'), 'tool'), $message);
        }

        // قائمة الدخل الافتراضية: من أول الشهر المحلي حتى اليوم.
        $res = $this->aiAsk($auth['token'], ['message' => 'income statement'])->assertOk();
        $this->assertSame(['from' => '2026-10-01', 'to' => '2026-10-20', 'inclusive' => true], $res->json('data.tool_calls.0.result.period'));

        // رسالة بلا كلمات مفتاحية لا تشغّل أداة.
        $this->assertSame([], $this->aiAsk($auth['token'], ['message' => 'مرحباً'])->assertOk()->json('data.tool_calls'));
    }

    /** @test */
    public function tool_invocations_are_audited_with_counts_only_never_amounts_or_names(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $this->invoice($tid, $this->mainBranch($tid), $this->partner($tid, 'customer', self::SECRET_NAME), '2026-06-01', 123457, 1, '2026-06-01');
        $this->invoice($tid, $this->mainBranch($tid), $this->partner($tid, 'customer', 'عميل ٢'), '2026-10-05', 987651);

        $a = $this->runTool($auth['token'], 'finance.receivables_aging', ['as_of' => self::TODAY])->assertOk();
        $b = $this->runTool($auth['token'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20'])->assertOk();

        $tools = $this->auditEvents()->where('event', 'tool.invoked');
        $this->assertEqualsCanonicalizing(['finance.receivables_aging', 'finance.income_statement'], $tools->pluck('tool')->all());
        $aging = $tools->firstWhere('tool', 'finance.receivables_aging');
        $this->assertSame(['allowed', 'ok'], [$aging->outcome, $aging->reason]);
        $this->assertEquals(['row_count' => 2, 'partner_detail' => 'included', 'branch_mode' => 'all', 'branch_count' => 0], $aging->meta);
        $income = $tools->firstWhere('tool', 'finance.income_statement');
        $this->assertSame(20, $income->meta['period_days']);

        // لا رقم مالي ولا اسم طرف في أي صف تدقيق.
        $dump = json_encode(DB::table('ai_audit_events')->get(), JSON_UNESCAPED_UNICODE);
        foreach ([self::SECRET_NAME, '123457', '987651', 'عميل ٢', (string) 123457 * 115 / 100] as $needle) {
            $this->assertStringNotContainsString((string) $needle, $dump);
        }
        $this->assertNotNull($a->json('data.request_id'));
        $this->assertNotNull($b->json('data.request_id'));
    }

    /** @test */
    public function denied_tool_calls_are_audited_with_their_reason(): void
    {
        $auth = $this->financeTenant();
        $token = $this->customRoleToken($auth['tenant_id'], 'ai_only', ['ai.assistant.use'], 'aionly@fin.test');

        $res = $this->runTool($token, 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20'])->assertForbidden();

        $events = $this->auditEvents($res->json('request_id'));
        $denied = $events->firstWhere('event', 'tool.denied');
        $this->assertSame(['finance.income_statement', 'denied', 'tool_permission_denied'], [$denied->tool, $denied->outcome, $denied->reason]);
        $this->assertNotNull($events->firstWhere('event', 'request.denied'));
    }

    // ───────────────────────── قراءة فقط، بلا شبكة ─────────────────────────

    /** @test */
    public function the_tools_write_nothing_and_run_no_generated_sql(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $this->invoice($tid, $this->mainBranch($tid), $this->partner($tid, 'customer', 'عميل'), '2026-10-05', 100000);
        $writes = [];
        DB::listen(function ($q) use (&$writes) {
            if (preg_match('/^\s*(insert|update|delete)\s+(into\s+)?"?(\w+)/i', $q->sql, $m) && ! str_starts_with($m[3], 'ai_') && $m[3] !== 'personal_access_tokens') {
                $writes[] = $q->sql;
            }
        });

        $this->toolResult($this->runTool($auth['token'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']));
        $this->toolResult($this->runTool($auth['token'], 'finance.payables_aging', ['as_of' => self::TODAY]));

        $this->assertSame([], $writes, 'finance tools never write to accounting tables');
    }

    /** @test */
    public function the_finance_tool_sources_contain_no_sql_network_or_recalculation(): void
    {
        $files = ['app/Services/AiFinanceReportTool.php', 'app/Services/AiIncomeStatementTool.php', 'app/Services/AiAgingReportTool.php', 'app/Services/AiAssistantToolRegistry.php'];
        $forbidden = ['DB::', 'selectRaw', 'whereRaw', 'JournalLine', 'Invoice::', 'Purchase::', 'Http::', 'GuzzleHttp', 'curl_', 'file_get_contents', 'api_key', 'floatval', '(float)', 'round(', 'anthropic', 'openai', 'gemini'];

        foreach ($files as $file) {
            $path = base_path($file);
            $this->assertFileExists($path, $file);
            $code = implode("\n", array_map(
                fn ($token) => is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true) ? '' : (is_array($token) ? $token[1] : $token),
                token_get_all(file_get_contents($path)),
            ));
            foreach ($forbidden as $needle) {
                $this->assertStringNotContainsStringIgnoringCase($needle, $code, "{$file} must not contain `{$needle}`");
            }
        }
    }

    /** @test */
    public function the_registry_still_exposes_no_unreviewed_tools(): void
    {
        $this->assertEqualsCanonicalizing(
            ['finance.income_statement', 'finance.receivables_aging', 'finance.payables_aging'],
            app(AiAssistantToolRegistry::class)->names(),
        );
    }
}
