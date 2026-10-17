<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PurchaseService;
use App\Services\Reporting\ReportService;
use App\Support\Money;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * AWJ Intelligence — AI-06: رحلة التجربة الداخلية للمساعد (Mock) من طرفها إلى طرفها.
 *
 * تحاكي ما سيفعله المالك يوم التجربة بالضبط: المنصة تُفعَّل، ثم موافقة المؤسسة عبر واجهة الإعدادات نفسها،
 * ثم الأدوات المالية الثلاث على بيانات مختلطة. تثبت: (1) لا شيء قابل للاستعمال قبل الموافقة، (2) الأرقام تطابق
 * `ReportService` هللةً بهللة، (3) الدفتر لم يتغيّر حرفاً (بصمة القيود)، (4) لا اتصال خارجي، (5) التدقيق وصفي فقط،
 * (6) مصفوفة الأدوار، (7) فئة المستندات مغلقة ما دام علم المنصة الثاني مطفأً.
 *
 * تشغيل: php artisan test --filter=AiInternalMockPilotTest
 */
class AiInternalMockPilotTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiAssistant;

    private const TODAY = '2026-10-20';
    private const CANARY = 'عميل-سري-PILOT-CANARY';

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

    private function inTenant(string $tenantId, \Closure $fn): mixed
    {
        $tenant = app(TenantContext::class);
        $branch = app(BranchContext::class);
        $tenant->set($tenantId);
        $branch->set(null);

        try {
            return $fn();
        } finally {
            $tenant->forget();
        }
    }

    /** بصمة الدفتر: عدد القيود والسطور ومجموع المدين/الدائن ومعرّفاتها مرتبةً. */
    private function ledgerFingerprint(): array
    {
        return [
            'entries' => DB::table('journal_entries')->count(),
            'lines' => DB::table('journal_lines')->count(),
            'debit' => (int) DB::table('journal_lines')->sum('debit'),
            'credit' => (int) DB::table('journal_lines')->sum('credit'),
            'ids' => md5(DB::table('journal_entries')->orderBy('id')->pluck('id')->implode(',')),
        ];
    }

    private function seedBooks(string $tid): void
    {
        $this->inTenant($tid, function () {
            $customers = [
                Partner::create(['name' => self::CANARY, 'type' => 'customer'])->id,
                Partner::create(['name' => 'شركة المنارة', 'type' => 'customer'])->id,
                Partner::create(['name' => 'مؤسسة الواحة', 'type' => 'customer'])->id,
            ];
            $suppliers = [
                Partner::create(['name' => 'مورد الدمام', 'type' => 'supplier'])->id,
                Partner::create(['name' => 'مورد الجبيل', 'type' => 'supplier'])->id,
            ];

            $invoices = app(InvoiceService::class);
            foreach ([
                [0, '2026-06-01', '2026-07-01', 1234567, 1], [0, '2026-09-25', '2026-10-25', 33333, 3],
                [1, '2026-10-02', '2026-10-20', 250000, 2], [1, '2026-08-10', '2026-09-09', 90001, 1],
                [2, '2026-10-18', null, 77777, 1],
            ] as [$c, $date, $due, $price, $qty]) {
                $invoices->post($invoices->create(
                    ['partner_id' => $customers[$c], 'payment_type' => 'credit', 'invoice_date' => $date, 'due_date' => $due],
                    [['quantity' => $qty, 'unit_price' => $price, 'tax_rate' => 15]],
                ));
            }

            $purchases = app(PurchaseService::class);
            foreach ([[0, '2026-10-01', 400000, 10], [0, '2026-06-01', 100000, 3], [1, '2026-09-15', 55555, 7]] as [$s, $date, $price, $qty]) {
                $purchases->post($purchases->create(
                    ['partner_id' => $suppliers[$s], 'payment_type' => 'credit', 'purchase_date' => $date],
                    [['quantity' => $qty, 'unit_price' => $price, 'tax_rate' => 15]],
                ));
            }

            app(LedgerService::class)->post([
                ['account_id' => \App\Models\Account::where('code', '5130')->firstOrFail()->id, 'debit' => 123457],
                ['account_id' => \App\Models\Account::where('code', '1110')->firstOrFail()->id, 'credit' => 123457],
            ], ['entry_date' => '2026-10-10', 'description' => 'مصروف تجربة']);
        });
    }

    private function direct(string $tid, callable $call): mixed
    {
        return $this->inTenant($tid, function () use ($call) {
            Auth::guard()->setUser(User::query()->where('role', 'owner')->firstOrFail());

            return $call(app(ReportService::class));
        });
    }

    private function runTool(string $token, string $tool, array $arguments)
    {
        return $this->withToken($token)->postJson('/api/ai-assistant/tools/run', ['tool' => $tool, 'arguments' => $arguments]);
    }

    /** @test */
    public function the_pilot_day_journey_enables_through_the_ui_api_and_matches_report_service_without_touching_the_ledger(): void
    {
        $auth = $this->registerTenant('pilot-a', 'owner@pilot-a.test');
        $tid = $auth['tenant_id'];
        $token = $auth['token'];
        $this->seedBooks($tid);

        // 0) منصة مفعّلة (محاكاة علم Railway) لكن المؤسسة لم توافق: لا شيء يعمل، والحالة صادقة.
        config(['ai_assistant.enabled' => true]);
        $status = $this->withToken($token)->getJson('/api/ai-assistant/status')->assertOk();
        $this->assertSame('tenant_disabled', $status->json('data.chat'));
        $this->assertSame('tenant_disabled', $status->json('data.financial'));
        $this->runTool($token, 'finance.income_statement', ['from' => '2026-10-01', 'to' => self::TODAY])->assertForbidden();

        // 1) موافقة المؤسسة كما يفعلها المالك من شاشة الإعدادات (بإقرار الخصوصية).
        $this->withToken($token)->putJson('/api/ai-assistant/settings', [
            'enabled' => true, 'consented_categories' => ['assistant_messages', 'financial_summary'], 'acknowledge_privacy' => true,
        ])->assertOk();
        $status = $this->withToken($token)->getJson('/api/ai-assistant/status')->assertOk();
        $this->assertSame(['mock', 'ready', 'ready'], [$status->json('data.provider_mode'), $status->json('data.chat'), $status->json('data.financial')]);
        $this->assertSame('category_unavailable', $status->json('data.document'), 'documents stay closed while the second platform flag is off');

        $before = $this->ledgerFingerprint();
        $this->assertGreaterThan(0, $before['entries']);

        // 2) قائمة الدخل = ReportService.
        $income = $this->runTool($token, 'finance.income_statement', ['from' => '2026-06-01', 'to' => self::TODAY])->assertOk()->json('data.tool_calls.0.result');
        $expected = $this->direct($tid, fn (ReportService $r) => $r->incomeStatement(['from' => '2026-06-01', 'to' => self::TODAY]));
        $this->assertGreaterThan(0, $expected['total_revenue']);
        foreach (['total_revenue', 'total_expense', 'net_income'] as $key) {
            $this->assertSame($expected[$key], $income['totals'][$key]['minor'], $key);
        }
        $this->assertSame('SAR', $income['currency']);

        // 3) أعمار الديون = ReportService، لكل طرف ولكل شريحة.
        foreach (['receivables_aging' => 'receivable', 'payables_aging' => 'payable'] as $tool => $kind) {
            $result = $this->runTool($token, "finance.{$tool}", ['as_of' => self::TODAY])->assertOk()->json('data.tool_calls.0.result');
            $direct = $this->direct($tid, fn (ReportService $r) => $r->aging($kind, ['as_of' => self::TODAY]));
            $this->assertNotEmpty($direct['rows'], $tool);
            foreach (['b0_30', 'b31_60', 'b61_90', 'b90_plus', 'total'] as $bucket) {
                $this->assertSame($direct['totals'][$bucket], $result['totals'][$bucket]['minor'], "{$tool} totals {$bucket}");
            }
            $this->assertSame(
                collect($direct['rows'])->map(fn ($r) => [$r['partner_id'], $r['total']])->sortBy(0)->values()->all(),
                collect($result['rows'])->map(fn ($r) => [$r['partner_id'], $r['total']['minor']])->sortBy(0)->values()->all(),
                "{$tool} per-partner rows",
            );
            $this->assertSame(Money::toRiyal($direct['totals']['total']), $result['totals']['total']['decimal']);
        }

        // 3b) as_of سابق يُوسَم «ليس تاريخياً» (الرصيد الحالي لا لقطة الماضي).
        $past = $this->runTool($token, 'finance.receivables_aging', ['as_of' => '2026-09-01'])->assertOk()->json('data.tool_calls.0.result');
        $this->assertNotEmpty($past['warnings']);

        // 4) المسار الحواري (Mock) يعيد الرقم نفسه ولا يُنشئ شيئاً في الدفتر.
        $chat = $this->aiAsk($token, ['message' => 'income statement'])->assertOk();
        $this->assertSame('finance.income_statement', $chat->json('data.tool_calls.0.tool'));

        // 5) الدفتر لم يتغيّر حرفاً بعد كل ما سبق.
        $this->assertSame($before, $this->ledgerFingerprint());

        // 6) التدقيق وصفي: لا اسم عميل ولا مبلغ ولا نص رسالة في أي صف.
        $audit = json_encode($this->auditEvents()->map->getAttributes()->all(), JSON_UNESCAPED_UNICODE);
        $this->assertNotEmpty($this->auditEvents());
        $this->assertStringNotContainsString(self::CANARY, $audit);
        $this->assertStringNotContainsString('شركة المنارة', $audit);
        $this->assertStringNotContainsString(Money::toRiyal($expected['total_revenue']), $audit);
        $this->assertStringNotContainsString(self::AI_PROMPT, $audit);
    }

    /** @test */
    public function the_role_matrix_for_the_pilot_is_owner_and_accountant_allowed_staff_and_no_consent_denied(): void
    {
        $auth = $this->registerTenant('pilot-b', 'owner@pilot-b.test');
        config(['ai_assistant.enabled' => true]);
        $this->aiOptIn($auth['tenant_id'], ['assistant_messages', 'financial_summary']);
        $args = ['from' => '2026-10-01', 'to' => self::TODAY];

        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@pilot-b.test');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@pilot-b.test');

        $this->runTool($auth['token'], 'finance.income_statement', $args)->assertOk();
        $this->runTool($accountant, 'finance.income_statement', $args)->assertOk();
        $this->runTool($staff, 'finance.income_statement', $args)->assertForbidden();
        // الموافقة تُدار من المالك/المدير فقط.
        $this->withToken($accountant)->putJson('/api/ai-assistant/settings', ['enabled' => false, 'consented_categories' => []])->assertForbidden();

        // سحب موافقة الملخصات المالية يوقف الأدوات فوراً مع بقاء الرسائل.
        $this->withToken($auth['token'])->putJson('/api/ai-assistant/settings', ['enabled' => true, 'consented_categories' => ['assistant_messages']])->assertOk();
        $this->runTool($auth['token'], 'finance.income_statement', $args)->assertForbidden();
    }

    /** @test */
    public function the_document_tool_is_closed_in_the_pilot_until_the_second_platform_flag_and_tenant_consent_exist(): void
    {
        $auth = $this->registerTenant('pilot-c', 'owner@pilot-c.test');
        config(['ai_assistant.enabled' => true]);
        $this->aiOptIn($auth['tenant_id'], ['assistant_messages', 'financial_summary']);

        $this->assertFalse((bool) config('ai_assistant.documents.enabled'), 'shipped default');
        $this->runTool($auth['token'], 'documents.projected_read', ['document_id' => '00000000-0000-4000-8000-000000000001'])
            ->assertForbidden()->assertJsonPath('error.code', 'data_category_unavailable');
        $this->withToken($auth['token'])->putJson('/api/ai-assistant/settings', [
            'enabled' => true, 'consented_categories' => ['assistant_messages', 'financial_summary', 'document_projected_text'], 'acknowledge_privacy' => true,
        ])->assertStatus(422);
    }
}
