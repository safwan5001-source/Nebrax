<?php

namespace Tests\Feature;

use App\Models\AiBudget;
use App\Models\AiRequest;
use App\Services\AiBudgetService;
use App\Services\AiRequestLedger;
use App\Services\MockAiAssistantProvider;
use App\Support\AiAssistantDenied;
use App\Support\AiAssistantPricing;
use App\Support\AiProviderException;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * AWJ Intelligence — AI-02A: ميزانية المساعد الذكي وسجل الطلبات.
 *
 * يثبت: لا حدّ مفتوح، حجز قبل الاستدعاء، تسوية بالفعلي، سقف عالمي + سقف مستأجر، فشل/إعادة محاولة،
 * مفتاح التكرار، تنظيف الحجوزات المهجورة، وصفر اتصال خارجي.
 *
 * تشغيل: php artisan test --filter=AiMeteringTest
 */
class AiMeteringTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiAssistant;

    protected function setUp(): void
    {
        parent::setUp();

        Http::preventStrayRequests();
        Http::fake();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        Http::assertNothingSent();

        parent::tearDown();
    }

    /** يحقن مزوّداً تجريبياً يعدّ استدعاءاته ويمرّر ما يلزم. */
    private function countingProvider(int &$calls, ?\Closure $onCall = null, ?\Throwable $failure = null, ?array $usage = null): void
    {
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(
            function (array $input) use (&$calls, $onCall) {
                $calls++;
                if ($onCall !== null) {
                    $onCall($input);
                }

                return [];
            },
            $failure,
            $usage,
        ));
    }

    // ───────────────────────── المخطط ─────────────────────────

    /** @test */
    public function the_metering_tables_exist_and_caps_have_no_default(): void
    {
        foreach (['ai_budgets', 'ai_requests', 'ai_audit_events'] as $table) {
            $this->assertTrue(Schema::hasTable($table), $table);
        }

        // الأسقف إلزامية: صف بلا سقف مرفوض من القاعدة (لا «غير محدود» ضمني).
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('ai_budgets')->insert([
            'id' => (string) Str::uuid(), 'budget_key' => 'global', 'period' => '2026-10',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    // ───────────────────────── غير قابل للفوترة (mock) ─────────────────────────

    /** @test */
    public function the_unbillable_mock_needs_no_budget_but_is_still_recorded(): void
    {
        $auth = $this->aiTenant();

        $res = $this->aiAsk($auth['token'])->assertOk();

        $row = $this->requestRow($res->json('data.request_id'));
        $this->assertSame('settled', $row->status);
        $this->assertFalse($row->billable);
        $this->assertSame($this->mockUsageFor(), ['input_tokens' => $row->input_tokens, 'output_tokens' => $row->output_tokens]);
        $this->assertSame(0, $row->cost_micro_usd);
        $this->assertSame(0, $row->reserved_tokens);
        $this->assertSame(0, AiBudget::count(), 'an unbillable provider never touches budgets');
        $this->assertSame($this->mockUsageFor(), $res->json('data.usage'));
    }

    // ───────────────────────── لا حدّ مفتوح ─────────────────────────

    /** @test */
    public function a_billable_request_without_any_budget_is_refused_before_the_provider_is_called(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        $calls = 0;
        $this->countingProvider($calls);

        $this->aiAsk($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'budget_not_configured');

        $this->assertSame(0, $calls);
        $this->assertSame(0, AiRequest::withoutGlobalScopes()->count());
    }

    /** @test */
    public function both_the_global_and_the_tenant_budget_are_required(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        [$tokens, $cost] = $this->reservationFor();
        $calls = 0;
        $this->countingProvider($calls);

        // عالمي فقط
        $this->setCaps(null, $tokens * 10, $cost * 10);
        $this->aiAsk($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'budget_not_configured');
        $this->assertSame(0, $this->budgetRow(null)->reserved_tokens, 'a failed tenant row must roll back the global reservation');

        // مستأجر فقط
        AiBudget::query()->delete();
        $this->setCaps($auth['tenant_id'], $tokens * 10, $cost * 10);
        $this->aiAsk($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'budget_not_configured');
        $this->assertSame(0, $this->budgetRow($auth['tenant_id'])->reserved_tokens);

        $this->assertSame(0, $calls);
    }

    /** @test */
    public function an_unpriced_provider_model_is_refused_never_treated_as_free(): void
    {
        $auth = $this->aiTenant();
        config(['ai_assistant.pricing' => []]);
        $calls = 0;
        $this->countingProvider($calls);

        $this->aiAsk($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'pricing_unknown');
        $this->assertSame(0, $calls);

        // قيم تسعير مشوّهة (غير صحيحة) تُعامل كغير معرّفة.
        config(['ai_assistant.pricing.mock.mock-1' => ['billable' => false, 'input_micro_usd_per_1k' => '0', 'output_micro_usd_per_1k' => -1]]);
        $this->assertNull(AiAssistantPricing::profile('mock', 'mock-1'));
    }

    /** @test */
    public function only_the_mock_provider_may_be_exempt_from_billing(): void
    {
        config(['ai_assistant.pricing.anthropic.some-model' => ['billable' => false, 'input_micro_usd_per_1k' => 1, 'output_micro_usd_per_1k' => 1]]);

        $this->assertTrue(AiAssistantPricing::profile('anthropic', 'some-model')['billable']);
        $this->assertFalse(AiAssistantPricing::profile('mock', 'mock-1')['billable']);
    }

    /** @test */
    public function cost_is_integer_micro_usd_rounded_up_per_side(): void
    {
        $profile = ['input_micro_usd_per_1k' => 3000, 'output_micro_usd_per_1k' => 15000];

        $this->assertSame(0, AiAssistantPricing::costMicroUsd($profile, 0, 0));
        $this->assertSame(3 + 15, AiAssistantPricing::costMicroUsd($profile, 1, 1), 'each side rounds up');
        $this->assertSame(3000 + 15000, AiAssistantPricing::costMicroUsd($profile, 1000, 1000));
        $this->assertSame(3003 + 15015, AiAssistantPricing::costMicroUsd($profile, 1001, 1001));
        $this->assertIsInt(AiAssistantPricing::costMicroUsd($profile, 12345, 6789));
    }

    // ───────────────────────── الحجز قبل الاستدعاء والتسوية ─────────────────────────

    /** @test */
    public function budget_is_reserved_before_the_provider_runs_and_settled_with_actual_usage(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        [$tokens, $cost] = $this->reservationFor();
        $this->setCaps(null, $tokens * 5, $cost * 5);
        $this->setCaps($auth['tenant_id'], $tokens * 3, $cost * 3);

        $during = [];
        $calls = 0;
        $this->countingProvider($calls, function () use (&$during, $auth) {
            $during = [
                'global' => $this->budgetRow(null)->only(['reserved_tokens', 'used_tokens', 'reserved_cost_micro_usd']),
                'tenant' => $this->budgetRow($auth['tenant_id'])->only(['reserved_tokens', 'used_tokens']),
                'request' => AiRequest::withoutGlobalScopes()->first()->only(['status', 'reserved_tokens']),
                'started_audit' => $this->auditEvents()->where('event', 'request.started')->count(),
            ];
        });

        $res = $this->aiAsk($auth['token'])->assertOk();

        // أثناء الاستدعاء: محجوز فقط، وسجل الطلب reserved، وتدقيق البدء دائم أصلاً.
        [$reservedTokens, $reservedCost] = $this->reservationFor();
        $this->assertSame($reservedTokens, $during['global']['reserved_tokens']);
        $this->assertSame($reservedCost, $during['global']['reserved_cost_micro_usd']);
        $this->assertSame(0, $during['global']['used_tokens']);
        $this->assertSame($reservedTokens, $during['tenant']['reserved_tokens']);
        $this->assertSame(['status' => 'reserved', 'reserved_tokens' => $reservedTokens], $during['request']);
        $this->assertSame(1, $during['started_audit']);

        // بعده: المحجوز صفر والمستهلك = الفعلي (لا المحجوز)، على الصفّين.
        $usage = $this->mockUsageFor();
        $actualTokens = $usage['input_tokens'] + $usage['output_tokens'];
        $actualCost = AiAssistantPricing::costMicroUsd(AiAssistantPricing::profile('mock', 'mock-1'), $usage['input_tokens'], $usage['output_tokens']);
        $this->assertLessThan($reservedTokens, $actualTokens);
        foreach ([null, $auth['tenant_id']] as $scope) {
            $row = $this->budgetRow($scope);
            $this->assertSame(0, $row->reserved_tokens);
            $this->assertSame(0, $row->reserved_cost_micro_usd);
            $this->assertSame($actualTokens, $row->used_tokens);
            $this->assertSame($actualCost, $row->used_cost_micro_usd);
        }

        $request = $this->requestRow($res->json('data.request_id'));
        $this->assertSame('settled', $request->status);
        $this->assertTrue($request->billable);
        $this->assertSame($actualCost, $request->cost_micro_usd);
        $this->assertSame(0, $request->reserved_tokens);
    }

    // ───────────────────────── الإيقاف الصارم ─────────────────────────

    /** @test */
    public function the_tenant_cap_is_a_hard_stop_and_does_not_affect_other_tenants(): void
    {
        $a = $this->aiTenant('ai-a');
        $b = $this->aiTenant('ai-b');
        $this->billableMock();
        [$tokens, $cost] = $this->reservationFor();
        $this->setCaps(null, $tokens * 100, $cost * 100);
        // يتسع المستأجر A لحجزين متتاليين فقط (كل حجز بالمحجوز الكامل ثم يُسوّى بالفعلي الأصغر).
        $this->setCaps($a['tenant_id'], $tokens * 2 - 1, $cost * 2);
        $this->setCaps($b['tenant_id'], $tokens * 100, $cost * 100);
        $calls = 0;
        $this->countingProvider($calls);

        $this->aiAsk($a['token'])->assertOk();
        $this->aiAsk($a['token'])->assertOk();
        // الاستهلاك الفعلي أصغر من المحجوز، فيتسع للمزيد حتى يمتلئ فعلاً؛ نُنزل السقف إلى ما استُهلك.
        $used = $this->budgetRow($a['tenant_id'])->used_tokens;
        $this->setCaps($a['tenant_id'], $used + 10, $cost * 2);
        $before = $calls;

        $this->aiAsk($a['token'])->assertStatus(429)->assertJsonPath('error.code', 'budget_exceeded');
        $this->assertSame($before, $calls, 'a hard stop never reaches the provider');
        $this->assertSame($used, $this->budgetRow($a['tenant_id'])->used_tokens, 'a refused request leaves counters untouched');
        $this->assertSame(0, $this->budgetRow($a['tenant_id'])->reserved_tokens);
        $this->assertSame(0, $this->budgetRow(null)->reserved_tokens, 'global reservation rolled back with the tenant refusal');

        // المستأجر B غير متأثر.
        $this->aiAsk($b['token'])->assertOk();
    }

    /** @test */
    public function the_global_cap_stops_every_tenant(): void
    {
        $a = $this->aiTenant('ai-a');
        $b = $this->aiTenant('ai-b');
        $this->billableMock();
        [$tokens, $cost] = $this->reservationFor();
        $this->setCaps($a['tenant_id'], $tokens * 100, $cost * 100);
        $this->setCaps($b['tenant_id'], $tokens * 100, $cost * 100);
        // السقف العالمي يتسع لحجز واحد فقط في اللحظة نفسها.
        $this->setCaps(null, $tokens + 5, $cost + 5);
        $calls = 0;
        $this->countingProvider($calls);

        // A يحجز ويسوّي بالفعلي الأصغر؛ يُنزل السقف العالمي لما استُهلك فيمتلئ.
        $this->aiAsk($a['token'])->assertOk();
        $used = $this->budgetRow(null)->used_tokens;
        $this->setCaps(null, $used + 10, $cost + 5);
        $before = $calls;

        $this->aiAsk($b['token'])->assertStatus(503)->assertJsonPath('error.code', 'platform_budget_exceeded');
        $this->aiAsk($a['token'])->assertStatus(503)->assertJsonPath('error.code', 'platform_budget_exceeded');
        $this->assertSame($before, $calls);
        $this->assertSame(0, $this->budgetRow($b['tenant_id'])->reserved_tokens);
    }

    /** @test */
    public function a_zero_cap_denies_everything(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        $this->setCaps(null, 0, 0);
        $this->setCaps($auth['tenant_id'], 0, 0);

        $this->aiAsk($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'platform_budget_exceeded');
    }

    /** @test */
    public function reservations_are_a_single_conditional_update_per_budget_row(): void
    {
        $auth = $this->aiTenant();
        $this->setCaps(null, 1000, 1000);
        $this->setCaps($auth['tenant_id'], 1000, 1000);
        $queries = [];
        DB::listen(function ($q) use (&$queries) {
            $queries[] = $q->sql;
        });

        app(AiBudgetService::class)->reserve($auth['tenant_id'], app(AiBudgetService::class)->period(), 100, 100);

        $budgetQueries = array_values(array_filter($queries, fn ($sql) => str_contains($sql, 'ai_budgets')));
        // لا قراءة قبل الكتابة: تحقق السقف والزيادة في الجملة نفسها (ذرّية).
        $this->assertCount(2, $budgetQueries);
        foreach ($budgetQueries as $sql) {
            $this->assertStringStartsWith('update', strtolower($sql));
            $this->assertStringContainsString('used_tokens + reserved_tokens +', $sql);
            $this->assertStringContainsString('<= cap_tokens', $sql);
            $this->assertStringContainsString('<= cap_cost_micro_usd', $sql);
        }
    }

    /** @test */
    public function interleaved_reservations_never_exceed_the_cap_and_settlement_frees_the_difference(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        $budgets = app(AiBudgetService::class);
        $period = $budgets->period();
        $this->setCaps(null, 1000, 1000000);
        $this->setCaps($auth['tenant_id'], 1000, 1000000);

        // أربعة طلبات «متداخلة» (حُجزت قبل أن يُسوّى أيٌّ منها) بحجم 400 لكل منها: يتسع اثنان فقط.
        $granted = 0;
        $refused = 0;
        for ($i = 0; $i < 4; $i++) {
            try {
                $budgets->reserve($auth['tenant_id'], $period, 400, 0);
                $granted++;
            } catch (AiAssistantDenied $e) {
                $this->assertSame('platform_budget_exceeded', $e->reason);
                $refused++;
            }
        }
        $this->assertSame([2, 2], [$granted, $refused]);
        $this->assertSame(800, $this->budgetRow(null)->reserved_tokens);
        $this->assertLessThanOrEqual(1000, $this->budgetRow(null)->reserved_tokens + $this->budgetRow(null)->used_tokens);
    }

    // ───────────────────────── الفشل وإعادة المحاولة ─────────────────────────

    /** @test */
    public function a_failed_provider_call_is_charged_by_the_failure_policy_and_never_leaks_the_error(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        [$tokens, $cost] = $this->reservationFor();
        $this->setCaps(null, $tokens * 10, $cost * 10);
        $this->setCaps($auth['tenant_id'], $tokens * 10, $cost * 10);
        $calls = 0;
        $this->countingProvider($calls, failure: new RuntimeException('upstream said: ' . self::AI_SECRET));

        $res = $this->aiAsk($auth['token'])->assertStatus(500);

        $this->assertSame('internal_error', $res->json('error.code'));
        $this->assertStringNotContainsString(self::AI_SECRET, $res->getContent());
        $request = $this->requestRow($res->json('request_id'));
        $this->assertSame('failed', $request->status);
        $this->assertSame('provider_error', $request->error_code);
        // سياسة الفشل الافتراضية 'reserved': يُحتسب المحجوز كاملاً (قد يكون الاستدعاء فُوتر).
        $this->assertSame($tokens, $request->unmetered_tokens);
        $this->assertSame($cost, $request->cost_micro_usd);
        $this->assertSame(0, $request->reserved_tokens);
        foreach ([null, $auth['tenant_id']] as $scope) {
            $row = $this->budgetRow($scope);
            $this->assertSame([0, $tokens, $cost], [$row->reserved_tokens, $row->used_tokens, $row->used_cost_micro_usd]);
        }
    }

    /** @test */
    public function failure_charge_can_be_configured_to_none_and_reported_usage_wins(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        [$tokens, $cost] = $this->reservationFor();
        $this->setCaps(null, $tokens * 10, $cost * 10);
        $this->setCaps($auth['tenant_id'], $tokens * 10, $cost * 10);
        $calls = 0;

        config(['ai_assistant.budget.failure_charge' => 'none']);
        $this->countingProvider($calls, failure: new RuntimeException('x'));
        $this->aiAsk($auth['token'])->assertStatus(500);
        $this->assertSame([0, 0, 0], array_values($this->budgetRow(null)->only(['reserved_tokens', 'used_tokens', 'used_cost_micro_usd'])));

        // استهلاك مُبلَّغ به مع الفشل يُحتسب كما هو بغض النظر عن السياسة.
        $this->countingProvider($calls, failure: new AiProviderException('timeout', ['input_tokens' => 50, 'output_tokens' => 7]));
        $res = $this->aiAsk($auth['token'])->assertStatus(500);
        $request = $this->requestRow($res->json('request_id'));
        $this->assertSame([50, 7, 0], [$request->input_tokens, $request->output_tokens, $request->unmetered_tokens]);
        $this->assertSame(57, $this->budgetRow(null)->used_tokens);
    }

    /** @test */
    public function an_idempotent_retry_after_failure_is_a_new_attempt_with_cumulative_accounting(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        [$tokens, $cost] = $this->reservationFor();
        $this->setCaps(null, $tokens * 10, $cost * 10);
        $this->setCaps($auth['tenant_id'], $tokens * 10, $cost * 10);
        $calls = 0;
        $key = 'retry-key-0001';

        $this->countingProvider($calls, failure: new RuntimeException('boom'));
        $failed = $this->aiAsk($auth['token'], [], ['Idempotency-Key' => $key])->assertStatus(500);
        $requestId = $failed->json('request_id');

        $this->countingProvider($calls);
        $ok = $this->aiAsk($auth['token'], [], ['Idempotency-Key' => $key])->assertOk();

        $this->assertSame($requestId, $ok->json('data.request_id'), 'same logical request');
        $this->assertSame(2, $ok->json('data.attempt'));
        $request = $this->requestRow($requestId);
        $this->assertSame('settled', $request->status);
        $usage = $this->mockUsageFor();
        $this->assertSame($usage['input_tokens'], $request->input_tokens);
        $this->assertSame($tokens, $request->unmetered_tokens, 'the failed attempt stays charged');
        $this->assertSame($tokens + $usage['input_tokens'] + $usage['output_tokens'], $this->budgetRow($auth['tenant_id'])->used_tokens);
        $this->assertSame(1, AiRequest::withoutGlobalScopes()->count());
        $this->assertSame(0, $this->budgetRow(null)->reserved_tokens);
    }

    // ───────────────────────── مفتاح التكرار ─────────────────────────

    /** @test */
    public function a_settled_request_replayed_with_the_same_key_is_refused_without_a_second_charge(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        [$tokens, $cost] = $this->reservationFor();
        $this->setCaps(null, $tokens * 10, $cost * 10);
        $this->setCaps($auth['tenant_id'], $tokens * 10, $cost * 10);
        $calls = 0;
        $this->countingProvider($calls);
        $headers = ['Idempotency-Key' => 'dup-key-000001'];

        $first = $this->aiAsk($auth['token'], [], $headers)->assertOk();
        $usedAfterFirst = $this->budgetRow(null)->used_tokens;
        $callsAfterFirst = $calls;

        $dup = $this->aiAsk($auth['token'], [], $headers)->assertStatus(409);

        $this->assertSame('duplicate_request', $dup->json('error.code'));
        $this->assertSame($first->json('data.request_id'), $dup->json('request_id'), 'points at the original request');
        $this->assertSame($callsAfterFirst, $calls);
        $this->assertSame($usedAfterFirst, $this->budgetRow(null)->used_tokens);
        $this->assertStringNotContainsString('content', $dup->getContent(), 'no reply is stored or replayed');
    }

    /** @test */
    public function an_in_flight_duplicate_and_a_key_reused_for_a_different_request_are_refused(): void
    {
        $auth = $this->aiTenant();
        $headers = ['Idempotency-Key' => 'flight-key-001'];
        $first = $this->aiAsk($auth['token'], [], $headers)->assertOk();

        // يُحاكى «قيد التنفيذ» بإعادة الصف إلى reserved.
        AiRequest::withoutGlobalScopes()->whereKey($first->json('data.request_id'))->update(['status' => 'reserved']);
        $this->aiAsk($auth['token'], [], $headers)->assertStatus(409)->assertJsonPath('error.code', 'request_in_progress');

        // المفتاح نفسه مع طلب مختلف.
        $this->aiAsk($auth['token'], ['message' => 'سؤال مختلف'], $headers)
            ->assertStatus(422)->assertJsonPath('error.code', 'idempotency_key_reuse');
    }

    /** @test */
    public function idempotency_keys_are_scoped_per_tenant_and_validated(): void
    {
        $a = $this->aiTenant('ai-a');
        $b = $this->aiTenant('ai-b');
        $headers = ['Idempotency-Key' => 'shared-key-001'];

        $this->aiAsk($a['token'], [], $headers)->assertOk();
        $this->aiAsk($b['token'], [], $headers)->assertOk();   // نفس المفتاح، مستأجر آخر: لا تصادم
        $this->assertSame(2, AiRequest::withoutGlobalScopes()->count());

        foreach (['short', str_repeat('a', 65), 'has space in it', "bad\nkey-0001"] as $bad) {
            $res = $this->aiAsk($a['token'], [], ['Idempotency-Key' => $bad]);
            $res->assertStatus(422);
            $this->assertSame('invalid_request', $res->json('error.code'));
        }
    }

    /** @test */
    public function the_request_record_stores_only_hashes_never_the_key_or_the_prompt(): void
    {
        $auth = $this->aiTenant();
        $this->aiAsk($auth['token'], [], ['Idempotency-Key' => 'plain-key-12345'])->assertOk();

        $row = AiRequest::withoutGlobalScopes()->first();
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $row->idempotency_hash);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $row->request_fingerprint);
        $dump = json_encode(DB::table('ai_requests')->get(), JSON_UNESCAPED_UNICODE);
        $this->assertStringNotContainsString('plain-key-12345', $dump);
        $this->assertStringNotContainsString('PROMPT-CANARY', $dump);
        $this->assertStringNotContainsString('المنارة', $dump);
        // الإخفاء في التسلسل
        $this->assertArrayNotHasKey('idempotency_hash', $row->toArray());
    }

    // ───────────────────────── الحجوزات المهجورة والتسوية الواحدة ─────────────────────────

    /** @test */
    public function settlement_is_applied_exactly_once_even_if_attempted_twice(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        $budgets = app(AiBudgetService::class);
        $ledger = app(AiRequestLedger::class);
        $this->setCaps(null, 10000, 10000000);
        $this->setCaps($auth['tenant_id'], 10000, 10000000);
        app(\App\Tenancy\TenantContext::class)->set($auth['tenant_id']);

        $request = $ledger->open($auth['tenant_id'], (string) Str::uuid(), 'mock', 'mock-1', ['billable' => true], 500, 5000, null, str_repeat('a', 64));
        $usage = ['input_tokens' => 100, 'output_tokens' => 50, 'cost_micro_usd' => 700];

        $this->assertTrue($ledger->complete($request, $usage));
        $this->assertFalse($ledger->complete($request, $usage), 'a second settlement is a no-op');
        $this->assertFalse($ledger->fail($request, null, 'late_failure'), 'so is a late failure after settlement');

        $row = $this->budgetRow(null);
        $this->assertSame([0, 150, 700], [$row->reserved_tokens, $row->used_tokens, $row->used_cost_micro_usd]);
        $this->assertSame('settled', $this->requestRow($request->id)->status);
    }

    /** @test */
    public function an_abandoned_reservation_is_reaped_with_the_failure_policy_to_unblock_capacity(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        [$tokens, $cost] = $this->reservationFor();
        // يتسع لحجز واحد كامل فقط.
        $this->setCaps(null, $tokens + 10, $cost + 10);
        $this->setCaps($auth['tenant_id'], $tokens + 10, $cost + 10);
        $ledger = app(AiRequestLedger::class);
        app(\App\Tenancy\TenantContext::class)->set($auth['tenant_id']);
        $abandoned = $ledger->open($auth['tenant_id'], (string) Str::uuid(), 'mock', 'mock-1', ['billable' => true], $tokens, $cost, null, str_repeat('b', 64));
        app(\App\Tenancy\TenantContext::class)->forget();

        // غير منتهٍ بعد: يحجب الطلب التالي (السقف العالمي يُفحص أولاً) ولا يُنظَّف.
        $this->aiAsk($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'platform_budget_exceeded');
        $this->assertSame('reserved', $this->requestRow($abandoned->id)->status);

        // سياسة 'none': بعد انتهاء المهلة يُحرَّر الحجز بلا احتساب فيتسع الطلب.
        config(['ai_assistant.budget.failure_charge' => 'none']);
        AiRequest::withoutGlobalScopes()->whereKey($abandoned->id)->update(['updated_at' => now()->subSeconds(601)]);
        $this->aiAsk($auth['token'])->assertOk();
        $reaped = $this->requestRow($abandoned->id);
        $this->assertSame(['failed', 'reservation_expired', 0], [$reaped->status, $reaped->error_code, $reaped->cost_micro_usd]);
    }

    /** @test */
    public function an_abandoned_reservation_is_charged_in_full_under_the_default_policy(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        [$tokens, $cost] = $this->reservationFor();
        $this->setCaps(null, $tokens + 10, $cost + 10);
        $this->setCaps($auth['tenant_id'], $tokens + 10, $cost + 10);
        app(\App\Tenancy\TenantContext::class)->set($auth['tenant_id']);
        $abandoned = app(AiRequestLedger::class)->open($auth['tenant_id'], (string) Str::uuid(), 'mock', 'mock-1', ['billable' => true], $tokens, $cost, null, str_repeat('c', 64));
        app(\App\Tenancy\TenantContext::class)->forget();
        AiRequest::withoutGlobalScopes()->whereKey($abandoned->id)->update(['updated_at' => now()->subSeconds(601)]);

        // التنظيف يحتسب المحجوز (استدعاء قد يكون فُوتر) فيبقى السقف ممتلئاً → رفض مشروع.
        $this->aiAsk($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'platform_budget_exceeded');
        $this->assertSame([0, $tokens], [$this->budgetRow(null)->reserved_tokens, $this->budgetRow(null)->used_tokens]);
        $this->assertSame($tokens, $this->requestRow($abandoned->id)->unmetered_tokens);
    }

    // ───────────────────────── تجاوز الفعلي للمحجوز ─────────────────────────

    /** @test */
    public function actual_usage_above_the_reservation_is_recorded_and_blocks_what_follows(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        [$tokens, $cost] = $this->reservationFor();
        $this->setCaps(null, $tokens * 2, $cost * 10);
        $this->setCaps($auth['tenant_id'], $tokens * 2, $cost * 10);
        $calls = 0;
        $this->countingProvider($calls, usage: ['input_tokens' => $tokens + 500, 'output_tokens' => 10]);

        $res = $this->aiAsk($auth['token'])->assertOk();

        $this->assertSame($tokens + 510, $this->budgetRow($auth['tenant_id'])->used_tokens, 'the truth is recorded, not clamped');
        $this->assertSame(0, $this->budgetRow($auth['tenant_id'])->reserved_tokens);
        $completed = $this->auditEvents($res->json('data.request_id'))->firstWhere('event', 'request.completed');
        $this->assertTrue($completed->meta['overrun']);
        // بعد التجاوز لا مجال لحجز جديد كامل.
        $this->aiAsk($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'platform_budget_exceeded');
    }

    // ───────────────────────── الفترات الشهرية ─────────────────────────

    /** @test */
    public function budgets_are_per_utc_month_and_a_request_settles_into_the_period_it_reserved_in(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        $budgets = app(AiBudgetService::class);
        $this->setCaps(null, 100000, 100000000, '2026-10');
        $this->setCaps($auth['tenant_id'], 100000, 100000000, '2026-10');
        app(\App\Tenancy\TenantContext::class)->set($auth['tenant_id']);

        Carbon::setTestNow('2026-10-31 23:59:30 UTC');
        $this->assertSame('2026-10', $budgets->period());
        $request = app(AiRequestLedger::class)->open($auth['tenant_id'], (string) Str::uuid(), 'mock', 'mock-1', ['billable' => true], 1000, 1000, null, str_repeat('d', 64));

        // التسوية بعد منتصف الليل تذهب إلى فترة الحجز لا الفترة الجديدة.
        Carbon::setTestNow('2026-11-01 00:00:30 UTC');
        $this->assertSame('2026-11', $budgets->period());
        app(AiRequestLedger::class)->complete($request, ['input_tokens' => 300, 'output_tokens' => 200, 'cost_micro_usd' => 900]);
        $this->assertSame([0, 500], [$this->budgetRow(null, '2026-10')->reserved_tokens, $this->budgetRow(null, '2026-10')->used_tokens]);

        // وحجز جديد في نوفمبر بلا سقف نوفمبر مرفوض (لا ترحيل ضمني للسقف).
        try {
            $budgets->reserve($auth['tenant_id'], $budgets->period(), 1, 1);
            $this->fail('A reservation without a cap for the current month must be refused.');
        } catch (AiAssistantDenied $e) {
            $this->assertSame('budget_not_configured', $e->reason);
        }
        $this->assertSame(0, AiBudget::where('period', '2026-11')->count());
    }

    /** @test */
    public function caps_are_validated_and_can_be_lowered_below_usage(): void
    {
        $budgets = app(AiBudgetService::class);

        foreach ([['2026-13', 1, 1], ['2026-1', 1, 1], ['2026-10', -1, 1], ['2026-10', 1, -1]] as [$period, $t, $c]) {
            try {
                $budgets->setCaps(null, $period, $t, $c);
                $this->fail("setCaps accepted {$period}/{$t}/{$c}");
            } catch (\InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }

        $row = $budgets->setCaps(null, '2026-10', 100, 100);
        AiBudget::whereKey($row->id)->update(['used_tokens' => 80]);
        $lowered = $budgets->setCaps(null, '2026-10', 50, 100);
        $this->assertSame([50, 80], [$lowered->cap_tokens, $lowered->used_tokens], 'lowering never rewrites usage');
    }

    // ───────────────────────── مفتاح الإيقاف والخروج ─────────────────────────

    /** @test */
    public function the_platform_kill_switch_stops_everything_before_any_budget_or_ledger_work(): void
    {
        $auth = $this->aiTenant(platform: false);
        $this->billableMock();
        $this->setCaps(null, 100000, 100000000);
        $this->setCaps($auth['tenant_id'], 100000, 100000000);
        $calls = 0;
        $this->countingProvider($calls);

        $this->aiAsk($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'platform_disabled');

        $this->assertSame(0, $calls);
        $this->assertSame(0, AiRequest::withoutGlobalScopes()->count());
        $this->assertSame(0, $this->budgetRow(null)->reserved_tokens + $this->budgetRow(null)->used_tokens);
    }

    /** @test */
    public function the_metering_sources_contain_no_network_or_provider_client_code(): void
    {
        $files = [
            'app/Services/AiBudgetService.php', 'app/Services/AiRequestLedger.php', 'app/Services/AiAuditRecorder.php',
            'app/Services/AiAssistantGateway.php', 'app/Support/AiAssistantPricing.php', 'app/Support/AiProviderException.php',
            'app/Models/AiBudget.php', 'app/Models/AiRequest.php', 'app/Models/AiAuditEvent.php',
            'app/Http/Controllers/Api/AiAuditController.php', 'app/Console/Commands/PruneAiRecords.php',
        ];
        $forbidden = ['Http::', 'GuzzleHttp', 'curl_', 'fsockopen', 'stream_socket', 'file_get_contents', 'PlatformIntegration', 'api_key', 'Crypt::', 'anthropic', 'openai', 'gemini'];

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
}
