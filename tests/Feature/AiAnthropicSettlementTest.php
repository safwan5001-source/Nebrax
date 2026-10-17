<?php

namespace Tests\Feature;

use App\Models\AiAuditEvent;
use App\Models\AiBudget;
use App\Models\AiRequest;
use App\Models\Partner;
use App\Models\PlatformIntegrationSetting;
use App\Services\Accounting\InvoiceService;
use App\Services\AiBudgetService;
use App\Services\AiRequestLedger;
use App\Services\AnthropicAssistantProvider;
use App\Support\AiAssistantDataCategory;
use App\Support\AiAssistantPricing;
use App\Support\Settings;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * AI-07 — مراجعة قبل الدمج (١): استهلاك Anthropic يُجمع عبر **نداءي التخطيط والصياغة** ويُسوّى **مرة واحدة** — بما فيها
 * فشل النداء الثاني — دون فقد تكلفة ودون ازدواجية. المرجع العددي: الاستهلاك المُبلَّغ من المزوّد × جدول الأسعار.
 *
 * تشغيل: php artisan test --filter=AiAnthropicSettlementTest
 */
class AiAnthropicSettlementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiAssistant;

    private const KEY = 'sk-ant-api03-CANARY-SETTLEMENT-KEY';
    private const MODEL = 'claude-settle-1';
    private const ENDPOINT = 'https://api.anthropic.com/v1/messages';
    private const IN_RATE = 3000;    // micro-USD لكل 1000 رمز إدخال
    private const OUT_RATE = 15000;  // micro-USD لكل 1000 رمز إخراج

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-10-20 10:00:00 Asia/Riyadh');
        Http::preventStrayRequests();
        // مقبس واحد يخدم كل الطلبات من طابور يُملأ في كل `ask` (إعادة `Http::fake` لا تُلغي المقبس السابق).
        Http::fake([self::ENDPOINT => function () {
            $next = array_shift($this->queue);
            if ($next === null) {
                return Http::response(['error' => ['message' => 'no scripted response']], 500);
            }

            return isset($next['__status']) ? Http::response($next['body'], $next['__status']) : Http::response($next, 200);
        }]);
    }

    /** @var list<array<string,mixed>> */
    private array $queue = [];

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    // ───────────────────────── fixtures ─────────────────────────

    private function tenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        config([
            'ai_assistant.enabled' => true, 'ai_assistant.provider' => 'anthropic', 'ai_assistant.external_network_enabled' => true,
            'ai_assistant.pricing.anthropic' => [self::MODEL => ['input_micro_usd_per_1k' => self::IN_RATE, 'output_micro_usd_per_1k' => self::OUT_RATE]],
        ]);
        PlatformIntegrationSetting::query()->updateOrCreate(['integration_key' => 'document_ai'], [
            'provider' => 'anthropic', 'enabled' => false, 'configured_at' => now(),
            'configuration' => ['providers' => ['anthropic' => ['enabled' => true, 'api_key' => self::KEY, 'model' => self::MODEL]]],
        ]);
        $tid = $auth['tenant_id'];
        $this->aiOptIn($tid, [AiAssistantDataCategory::ASSISTANT_MESSAGES, AiAssistantDataCategory::FINANCIAL_SUMMARY]);
        $this->inTenant($tid, fn () => Settings::put('ai_assistant_external', ['acknowledged' => true]));
        $this->setCaps(null, 50_000_000, 500_000_000_000);
        $this->setCaps($tid, 50_000_000, 500_000_000_000);
        $this->inTenant($tid, function (): void {
            $customer = Partner::create(['name' => 'عميل-سري-SETTLE', 'type' => 'customer'])->id;
            $invoices = app(InvoiceService::class);
            $invoices->post($invoices->create(
                ['partner_id' => $customer, 'payment_type' => 'credit', 'invoice_date' => '2026-10-02', 'due_date' => '2026-10-02'],
                [['quantity' => 2, 'unit_price' => 250000, 'tax_rate' => 15]],
            ));
        });

        return $auth;
    }

    private function inTenant(string $tid, \Closure $fn): mixed
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

    private function plan(int $in, int $out): array
    {
        return ['id' => 'msg_1', 'type' => 'message', 'role' => 'assistant', 'stop_reason' => 'tool_use',
            'content' => [['type' => 'tool_use', 'id' => 'toolu_01', 'name' => 'finance_income_statement', 'input' => ['from' => '2026-10-01', 'to' => '2026-10-20']]],
            'usage' => ['input_tokens' => $in, 'output_tokens' => $out]];
    }

    private function answer(string $text, ?int $in, ?int $out): array
    {
        return ['id' => 'msg_2', 'type' => 'message', 'role' => 'assistant', 'stop_reason' => 'end_turn',
            'content' => [['type' => 'text', 'text' => $text]]] + ($in === null ? [] : ['usage' => ['input_tokens' => $in, 'output_tokens' => $out]]);
    }

    private function cost(int $in, int $out): int
    {
        return AiAssistantPricing::costMicroUsd(['input_micro_usd_per_1k' => self::IN_RATE, 'output_micro_usd_per_1k' => self::OUT_RATE], $in, $out);
    }

    /** @return array{0:int,1:int} [إدخال، إخراج] لحصة النداء الثاني المحجوزة. */
    private function secondShare(string $message): array
    {
        return app(AnthropicAssistantProvider::class)->secondCallReservation(AiAssistantPricing::estimateInputTokens($message), (int) config('ai_assistant.limits.max_output_tokens'));
    }

    private function ask(array $auth, array $responses, string $message = 'income statement', array $headers = [])
    {
        $this->queue = $responses;

        return $this->aiAsk($auth['token'], ['message' => $message, 'locale' => 'en'], $headers);
    }

    /** @return array{used:int,reserved:int,cost:int,usedCost:int} للصفّين (المنصة والمؤسسة) — يجب أن يتطابقا دائماً. */
    private function counters(string $tid): array
    {
        $global = AiBudget::query()->where('budget_key', 'global')->firstOrFail();
        $tenant = AiBudget::query()->where('budget_key', 'tenant:' . $tid)->firstOrFail();
        $this->assertSame(
            [$global->used_tokens, $global->reserved_tokens, $global->used_cost_micro_usd, $global->reserved_cost_micro_usd],
            [$tenant->used_tokens, $tenant->reserved_tokens, $tenant->used_cost_micro_usd, $tenant->reserved_cost_micro_usd],
            'platform and tenant counters stay identical for a single tenant',
        );

        return ['used' => $tenant->used_tokens, 'reserved' => $tenant->reserved_tokens, 'cost' => $tenant->reserved_cost_micro_usd, 'usedCost' => $tenant->used_cost_micro_usd];
    }

    private function events(string $requestId): array
    {
        return AiAuditEvent::withoutGlobalScopes()->where('request_id', $requestId)->orderBy('occurred_at')->orderBy('id')->pluck('event')->all();
    }

    // ───────────────────────── success: both calls aggregated, settled once ─────────────────────────

    /** @test */
    public function both_calls_usage_is_summed_priced_exactly_and_settled_once(): void
    {
        $auth = $this->tenant('settle-ok');
        $res = $this->ask($auth, [$this->plan(1200, 300), $this->answer('Revenue is 1150.00 SAR for the period.', 2400, 90)])->assertOk();

        $this->assertSame(['input_tokens' => 3600, 'output_tokens' => 390], $res->json('data.usage'));
        $row = $this->requestRow($res->json('data.request_id'));
        $this->assertSame([AiRequest::STATUS_SETTLED, 3600, 390, 0, 0], [$row->status, $row->input_tokens, $row->output_tokens, $row->unmetered_tokens, $row->reserved_tokens]);
        $this->assertSame($this->cost(3600, 390), $row->cost_micro_usd, 'cost = summed tokens × price (not two separately rounded halves)');

        $c = $this->counters($auth['tenant_id']);
        $this->assertSame(['used' => 3990, 'reserved' => 0, 'cost' => 0, 'usedCost' => $this->cost(3600, 390)], $c);
        $this->assertSame(['request.started', 'tool.invoked', 'request.completed'], $this->events($row->id), 'one terminal audit event');
    }

    /** @test */
    public function a_second_settlement_attempt_changes_nothing_not_even_through_the_stale_request_reaper(): void
    {
        $auth = $this->tenant('settle-twice');
        $res = $this->ask($auth, [$this->plan(1000, 100), $this->answer('Revenue is 1150.00 SAR.', 2000, 50)])->assertOk();
        $row = $this->requestRow($res->json('data.request_id'));
        $before = $this->counters($auth['tenant_id']);
        $ledger = app(AiRequestLedger::class);

        $this->assertFalse($ledger->complete($row, ['input_tokens' => 9999, 'output_tokens' => 9999, 'cost_micro_usd' => 9999]), 'completing twice is refused');
        $this->assertFalse($ledger->fail($row, null, 'late_failure'), 'failing after completion is refused');
        Carbon::setTestNow(now()->addHours(5));
        $this->assertSame(0, app(AiBudgetService::class)->reapStale(), 'the reaper only touches abandoned reservations');

        $this->assertSame($before, $this->counters($auth['tenant_id']));
        $after = $this->requestRow($row->id);
        $this->assertSame([AiRequest::STATUS_SETTLED, 3000, 150], [$after->status, $after->input_tokens, $after->output_tokens]);
    }

    /** @test */
    public function usage_above_the_reservation_is_charged_in_full_and_never_left_reserved(): void
    {
        $auth = $this->tenant('settle-overrun');
        // أكبر بكثير من المحجوز: الحقيقة تُحتسب (وتُمنع الطلبات اللاحقة عند السقف).
        $res = $this->ask($auth, [$this->plan(30_000, 5_000), $this->answer('Revenue is 1150.00 SAR.', 40_000, 6_000)])->assertOk();

        $row = $this->requestRow($res->json('data.request_id'));
        $this->assertSame([81_000, 0], [$row->input_tokens + $row->output_tokens, $row->reserved_tokens]);
        $this->assertSame(['used' => 81_000, 'reserved' => 0, 'cost' => 0, 'usedCost' => $this->cost(70_000, 11_000)], $this->counters($auth['tenant_id']));
        $this->assertTrue($this->auditEvents($row->id)->last()->meta['overrun']);
    }

    /** @test */
    public function an_answer_the_guard_withholds_still_pays_for_both_calls(): void
    {
        $auth = $this->tenant('settle-withheld');
        $res = $this->ask($auth, [$this->plan(1000, 100), $this->answer('Revenue is 9999999.99 SAR (invented).', 2000, 60)])->assertOk();

        $this->assertStringContainsString('could not verify', $res->json('data.message.content'));
        $this->assertSame(['used' => 3160, 'reserved' => 0, 'cost' => 0, 'usedCost' => $this->cost(3000, 160)], $this->counters($auth['tenant_id']));
    }

    // ───────────────────────── second-call failures ─────────────────────────

    /** @return array<string,array{0:callable(self):mixed}> */
    public static function secondCallFailures(): array
    {
        return [
            'overloaded (HTTP 529)' => [fn (self $t) => ['__status' => 529, 'body' => ['error' => ['type' => 'overloaded_error', 'message' => self::KEY]]]],
            'server error (HTTP 500)' => [fn (self $t) => ['__status' => 500, 'body' => ['error' => ['message' => 'boom']]]],
            'rate limited (HTTP 429)' => [fn (self $t) => ['__status' => 429, 'body' => ['error' => ['message' => 'slow down']]]],
            'success but usage missing' => [fn (self $t) => $t->answer('Revenue is 1150.00 SAR.', null, null)],
            'success but usage malformed' => [fn (self $t) => ['id' => 'm', 'type' => 'message', 'content' => [['type' => 'text', 'text' => 'x']], 'usage' => ['input_tokens' => 'many', 'output_tokens' => -4]]],
        ];
    }

    /**
     * @test
     * @dataProvider secondCallFailures
     */
    public function a_failed_second_call_pays_the_first_actual_plus_the_second_reserved_share_exactly_once(callable $failure): void
    {
        $auth = $this->tenant('settle-f-' . substr(md5(microtime(true) . random_int(0, 9999)), 0, 6));
        $res = $this->ask($auth, [$this->plan(1200, 300), $failure($this)])->assertStatus(500)->assertJsonPath('error.code', 'internal_error');

        [$secondIn, $secondOut] = $this->secondShare('income statement');
        $row = $this->requestRow($res->json('request_id'));
        $this->assertSame(AiRequest::STATUS_FAILED, $row->status);
        $this->assertSame([1200, 300, $secondIn + $secondOut, 0], [$row->input_tokens, $row->output_tokens, $row->unmetered_tokens, $row->reserved_tokens], 'first call is metered, the second call share is estimated — no gap, no overlap');
        $this->assertSame($this->cost(1200, 300) + $this->cost($secondIn, $secondOut), $row->cost_micro_usd);

        $this->assertSame(['used' => 1500 + $secondIn + $secondOut, 'reserved' => 0, 'cost' => 0, 'usedCost' => $row->cost_micro_usd], $this->counters($auth['tenant_id']));
        $this->assertSame(['request.started', 'tool.invoked', 'request.failed'], $this->events($row->id), 'exactly one terminal audit event');
        $this->assertStringNotContainsString(self::KEY, $res->getContent() . json_encode(DB::table('ai_audit_events')->get()) . json_encode(DB::table('ai_requests')->get()));
    }

    /** @test */
    public function with_the_none_failure_policy_a_failed_second_call_pays_only_the_first_actual(): void
    {
        config(['ai_assistant.budget.failure_charge' => 'none']);
        $auth = $this->tenant('settle-none');
        $res = $this->ask($auth, [$this->plan(1200, 300), ['__status' => 529, 'body' => []]])->assertStatus(500);

        $row = $this->requestRow($res->json('request_id'));
        $this->assertSame([1200, 300, 0, $this->cost(1200, 300)], [$row->input_tokens, $row->output_tokens, $row->unmetered_tokens, $row->cost_micro_usd]);
        $this->assertSame(['used' => 1500, 'reserved' => 0, 'cost' => 0, 'usedCost' => $this->cost(1200, 300)], $this->counters($auth['tenant_id']));
    }

    /** @test */
    public function a_tool_failure_between_the_calls_pays_the_first_call_only_because_the_second_never_happened(): void
    {
        $auth = $this->tenant('settle-tool');
        // أداة مقترحة بمعطيات غير صالحة: تُرفض بعد التفويض، ولا يُجرى نداء ثانٍ.
        $bad = $this->plan(1200, 300);
        $bad['content'][0]['input'] = ['from' => 'not-a-date', 'to' => '2026-10-20'];
        $res = $this->ask($auth, [$bad])->assertStatus(422);

        $row = $this->requestRow($res->json('request_id'));
        $this->assertSame([AiRequest::STATUS_SETTLED, 1200, 300, 0, 0], [$row->status, $row->input_tokens, $row->output_tokens, $row->unmetered_tokens, $row->reserved_tokens]);
        $this->assertSame(['used' => 1500, 'reserved' => 0, 'cost' => 0, 'usedCost' => $this->cost(1200, 300)], $this->counters($auth['tenant_id']));
        $this->assertCount(1, Http::recorded()->all(), 'no second provider call');
    }

    /** @test */
    public function a_first_call_failure_follows_the_policy_over_the_whole_reservation_and_leaves_nothing_reserved(): void
    {
        $auth = $this->tenant('settle-first');
        $res = $this->ask($auth, [['__status' => 500, 'body' => ['error' => ['message' => 'x']]]])->assertStatus(500);

        $row = $this->requestRow($res->json('request_id'));
        $this->assertSame(AiRequest::STATUS_FAILED, $row->status);
        $this->assertGreaterThan(0, $row->unmetered_tokens);
        $this->assertSame(['used' => $row->unmetered_tokens, 'reserved' => 0, 'cost' => 0, 'usedCost' => $row->cost_micro_usd], $this->counters($auth['tenant_id']));
    }

    /** @test */
    public function a_retry_after_a_failed_second_call_is_cumulative_with_no_leaked_reservation(): void
    {
        $auth = $this->tenant('settle-retry');
        $headers = ['Idempotency-Key' => 'settle-retry-0001'];
        $first = $this->ask($auth, [$this->plan(1200, 300), ['__status' => 529, 'body' => []]], 'income statement', $headers)->assertStatus(500);
        $afterFail = $this->counters($auth['tenant_id']);

        $second = $this->ask($auth, [$this->plan(1000, 100), $this->answer('Revenue is 1150.00 SAR.', 2000, 50)], 'income statement', $headers)->assertOk();

        $this->assertSame($first->json('request_id'), $second->json('data.request_id'), 'same request row, new attempt');
        $row = $this->requestRow($second->json('data.request_id'));
        [$secondIn, $secondOut] = $this->secondShare('income statement');
        $this->assertSame(2, $row->attempt);
        $this->assertSame([1200 + 1000 + 2000, 300 + 100 + 50], [$row->input_tokens, $row->output_tokens]);
        $this->assertSame($secondIn + $secondOut, $row->unmetered_tokens, 'the failed attempt share is counted once');
        $this->assertSame($afterFail['used'] + 3150, $this->counters($auth['tenant_id'])['used']);
        $this->assertSame(0, $this->counters($auth['tenant_id'])['reserved']);
    }

    /** @test */
    public function the_summed_settlement_equals_provider_reported_usage_for_any_split_of_the_two_calls(): void
    {
        $auth = $this->tenant('settle-prop');
        $expectedUsed = 0;
        $expectedCost = 0;
        mt_srand(20261017);
        for ($i = 0; $i < 12; $i++) {
            [$in1, $out1, $in2, $out2] = [mt_rand(1, 4000), mt_rand(1, 800), mt_rand(1, 6000), mt_rand(1, 900)];
            $this->ask($auth, [$this->plan($in1, $out1), $this->answer('Revenue is 1150.00 SAR.', $in2, $out2)], 'income statement ' . $i)->assertOk();
            $expectedUsed += $in1 + $out1 + $in2 + $out2;
            $expectedCost += $this->cost($in1 + $in2, $out1 + $out2);
        }

        $this->assertSame(['used' => $expectedUsed, 'reserved' => 0, 'cost' => 0, 'usedCost' => $expectedCost], $this->counters($auth['tenant_id']));
        $this->assertSame($expectedUsed, (int) AiRequest::query()->sum(DB::raw('input_tokens + output_tokens + unmetered_tokens')));
    }
}
