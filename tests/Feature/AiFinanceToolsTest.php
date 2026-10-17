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
        $this->assertSame(['mode' => 'not_applicable', 'ids' => [], 'reason' => 'financial_reports_have_no_warehouse_dimension', 'user_restriction_applied' => false], $result['scope']['warehouse']);
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
            'as_of_role' => 'age_reference_only',
            'historical_balance_rebuilt' => false,
            'balance_as_of' => 'generation_time',
            'age_reference' => 'due_date_else_document_date',
            'reconciled_to_control_ledger' => false,
        ], $result['basis']);
        $this->assertSame(['b0_30', 'b31_60', 'b61_90', 'b90_plus'], array_column($result['buckets'], 'key'));
        $this->assertSame('/api/reports/aging/payable?as_of=2026-10-20', $result['sources'][0]['api_path']);
        $this->assertSame('/reports/purchases/aging', $result['sources'][0]['ui_path']);
    }

    /** @test */
    public function a_past_as_of_only_moves_the_age_reference_and_is_flagged_as_not_historical(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $customer = $this->partner($tid, 'customer', 'عميل');
        // فاتورة مستحقة في 2026-05-01 وسُدّدت بالكامل «اليوم» (2026-10-20): في 2026-08-01 كانت مفتوحة فعلاً.
        $paid = $this->invoice($tid, $this->mainBranch($tid), $customer, '2026-05-01', 100000, 1, '2026-05-01');
        $this->inTenant($tid, null, function () use ($customer, $paid) {
            $payments = app(\App\Services\Accounting\PaymentService::class);
            $payments->post($payments->create(['partner_id' => $customer, 'invoice_id' => $paid, 'amount' => 115000]));
        });
        // وفاتورة أخرى ما زالت مفتوحة، مرجع عمرها يتغيّر مع as_of.
        $this->invoice($tid, $this->mainBranch($tid), $customer, '2026-06-01', 200000, 1, '2026-06-01');

        $past = $this->toolResult($this->runTool($auth['token'], 'finance.receivables_aging', ['as_of' => '2026-08-01']));
        $today = $this->toolResult($this->runTool($auth['token'], 'finance.receivables_aging', ['as_of' => self::TODAY]));

        // الرصيد حاليّ في الحالتين: المسدَّدة غائبة حتى عند as_of ماضٍ (لا يُعاد بناء رصيد 2026-08-01).
        $this->assertSame(230000, $past['totals']['total']['minor']);
        $this->assertSame($past['totals']['total'], $today['totals']['total']);
        // لكن مرجع العمر تحرّك: 2026-06-01 → 61 يوماً عند 2026-08-01 مقابل 141 عند اليوم.
        $this->assertSame(230000, $past['totals']['b61_90']['minor']);
        $this->assertSame(230000, $today['totals']['b90_plus']['minor']);
        $this->assertSame(0, $past['totals']['b90_plus']['minor']);

        // المطابقة مع ReportService نفسه.
        $expected = $this->direct($tid, $this->ownerId($tid), fn (ReportService $r) => $r->aging('receivable', ['as_of' => '2026-08-01']));
        $this->assertSame($expected['totals']['b61_90'], $past['totals']['b61_90']['minor']);

        // الوسم صريح وقابل للقراءة آلياً.
        $this->assertSame('2026-08-01', $past['as_of']);
        $this->assertSame('age_reference_only', $past['basis']['as_of_role']);
        $this->assertFalse($past['basis']['historical_balance_rebuilt']);
        $this->assertSame('current_outstanding_balance', $past['basis']['balance_semantics']);
        $this->assertSame('generation_time', $past['basis']['balance_as_of']);
        $this->assertSame(
            [['code' => 'as_of_not_historical', 'as_of' => '2026-08-01', 'balance_as_of' => 'generation_time']],
            $past['warnings'],
        );
        // اليوم المحلي: لا تحذير، ويبقى الوصف نفسه لأن الرصيد دائماً حاليّ.
        $this->assertSame([], $today['warnings']);
        $this->assertSame($past['basis'], $today['basis']);
    }

    /** @test */
    public function the_not_historical_warning_applies_to_both_aging_tools(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $this->purchase($tid, $this->mainBranch($tid), $this->partner($tid, 'supplier', 'مورد'), '2026-05-01', 4000, 10);

        foreach (['finance.receivables_aging', 'finance.payables_aging'] as $tool) {
            $past = $this->toolResult($this->runTool($auth['token'], $tool, ['as_of' => '2026-09-30']));
            $this->assertSame('as_of_not_historical', $past['warnings'][0]['code'], $tool);
            $this->assertSame('age_reference_only', $past['basis']['as_of_role'], $tool);

            $today = $this->toolResult($this->runTool($auth['token'], $tool, ['as_of' => self::TODAY]));
            $this->assertSame([], $today['warnings'], $tool);
        }
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
        $this->assertSame(['mode' => 'not_applicable', 'ids' => [], 'reason' => 'financial_reports_have_no_warehouse_dimension', 'user_restriction_applied' => false], $result['scope']['warehouse']);
        $this->assertSame('assigned', $res->json('data.scope.warehouse.mode'));
    }

    // ───────────────────────── مراجعة نهائية: مطابقة مسارات /api/reports/* وتقييد المخازن ─────────────────────────

    /** @return array{owner:string, accountant:string, branch:string, warehouse:string, both:string, ids:array<string,string>} */
    private function actorMatrix(array $auth): array
    {
        $tid = $auth['tenant_id'];
        $main = $this->mainBranch($tid);
        $other = $this->newBranch($auth['token']);
        $whMine = $this->withToken($auth['token'])->getJson('/api/warehouses')['data'][0]['id'];
        $whOther = $this->withToken($auth['token'])->postJson('/api/warehouses', ['name' => 'مخزن آخر'])->assertCreated()['data']['id'];
        $customer = $this->partner($tid, 'customer', 'عميل');
        $supplier = $this->partner($tid, 'supplier', 'مورد');
        $this->invoice($tid, $main, $customer, '2026-10-05', 100000, 1, '2026-09-01');
        $this->invoice($tid, $other, $customer, '2026-10-06', 300000, 1, '2026-06-01');
        $this->purchase($tid, $main, $supplier, '2026-10-02', 4000, 10);
        $this->purchase($tid, $other, $supplier, '2026-06-02', 5000, 4);
        $this->expense($tid, '2026-10-07', 4000);

        // مباشرةً لا عبر /api/users: خطة التجربة تحدّ عدد المستخدمين، وما يُختبر هنا هو النطاق لا إدارة المستخدمين.
        $make = function (string $email, array $scope) use ($tid) {
            return $this->inTenant($tid, null, function () use ($email, $scope, $tid) {
                $user = User::create(['tenant_id' => $tid, 'name' => $email, 'email' => $email, 'password' => 'password123', 'role' => 'admin']);
                $user->branches()->sync($scope['branch_ids'] ?? []);
                $user->warehouses()->sync($scope['warehouse_ids'] ?? []);

                return $user->createToken('api')->plainTextToken;
            });
        };

        return [
            'owner' => $auth['token'],
            'accountant' => $this->tokenForRole($tid, 'accountant', 'acc@fin.test'),
            'branch' => $make('b@fin.test', ['branch_ids' => [$other]]),
            'warehouse' => $make('w@fin.test', ['warehouse_ids' => [$whMine]]),
            'both' => $make('bw@fin.test', ['branch_ids' => [$main], 'warehouse_ids' => [$whMine]]),
            'ids' => ['main' => $main, 'other' => $other, 'whMine' => $whMine, 'whOther' => $whOther],
        ];
    }

    /** @test */
    public function for_every_actor_kind_the_tools_return_exactly_what_the_report_api_returns_to_that_user(): void
    {
        $auth = $this->financeTenant();
        $actors = $this->actorMatrix($auth);

        foreach (['owner', 'accountant', 'branch', 'warehouse', 'both'] as $kind) {
            $token = $actors[$kind];

            // قائمة الدخل
            $api = $this->withToken($token)->getJson('/api/reports/income-statement?from=2026-10-01&to=2026-10-20')->assertOk();
            $tool = $this->toolResult($this->runTool($token, 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']));
            foreach (['total_revenue', 'total_expense', 'net_income'] as $key) {
                $this->assertSame($api->json($key), $tool['totals'][$key]['decimal'], "{$kind} income {$key}");
            }
            $this->assertSame(
                array_map(fn ($r) => [$r['code'], $r['amount']], $api->json('revenues')),
                array_map(fn ($r) => [$r['code'], $r['amount']['decimal']], $tool['revenues']),
                "{$kind} revenue rows",
            );

            // أعمار الذمم (مدينة ودائنة)
            foreach (['receivable' => 'finance.receivables_aging', 'payable' => 'finance.payables_aging'] as $type => $name) {
                $api = $this->withToken($token)->getJson("/api/reports/aging/{$type}?as_of=" . self::TODAY)->assertOk();
                $tool = $this->toolResult($this->runTool($token, $name, ['as_of' => self::TODAY]));
                foreach (['b0_30', 'b31_60', 'b61_90', 'b90_plus', 'total'] as $bucket) {
                    $this->assertSame($api->json("totals.{$bucket}"), $tool['totals'][$bucket]['decimal'], "{$kind} {$type} {$bucket}");
                }
                $this->assertSame($api->json('rows.*.partner_id'), array_column($tool['rows'], 'partner_id'), "{$kind} {$type} partners");
            }
        }
    }

    /** @test */
    public function a_warehouse_restriction_neither_blocks_nor_widens_the_financial_tools(): void
    {
        $auth = $this->financeTenant();
        $actors = $this->actorMatrix($auth);

        // المقيَّد بمخزن (بلا تقييد فرع) يرى كل الفروع كالمالك، تماماً كمساره في الـAPI.
        $owner = $this->toolResult($this->runTool($actors['owner'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']));
        $res = $this->runTool($actors['warehouse'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']);
        $wh = $this->toolResult($res);
        $this->assertSame($owner['totals'], $wh['totals']);
        $this->assertSame('not_applicable', $wh['scope']['warehouse']['mode']);
        $this->assertFalse($wh['scope']['warehouse']['user_restriction_applied']);
        $this->assertSame('financial_reports_have_no_warehouse_dimension', $wh['scope']['warehouse']['reason']);
        $this->assertSame('all', $wh['scope']['branch']['mode'], 'a warehouse restriction implies no branch restriction');

        // أما تقييد الفرع فيبقى سارياً حتى مع تقييد المخزن (لا يُضعفه وجود تقييد مخزن).
        $both = $this->toolResult($this->runTool($actors['both'], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']));
        $this->assertSame(['mode' => 'assigned', 'ids' => [$actors['ids']['main']]], $both['scope']['branch']);
        $this->assertSame(100000, $both['totals']['total_revenue']['minor']);
        $this->assertLessThan($owner['totals']['total_revenue']['minor'], $both['totals']['total_revenue']['minor']);
    }

    /**
     * مراجعة الجاهزية للدمج: لا تُوصَف أرقام مالية لمستخدم مقيَّد بمخازن بأنها خاصة بمخازنه، في أي موضع من
     * الردّ — نتيجة الأداة أو غلاف البوابة.
     *
     * @test
     */
    public function financial_figures_are_never_described_as_warehouse_specific_for_a_warehouse_restricted_user(): void
    {
        $auth = $this->financeTenant();
        $actors = $this->actorMatrix($auth);
        $mine = $actors['ids']['whMine'];

        $calls = [
            ['finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']],
            ['finance.receivables_aging', ['as_of' => self::TODAY]],
            ['finance.payables_aging', ['as_of' => '2026-09-01']],
        ];
        foreach ($calls as [$tool, $args]) {
            $res = $this->runTool($actors['warehouse'], $tool, $args)->assertOk();
            $result = $res->json('data.tool_calls.0.result');

            // ١) في نتيجة الأداة: كلمة «warehouse» لا تظهر إلا داخل `scope.warehouse` الذي ينفي التطبيق صراحةً.
            $paths = [];
            $walk = function (array $node, string $path) use (&$walk, &$paths) {
                foreach ($node as $key => $value) {
                    $here = $path === '' ? (string) $key : $path . '.' . $key;
                    if (stripos((string) $key, 'warehouse') !== false || (is_string($value) && stripos($value, 'warehouse') !== false)) {
                        $paths[] = $here;
                    }
                    if (is_array($value)) {
                        $walk($value, $here);
                    }
                }
            };
            $walk($result, '');
            $this->assertNotEmpty($paths, "{$tool}: the result must state the warehouse position explicitly");
            foreach ($paths as $path) {
                $this->assertStringStartsWith('scope.warehouse', $path, "{$tool}: `{$path}` must not live outside scope.warehouse");
            }
            $this->assertSame(
                ['mode' => 'not_applicable', 'ids' => [], 'reason' => 'financial_reports_have_no_warehouse_dimension', 'user_restriction_applied' => false],
                $result['scope']['warehouse'],
                $tool,
            );
            // ٢) معرّف مخزنه لا يظهر في الأرقام ولا في أي حقل من النتيجة.
            $this->assertStringNotContainsString($mine, json_encode($result), $tool);

            // ٣) غلاف البوابة يُعرِّف نفسه نطاقَ تفويضٍ لا مرشِّح بيانات، فلا يُقرأ `assigned` على أنه تصفية.
            $this->assertSame('authorization', $res->json('data.scope_kind'), $tool);
            $this->assertSame(['mode' => 'assigned', 'ids' => [$mine]], $res->json('data.scope.warehouse'), $tool);
        }
    }

    /** @test */
    public function naming_warehouses_is_always_explicit_never_silently_ignored_or_widened(): void
    {
        $auth = $this->financeTenant();
        $actors = $this->actorMatrix($auth);
        $args = ['from' => '2026-10-01', 'to' => '2026-10-20'];

        // مخزنه هو: لا يملك التقرير بُعد مخزن فلا يُدّعى أنه صُفّي به.
        $this->runTool($actors['warehouse'], 'finance.income_statement', $args, ['scope' => ['warehouse_ids' => [$actors['ids']['whMine']]]])
            ->assertStatus(422)->assertJsonPath('error.code', 'scope_not_supported');
        // مخزن ليس له: رفض نطاق صريح (لا يصل إلى فحص الأداة).
        $this->runTool($actors['warehouse'], 'finance.income_statement', $args, ['scope' => ['warehouse_ids' => [$actors['ids']['whOther']]]])
            ->assertForbidden()->assertJsonPath('error.code', 'warehouse_scope_forbidden');
        // المالك غير المقيَّد: اختيار مخزن صالح يُرفض بالأداة نفسها بدل تجاهله.
        foreach (['finance.receivables_aging' => ['as_of' => self::TODAY], 'finance.payables_aging' => ['as_of' => self::TODAY]] as $tool => $toolArgs) {
            $this->runTool($actors['owner'], $tool, $toolArgs, ['scope' => ['warehouse_ids' => [$actors['ids']['whMine']]]])
                ->assertStatus(422)->assertJsonPath('error.code', 'scope_not_supported');
        }
    }

    /** @test */
    public function where_the_report_api_denies_the_user_the_tools_deny_too(): void
    {
        $auth = $this->financeTenant();
        $tid = $auth['tenant_id'];
        $noReports = $this->customRoleToken($tid, 'no_reports', ['ai.assistant.use', 'invoices.view'], 'nr@fin.test');

        $this->withToken($noReports)->getJson('/api/reports/income-statement?from=2026-10-01&to=2026-10-20')->assertForbidden();
        $this->withToken($noReports)->getJson('/api/reports/aging/receivable')->assertForbidden();
        foreach ([
            ['finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']],
            ['finance.receivables_aging', ['as_of' => self::TODAY]],
            ['finance.payables_aging', ['as_of' => self::TODAY]],
        ] as [$tool, $args]) {
            $res = $this->runTool($noReports, $tool, $args);
            $res->assertForbidden()->assertJsonPath('error.code', 'tool_permission_denied');
            $this->assertArrayNotHasKey('data', $res->json());
        }
    }

    /** @test */
    public function restricted_users_never_see_another_tenants_data_even_when_naming_its_ids(): void
    {
        $a = $this->financeTenant('fin-a');
        $b = $this->financeTenant('fin-b');
        $actorsA = $this->actorMatrix($a);
        $bBranch = $this->mainBranch($b['tenant_id']);
        $bWarehouse = $this->withToken($b['token'])->getJson('/api/warehouses')['data'][0]['id'];
        $this->invoice($b['tenant_id'], $bBranch, $this->partner($b['tenant_id'], 'customer', self::SECRET_NAME), '2026-10-05', 99999900, 1, '2026-01-01');

        foreach (['warehouse', 'branch', 'both'] as $kind) {
            $income = $this->runTool($actorsA[$kind], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']);
            $aging = $this->runTool($actorsA[$kind], 'finance.receivables_aging', ['as_of' => self::TODAY]);
            foreach ([$income, $aging] as $res) {
                $res->assertOk();
                $this->assertStringNotContainsString(self::SECRET_NAME, $res->getContent(), $kind);
                $this->assertStringNotContainsString('99999900', $res->getContent(), $kind);
            }

            $this->runTool($actorsA[$kind], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20'], ['scope' => ['branch_ids' => [$bBranch]]])
                ->assertForbidden()->assertJsonPath('error.code', 'branch_scope_forbidden');
            $this->runTool($actorsA[$kind], 'finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20'], ['scope' => ['warehouse_ids' => [$bWarehouse]]])
                ->assertForbidden()->assertJsonPath('error.code', 'warehouse_scope_forbidden');
        }
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
            ['finance.income_statement', 'finance.receivables_aging', 'finance.payables_aging', 'documents.projected_read'],
            app(AiAssistantToolRegistry::class)->names(),
        );
    }
}
