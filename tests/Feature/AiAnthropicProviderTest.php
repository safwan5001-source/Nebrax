<?php

namespace Tests\Feature;

use App\Models\AiRequest;
use App\Models\Partner;
use App\Models\PlatformIntegrationSetting;
use App\Models\Role;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use App\Services\Reporting\ReportService;
use App\Support\AiAssistantDataCategory;
use App\Support\Money;
use App\Support\Settings;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * AWJ Intelligence — AI-07: المساعد عبر تكامل Anthropic القائم في منصة الإدارة العليا.
 *
 * كل شيء هنا بـ`Http::fake`: لا شبكة حقيقية ولا مفتاح حقيقي. المفتاح الاختباري «كناري» يُفحَص غيابه من كل سجل واستجابة.
 *
 * تشغيل: php artisan test --filter=AiAnthropicProviderTest
 */
class AiAnthropicProviderTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiAssistant;

    private const KEY = 'sk-ant-api03-CANARY-PLATFORM-KEY-DO-NOT-LEAK';
    private const MODEL = 'claude-test-model-1';
    private const PARTY = 'عميل-سري-ANTHROPIC-CANARY';
    private const TODAY = '2026-10-20';
    private const ENDPOINT = 'https://api.anthropic.com/v1/messages';

    /** @var list<string> */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-10-20 10:00:00 Asia/Riyadh');
        Http::preventStrayRequests();
        $this->logged = [];
        Event::listen(MessageLogged::class, function (MessageLogged $e): void {
            $this->logged[] = $e->message . json_encode($e->context);
        });
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    // ───────────────────────── fixtures ─────────────────────────

    /** منصة + مزوّد Anthropic مهيّأ بالكامل + مستأجر موافق ومُقرّ وبميزانية. كل شرط قابل للتعطيل. */
    private function externalTenant(string $slug = 'ext-a', array $without = []): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        config([
            'ai_assistant.enabled' => true,
            'ai_assistant.provider' => 'anthropic',
            // AI-07: مفتاحان مستقلان. المساعد لا يعتمد على مفتاح Document AI (مطفأ هنا)، وإيقاف مفتاحه وحده يغلقه ولو فُتح الآخر.
            'ai_assistant.external_network_enabled' => ! in_array('network', $without, true),
            'document_center.ai.provider_network_enabled' => in_array('network', $without, true),
            'ai_assistant.pricing.anthropic' => in_array('pricing', $without, true) ? [] : [self::MODEL => ['input_micro_usd_per_1k' => 3000, 'output_micro_usd_per_1k' => 15000]],
        ]);

        if (! in_array('platform_setting', $without, true)) {
            PlatformIntegrationSetting::query()->updateOrCreate(['integration_key' => 'document_ai'], [
                'provider' => 'anthropic',
                'enabled' => false, // محرك استخراج المستندات مطفأ: المساعد لا يعتمد عليه
                'configuration' => ['providers' => ['anthropic' => [
                    'enabled' => ! in_array('provider_disabled', $without, true),
                    'api_key' => in_array('api_key', $without, true) ? '' : self::KEY,
                    'model' => in_array('model', $without, true) ? '' : self::MODEL,
                ]]],
                'configured_at' => now(),
            ]);
        }

        $tid = $auth['tenant_id'];
        $this->aiOptIn($tid, in_array('consent', $without, true) ? [] : [AiAssistantDataCategory::ASSISTANT_MESSAGES, AiAssistantDataCategory::FINANCIAL_SUMMARY]);
        if (in_array('tenant_off', $without, true)) {
            $this->inTenantCtx($tid, fn () => Settings::put('ai_assistant', ['enabled' => false]));
        }
        if (! in_array('ack', $without, true)) {
            $this->inTenantCtx($tid, fn () => Settings::put('ai_assistant_external', ['acknowledged' => true]));
        }
        if (! in_array('budget', $without, true)) {
            $this->setCaps(null, 50_000_000, 500_000_000_000);
            $this->setCaps($tid, 50_000_000, 500_000_000_000);
        }

        return $auth;
    }

    private function inTenantCtx(string $tid, \Closure $fn): mixed
    {
        $tenant = app(TenantContext::class);
        $branch = app(BranchContext::class);
        $prev = $tenant->id();
        $tenant->set($tid);
        $branch->set(null);
        try {
            return $fn();
        } finally {
            $prev === null ? $tenant->forget() : $tenant->set($prev);
        }
    }

    /** @return array{customer:string, supplier:string} */
    private function seedBooks(string $tid): array
    {
        return $this->inTenantCtx($tid, function () {
            $customer = Partner::create(['name' => self::PARTY, 'type' => 'customer'])->id;
            $supplier = Partner::create(['name' => 'مورد-سري-CANARY', 'type' => 'supplier'])->id;
            $invoices = app(InvoiceService::class);
            foreach ([['2026-10-02', 250000, 2], ['2026-08-10', 90001, 1]] as [$date, $price, $qty]) {
                $invoices->post($invoices->create(
                    ['partner_id' => $customer, 'payment_type' => 'credit', 'invoice_date' => $date, 'due_date' => $date],
                    [['quantity' => $qty, 'unit_price' => $price, 'tax_rate' => 15]],
                ));
            }

            return ['customer' => $customer, 'supplier' => $supplier];
        });
    }

    private function direct(string $tid, callable $call): mixed
    {
        return $this->inTenantCtx($tid, function () use ($call) {
            Auth::guard()->setUser(User::query()->where('role', 'owner')->firstOrFail());

            return $call(app(ReportService::class));
        });
    }

    private function toolUse(string $name, array $input, int $in = 120, int $out = 40, string $id = 'toolu_01'): array
    {
        return ['id' => 'msg_1', 'type' => 'message', 'role' => 'assistant', 'stop_reason' => 'tool_use',
            'content' => [['type' => 'text', 'text' => 'planning'], ['type' => 'tool_use', 'id' => $id, 'name' => $name, 'input' => $input]],
            'usage' => ['input_tokens' => $in, 'output_tokens' => $out]];
    }

    private function text(string $text, int $in = 300, int $out = 80): array
    {
        return ['id' => 'msg_2', 'type' => 'message', 'role' => 'assistant', 'stop_reason' => 'end_turn',
            'content' => [['type' => 'text', 'text' => $text]], 'usage' => ['input_tokens' => $in, 'output_tokens' => $out]];
    }

    /** @param list<array|\Illuminate\Http\Client\Response> $responses */
    private function fakeAnthropic(array $responses): void
    {
        $sequence = Http::sequence();
        foreach ($responses as $r) {
            $sequence->push($r instanceof \GuzzleHttp\Promise\PromiseInterface ? $r : $r, 200);
        }
        Http::fake([self::ENDPOINT => $sequence]);
    }

    /** @return list<array{0:Request,1:mixed}> */
    private function anthropicCalls(): array
    {
        return array_values(array_filter(Http::recorded()->all(), fn ($pair) => $pair[0]->url() === self::ENDPOINT));
    }

    private function body(int $index): array
    {
        return $this->anthropicCalls()[$index][0]->data();
    }

    private function everythingWritten(): string
    {
        return json_encode([
            DB::table('ai_audit_events')->get(),
            DB::table('ai_requests')->get(),
            DB::table('ai_budgets')->get(),
            $this->logged,
        ], JSON_UNESCAPED_UNICODE);
    }

    // ───────────────────────── the full round trip ─────────────────────────

    /** @test */
    public function an_arabic_question_runs_the_approved_tool_and_is_answered_from_its_figures(): void
    {
        $auth = $this->externalTenant();
        $tid = $auth['tenant_id'];
        $this->seedBooks($tid);
        $expected = $this->direct($tid, fn (ReportService $r) => $r->incomeStatement(['from' => '2026-10-01', 'to' => self::TODAY]));
        $revenue = Money::toRiyal($expected['total_revenue']);
        $this->assertGreaterThan(0, $expected['total_revenue']);

        $this->fakeAnthropic([
            $this->toolUse('finance_income_statement', []),
            $this->text("إجمالي الإيرادات من 2026-10-01 إلى 2026-10-20 هو {$revenue} ريال."),
        ]);

        $res = $this->aiAsk($auth['token'], ['message' => 'كم إيرادات هذا الشهر؟', 'locale' => 'ar'])->assertOk();

        // الجواب مؤسَّس على أرقام التقرير، والنتيجة الكاملة المعتمدة مرفقة ومطابقة لـ ReportService.
        $this->assertStringContainsString($revenue, $res->json('data.message.content'));
        $this->assertSame('anthropic', $res->json('data.provider'));
        $this->assertSame('finance.income_statement', $res->json('data.tool_calls.0.tool'));
        $this->assertSame($expected['total_revenue'], $res->json('data.tool_calls.0.result.totals.total_revenue.minor'));
        $this->assertSame(['input_tokens' => 420, 'output_tokens' => 120], $res->json('data.usage'));

        // مكالمتان فقط، إلى النقطة المعتمدة، بمفتاح المنصة ونموذجها.
        $calls = $this->anthropicCalls();
        $this->assertCount(2, $calls);
        $this->assertSame(self::KEY, $calls[0][0]->header('x-api-key')[0]);
        $this->assertSame('2023-06-01', $calls[0][0]->header('anthropic-version')[0]);
        $this->assertSame(self::MODEL, $this->body(0)['model']);
        $this->assertSame(
            ['finance_income_statement', 'finance_payables_aging', 'finance_receivables_aging'],
            collect($this->body(0)['tools'])->pluck('name')->sort()->values()->all(),
            'only the three approved finance tools are offered; never document reading',
        );
        $this->assertStringContainsString('Today is 2026-10-20', $this->body(0)['system']);
        $this->assertSame('كم إيرادات هذا الشهر؟', $this->body(0)['messages'][0]['content']);

        // ما غادر الخادم لا يحمل هويات: لا مستأجر ولا مستخدم ولا بريد ولا أسماء ولا معرّفات أطراف.
        $sent = json_encode([$this->body(0), $this->body(1)], JSON_UNESCAPED_UNICODE);
        foreach ([$tid, $auth['token'], 'owner@ext-a.test', self::PARTY, 'مورد-سري'] as $secret) {
            $this->assertStringNotContainsString((string) $secret, $sent);
        }

        // الميزانية سُوّيت بالاستهلاك الفعلي لا المحجوز، والسجلات وصفية بلا مفتاح ولا نص.
        $request = $this->requestRow($res->json('data.request_id'));
        $this->assertSame(['settled', 'anthropic', self::MODEL], [$request->status, $request->provider, $request->model]);
        $this->assertSame(540, $this->budgetRow($tid)->used_tokens);
        $this->assertSame(0, $this->budgetRow($tid)->reserved_tokens);
        $written = $this->everythingWritten() . json_encode($res->json());
        $this->assertStringNotContainsString(self::KEY, $written);
        $this->assertStringNotContainsString('كم إيرادات هذا الشهر', $this->everythingWritten());
        $this->assertStringNotContainsString($revenue, $this->everythingWritten());
        $events = $this->auditEvents($request->id);
        $this->assertSame(['request.started', 'tool.invoked', 'request.completed'], $events->pluck('event')->all());
        $completed = $events->last();
        $this->assertTrue($completed->meta['composed']);
        $this->assertTrue($completed->meta['grounded']);
        $this->assertTrue($completed->meta['external_ack']);
        $this->assertSame(['anthropic', self::MODEL], [$completed->provider, $completed->model]);
    }

    /** @test */
    public function natural_named_months_are_normalized_in_the_tenant_timezone_without_touching_explicit_dates(): void
    {
        $auth = $this->externalTenant('ext-natural-months');
        $this->fakeAnthropic([
            $this->toolUse('finance_income_statement', []),
            $this->text('The approved report is shown below.'),
        ]);
        $this->aiAsk($auth['token'], ['message' => 'Show the income statement for September 2026.', 'locale' => 'en'])->assertOk()
            ->assertJsonPath('data.tool_calls.0.result.period.from', '2026-09-01')
            ->assertJsonPath('data.tool_calls.0.result.period.to', '2026-09-30');
    }

    /** @test */
    public function the_second_call_carries_only_a_digest_with_party_tokens_and_the_names_come_back_locally(): void
    {
        $auth = $this->externalTenant('ext-b');
        $tid = $auth['tenant_id'];
        $this->seedBooks($tid);
        $direct = $this->direct($tid, fn (ReportService $r) => $r->aging('receivable', ['as_of' => self::TODAY]));
        $total = Money::toRiyal($direct['totals']['total']);

        $this->fakeAnthropic([
            $this->toolUse('finance_receivables_aging', ['as_of' => self::TODAY]),
            $this->text("Party-1 has the largest open balance. Total outstanding is {$total} SAR."),
        ]);

        $res = $this->aiAsk($auth['token'], ['message' => 'Who owes us the most?', 'locale' => 'en'])->assertOk();

        $toolResult = $this->body(1)['messages'][2]['content'][0];
        $this->assertSame('tool_result', $toolResult['type']);
        $this->assertSame('toolu_01', $toolResult['tool_use_id']);
        $digest = json_decode($toolResult['content'], true);
        $this->assertSame('Party-1', $digest['rows'][0]['party']);
        $this->assertSame($total, $digest['totals']['total']);
        foreach (['partner_id', 'name', 'sources', 'api_path', 'scope', 'ui_path'] as $leaky) {
            $this->assertStringNotContainsString("\"{$leaky}\"", $toolResult['content'], $leaky);
        }
        $this->assertStringNotContainsString(self::PARTY, $this->body(1)['messages'][2]['content'][0]['content']);

        // الاسم الحقيقي يُعاد محلياً للمستخدم وحده، ولا يبقى رمز.
        $content = $res->json('data.message.content');
        $this->assertStringContainsString(self::PARTY, $content);
        $this->assertStringNotContainsString('Party-1', $content);
        $this->assertStringContainsString('(default English)', $this->body(0)['system']);
    }

    /** @test */
    public function an_answer_with_an_invented_or_derived_figure_is_withheld_and_the_approved_figures_still_shown(): void
    {
        $auth = $this->externalTenant('ext-c');
        $this->seedBooks($auth['tenant_id']);
        $this->fakeAnthropic([
            $this->toolUse('finance_income_statement', ['from' => '2026-10-01', 'to' => self::TODAY]),
            $this->text('Revenue is 9,999,999.99 SAR, up 37% on last month.'),
        ]);

        $res = $this->aiAsk($auth['token'], ['message' => 'income statement', 'locale' => 'en'])->assertOk();

        $this->assertStringNotContainsString('9,999,999.99', $res->getContent());
        $this->assertStringContainsString('could not verify the figures', $res->json('data.message.content'));
        $this->assertSame('finance.income_statement', $res->json('data.tool_calls.0.tool'));
        $this->assertFalse($this->auditEvents()->firstWhere('event', 'request.completed')->meta['grounded']);
    }

    /** @test */
    public function a_text_only_model_answer_is_sanitised_and_costs_one_call(): void
    {
        $auth = $this->externalTenant('ext-d');
        $this->fakeAnthropic([$this->text("I can help with the income statement.\u{202E}\x07 [click](https://evil.example)")]);

        $res = $this->aiAsk($auth['token'], ['message' => 'hello', 'locale' => 'en'])->assertOk();

        $this->assertCount(1, $this->anthropicCalls());
        $this->assertStringNotContainsString("\u{202E}", $res->json('data.message.content'));
        $this->assertSame([], $res->json('data.tool_calls'));
        $this->assertSame(380, $this->budgetRow($auth['tenant_id'])->used_tokens);
    }

    // ───────────────────────── the model is never trusted ─────────────────────────

    /** @test */
    public function a_tool_the_model_invents_or_the_document_tool_is_refused_even_with_documents_enabled(): void
    {
        $auth = $this->externalTenant('ext-e');
        config(['ai_assistant.documents.enabled' => true]);
        $this->aiOptIn($auth['tenant_id'], ['assistant_messages', 'financial_summary', 'document_projected_text']);

        $names = ['documents_projected_read', 'drop_all_tables'];
        Http::fake([self::ENDPOINT => Http::sequence()
            ->push($this->toolUse($names[0], ['document_id' => '00000000-0000-4000-8000-000000000001']), 200)
            ->push($this->toolUse($names[1], ['document_id' => '00000000-0000-4000-8000-000000000001']), 200)]);
        foreach ($names as $name) {
            $this->aiAsk($auth['token'], ['message' => "use {$name}"])->assertForbidden()->assertJsonPath('error.code', 'tool_not_registered');
        }
        $this->assertSame(
            ['tool.denied', 'tool.denied'],
            $this->auditEvents()->whereIn('event', ['tool.denied'])->pluck('event')->all(),
        );
    }

    /** @test */
    public function a_tool_the_user_may_not_use_is_refused_before_any_figure_leaves_the_server(): void
    {
        $auth = $this->externalTenant('ext-f');
        $this->seedBooks($auth['tenant_id']);
        $this->inTenantCtx($auth['tenant_id'], fn () => Role::create(['slug' => 'ai-only', 'name' => 'ai-only', 'permissions' => ['ai.assistant.use'], 'is_system' => false]));
        $token = $this->tokenForRole($auth['tenant_id'], 'ai-only', 'aionly@ext-f.test');
        $this->fakeAnthropic([$this->toolUse('finance_income_statement', ['from' => '2026-10-01', 'to' => self::TODAY])]);

        $this->aiAsk($token, ['message' => 'income statement'])->assertForbidden()->assertJsonPath('error.code', 'tool_permission_denied');

        $this->assertCount(1, $this->anthropicCalls(), 'planning call only — no second call, no figures sent');
        $this->assertStringNotContainsString('tool_result', json_encode($this->body(0)));
        // النداء الأول استُهلك فعلاً فسُوّي بما أُبلغ به، وانتهى الطلب بحدث رفض لا بحجز معلّق.
        $this->assertSame(160, $this->budgetRow($auth['tenant_id'])->used_tokens);
        $this->assertSame(0, $this->budgetRow($auth['tenant_id'])->reserved_tokens);
    }

    /** @test */
    public function invalid_model_arguments_are_rejected_by_the_closed_tool_schema(): void
    {
        $auth = $this->externalTenant('ext-g');
        $this->fakeAnthropic([$this->toolUse('finance_income_statement', ['from' => '2026-10-01', 'to' => self::TODAY, 'sql' => 'select * from users'])]);

        $this->aiAsk($auth['token'], ['message' => 'income statement'])->assertStatus(422)->assertJsonPath('error.code', 'invalid_tool_arguments');
        $this->assertCount(1, $this->anthropicCalls());
    }

    // ───────────────────────── fail-closed gating ─────────────────────────

    /** @return array<string,array{0:list<string>,1:int,2:string}> */
    public static function gates(): array
    {
        return [
            'platform integration never saved' => [['platform_setting'], 503, 'provider_unavailable'],
            'provider disabled by the platform admin' => [['provider_disabled'], 503, 'provider_unavailable'],
            'no api key saved' => [['api_key'], 503, 'provider_unavailable'],
            'no model chosen' => [['model'], 503, 'provider_unavailable'],
            'assistant network switch off (even with the Document AI switch on)' => [['network'], 503, 'provider_unavailable'],
            'no price for the chosen model' => [['pricing'], 503, 'pricing_unknown'],
            'no budget configured' => [['budget'], 503, 'budget_not_configured'],
            'tenant did not acknowledge external sending' => [['ack'], 403, 'external_provider_not_acknowledged'],
            'tenant gave no consent' => [['consent'], 403, 'consent_required'],
            'tenant switched the assistant off' => [['tenant_off'], 403, 'tenant_not_enabled'],
        ];
    }

    /**
     * @test
     * @dataProvider gates
     */
    public function every_missing_condition_blocks_the_call_before_anything_is_sent(array $without, int $status, string $code): void
    {
        $auth = $this->externalTenant('gate-' . substr(md5(implode($without)), 0, 6), $without);
        Http::fake([self::ENDPOINT => Http::response($this->text('should never be asked'), 200)]);

        $this->aiAsk($auth['token'])->assertStatus($status)->assertJsonPath('error.code', $code);

        $this->assertCount(0, $this->anthropicCalls());
        $this->assertStringNotContainsString(self::KEY, $this->everythingWritten());
    }

    /** @test */
    public function the_assistant_and_document_ai_have_independent_network_switches_and_can_run_together(): void
    {
        $auth = $this->externalTenant('ext-ind');
        $this->fakeAnthropic([$this->text('Hello — no tools needed.'), $this->text('Hello again.'), $this->text('Still here.')]);

        // (١) المساعد وحده: مفتاح Document AI مطفأ ويعمل.
        $this->assertFalse((bool) config('document_center.ai.provider_network_enabled'));
        $this->aiAsk($auth['token'], ['message' => 'hello', 'locale' => 'en'])->assertOk();
        $this->assertCount(1, $this->anthropicCalls());

        // (٢) تشغيلهما معاً: لا يتعارضان.
        config(['document_center.ai.provider_network_enabled' => true]);
        $this->aiAsk($auth['token'], ['message' => 'hello again', 'locale' => 'en'])->assertOk();
        $this->assertCount(2, $this->anthropicCalls());

        // (٣) مفتاح Document AI وحده لا يفتح المساعد.
        config(['ai_assistant.external_network_enabled' => false]);
        $this->aiAsk($auth['token'], ['message' => 'third'])->assertStatus(503)->assertJsonPath('error.code', 'provider_unavailable');
        $this->assertCount(2, $this->anthropicCalls(), 'no new call');

        // (٤) والعكس: إطفاء مفتاح Document AI لا يمسّ المساعد.
        config(['ai_assistant.external_network_enabled' => true, 'document_center.ai.provider_network_enabled' => false]);
        $this->aiAsk($auth['token'], ['message' => 'fourth', 'locale' => 'en'])->assertOk();
        $this->assertCount(3, $this->anthropicCalls());
    }

    /** @test */
    public function the_shared_client_refuses_at_the_lowest_layer_when_only_the_document_ai_switch_is_on(): void
    {
        config(['ai_assistant.external_network_enabled' => false, 'document_center.ai.provider_network_enabled' => true]);
        Http::fake([self::ENDPOINT => Http::response($this->text('never'), 200)]);
        $configuration = \App\Services\DocumentCenter\DocumentProviderConfiguration::fromArray('anthropic', ['enabled' => true, 'api_key' => self::KEY, 'model' => self::MODEL]);

        try {
            app(\App\Services\DocumentCenter\AnthropicDocumentExtractionProvider::class)->converse($configuration, ['max_tokens' => 1, 'messages' => []]);
            $this->fail('expected the assistant gate to refuse');
        } catch (\App\Services\DocumentCenter\DocumentProviderException $e) {
            $this->assertSame('provider_network_disabled', $e->safeCode);
        }
        $this->assertCount(0, $this->anthropicCalls());
    }

    /** @test */
    public function platform_off_or_an_unknown_provider_value_never_reaches_the_network(): void
    {
        $auth = $this->externalTenant('ext-h');
        Http::fake([self::ENDPOINT => Http::response($this->text('x'), 200)]);

        config(['ai_assistant.enabled' => false]);
        $this->aiAsk($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'platform_disabled');
        config(['ai_assistant.enabled' => true, 'ai_assistant.provider' => 'openai']);
        $this->aiAsk($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'provider_unavailable');

        $this->assertCount(0, $this->anthropicCalls());
    }

    /** @test */
    public function the_mock_stays_the_default_even_when_anthropic_is_fully_configured_but_not_selected(): void
    {
        $auth = $this->externalTenant('ext-i');
        config(['ai_assistant.provider' => 'mock']);

        $res = $this->aiAsk($auth['token'], ['message' => 'income statement'])->assertOk();

        $this->assertSame('mock', $res->json('data.provider'));
        $this->assertCount(0, Http::recorded()->all());
    }

    // ───────────────────────── failures and money ─────────────────────────

    /** @test */
    public function a_provider_outage_returns_a_generic_error_charges_the_reservation_and_leaks_nothing(): void
    {
        $auth = $this->externalTenant('ext-j');
        Http::fake([self::ENDPOINT => Http::response(['error' => ['message' => 'upstream said: ' . self::KEY]], 500)]);

        $res = $this->aiAsk($auth['token'])->assertStatus(500)->assertJsonPath('error.code', 'internal_error');

        $this->assertStringNotContainsString(self::KEY, $res->getContent());
        $this->assertStringNotContainsString('upstream said', $res->getContent());
        $this->assertStringNotContainsString(self::KEY, $this->everythingWritten());
        $request = $this->requestRow($res->json('request_id'));
        $this->assertSame('failed', $request->status);
        $this->assertGreaterThan(0, $this->budgetRow($auth['tenant_id'])->used_tokens, 'default failure policy charges the whole reservation');
        $this->assertSame(0, $this->budgetRow($auth['tenant_id'])->reserved_tokens);
        $this->assertSame('request.failed', $this->auditEvents()->last()->event);
    }

    /** @test */
    public function a_failure_of_the_second_call_charges_the_first_actual_plus_the_second_calls_reserved_share_once(): void
    {
        $auth = $this->externalTenant('ext-k');
        $this->seedBooks($auth['tenant_id']);
        Http::fake([self::ENDPOINT => Http::sequence()
            ->push($this->toolUse('finance_income_statement', ['from' => '2026-10-01', 'to' => self::TODAY]), 200)
            ->push(['error' => ['type' => 'overloaded_error']], 529)]);

        $this->aiAsk($auth['token'], ['message' => 'income statement'])->assertStatus(500);

        // الأول فعلي (120+40) + حصة الثاني المحجوزة (قد يكون فُوتر): لا فقد ولا ازدواج.
        [$secondIn, $secondOut] = app(\App\Services\AnthropicAssistantProvider::class)->secondCallReservation(\App\Support\AiAssistantPricing::estimateInputTokens('income statement'), (int) config('ai_assistant.limits.max_output_tokens'));
        $this->assertSame(160 + $secondIn + $secondOut, $this->budgetRow($auth['tenant_id'])->used_tokens);
        $this->assertSame(0, $this->budgetRow($auth['tenant_id'])->reserved_tokens);
    }

    /** @test */
    public function a_reply_without_reported_usage_is_not_treated_as_free(): void
    {
        $auth = $this->externalTenant('ext-l');
        Http::fake([self::ENDPOINT => Http::response(['content' => [['type' => 'text', 'text' => 'hi']]], 200)]);

        $this->aiAsk($auth['token'])->assertStatus(500);

        $this->assertGreaterThan(0, $this->budgetRow($auth['tenant_id'])->used_tokens);
    }

    /** @test */
    public function the_reservation_covers_both_calls_before_the_first_one_is_made(): void
    {
        $auth = $this->externalTenant('ext-m');
        $this->seedBooks($auth['tenant_id']);
        $reserved = null;
        $n = 0;
        Http::fake(function (Request $request) use (&$reserved, &$n) {
            $n++;
            $reserved ??= AiRequest::withoutGlobalScopes()->first()->reserved_tokens;

            return Http::response($n === 1
                ? $this->toolUse('finance_income_statement', ['from' => '2026-10-01', 'to' => self::TODAY])
                : $this->text('Done.'), 200);
        });

        $this->aiAsk($auth['token'], ['message' => 'income statement'])->assertOk();

        [$in, $out] = app(\App\Services\AnthropicAssistantProvider::class)->reservationEstimate(\App\Support\AiAssistantPricing::estimateInputTokens('income statement'), (int) config('ai_assistant.limits.max_output_tokens'));
        $this->assertSame($in + $out, $reserved);
        $this->assertGreaterThan(2 * (int) config('ai_assistant.limits.max_output_tokens'), $reserved);
    }

    /** @test */
    public function a_tenant_cap_stops_the_external_call_before_it_is_made(): void
    {
        $auth = $this->externalTenant('ext-n');
        $this->setCaps($auth['tenant_id'], 10, 10);
        Http::fake([self::ENDPOINT => Http::response($this->text('x'), 200)]);

        $this->aiAsk($auth['token'])->assertStatus(429)->assertJsonPath('error.code', 'budget_exceeded');

        $this->assertCount(0, $this->anthropicCalls());
    }

    // ───────────────────────── tenant isolation ─────────────────────────

    /** @test */
    public function acknowledgement_and_data_never_cross_tenants(): void
    {
        $a = $this->externalTenant('iso-a');
        $b = $this->registerTenant('iso-b', 'owner@iso-b.test');
        $this->aiOptIn($b['tenant_id'], ['assistant_messages', 'financial_summary']);
        $this->setCaps($b['tenant_id'], 50_000_000, 500_000_000_000);
        $this->seedBooks($a['tenant_id']);
        $this->fakeAnthropic([
            $this->toolUse('finance_receivables_aging', ['as_of' => self::TODAY]),
            $this->text('Party-1 has an open balance.'),
        ]);

        // B لم يُقرّ بالإرسال الخارجي: يُرفض ولا يخرج شيء، رغم أن A أقرّ.
        $this->aiAsk($b['token'])->assertForbidden()->assertJsonPath('error.code', 'external_provider_not_acknowledged');
        $this->assertCount(0, $this->anthropicCalls());

        // وA يعمل وحده، وبياناته وحدها ما يُرسَل.
        $this->aiAsk($a['token'], ['message' => 'receivables aging'])->assertOk();
        $this->assertStringNotContainsString($b['tenant_id'], json_encode([$this->body(0), $this->body(1)]));
        $this->assertSame(0, $this->budgetRow($b['tenant_id'])->used_tokens);
    }

    // ───────────────────────── consent, status, secrets ─────────────────────────

    /** @test */
    public function the_external_acknowledgement_is_explicit_audited_revocable_and_needs_the_privacy_acknowledgement(): void
    {
        $auth = $this->externalTenant('ext-o', ['ack', 'consent']);
        $tid = $auth['tenant_id'];
        $put = fn (array $p) => $this->withToken($auth['token'])->putJson('/api/ai-assistant/settings', $p);
        $base = ['enabled' => true, 'consented_categories' => ['assistant_messages', 'financial_summary']];

        // بلا إقرار الخصوصية لا منح، وبلا إقرار الإرسال الخارجي يبقى الطلب مرفوضاً.
        $put($base + ['acknowledge_external_provider' => true])->assertStatus(422)->assertJsonPath('error.code', 'acknowledgement_required');
        $put($base + ['acknowledge_privacy' => true])->assertOk()->assertJsonPath('data.chat', 'external_provider_not_acknowledged')
            ->assertJsonPath('data.tenant.external_acknowledged', false);

        $res = $put($base + ['acknowledge_privacy' => true, 'acknowledge_external_provider' => true])->assertOk();
        $res->assertJsonPath('data.chat', 'ready')->assertJsonPath('data.provider_mode', 'external')->assertJsonPath('data.provider_label', 'anthropic');
        $this->assertTrue($res->json('data.tenant.external_acknowledged'));
        $this->assertTrue($this->inTenantCtx($tid, fn () => Settings::group('ai_assistant_external')['acknowledged']));
        $this->assertTrue($this->auditEvents()->where('event', 'consent.updated')->last()->meta['external_ack']);

        // التعطيل سحبٌ كامل: يسحب الإقرار أيضاً فيلزم إقرار جديد.
        $put(['enabled' => false, 'consented_categories' => []])->assertOk()->assertJsonPath('data.tenant.external_acknowledged', false);
        $this->assertFalse($this->inTenantCtx($tid, fn () => Settings::group('ai_assistant_external')['acknowledged']));
    }

    /** @test */
    public function status_names_the_provider_but_never_exposes_the_key_model_price_or_network_switch(): void
    {
        $auth = $this->externalTenant('ext-p');

        $res = $this->withToken($auth['token'])->getJson('/api/ai-assistant/status')->assertOk();

        $this->assertSame(['external', 'anthropic'], [$res->json('data.provider_mode'), $res->json('data.provider_label')]);
        foreach ([self::KEY, self::MODEL, 'micro_usd', 'provider_network', 'api_key'] as $secret) {
            $this->assertStringNotContainsString($secret, $res->getContent());
        }
        // أي شرط ناقص ⇒ «غير متاح» بصدق، لا «جاهز».
        config(['ai_assistant.external_network_enabled' => false]);
        $this->withToken($auth['token'])->getJson('/api/ai-assistant/status')->assertJsonPath('data.provider_mode', 'unavailable')->assertJsonPath('data.chat', 'provider_unavailable');
    }

    /** @test */
    public function the_acknowledgement_cannot_be_granted_while_the_provider_is_the_mock(): void
    {
        $auth = $this->externalTenant('ext-q', ['ack']);
        config(['ai_assistant.provider' => 'mock']);

        $this->withToken($auth['token'])->putJson('/api/ai-assistant/settings', [
            'enabled' => true, 'consented_categories' => ['assistant_messages'], 'acknowledge_privacy' => true, 'acknowledge_external_provider' => true,
        ])->assertStatus(503)->assertJsonPath('error.code', 'provider_unavailable');
    }

    /** @test */
    public function explicit_report_runs_never_call_the_provider_even_when_it_is_external(): void
    {
        $auth = $this->externalTenant('ext-r', ['ack']);
        $this->seedBooks($auth['tenant_id']);
        Http::fake([self::ENDPOINT => Http::response($this->text('x'), 200)]);

        $this->withToken($auth['token'])->postJson('/api/ai-assistant/tools/run', ['tool' => 'finance.income_statement', 'arguments' => ['from' => '2026-10-01', 'to' => self::TODAY]])->assertOk();

        $this->assertCount(0, $this->anthropicCalls());
    }
}
