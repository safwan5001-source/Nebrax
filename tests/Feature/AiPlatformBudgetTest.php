<?php

namespace Tests\Feature;

use App\Models\AiBudget;
use App\Models\AiRequest;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentProviderAttempt;
use App\Models\PlatformAdministrator;
use App\Models\PlatformIntegrationAuditEvent;
use App\Services\AiBudgetService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * AI-07: ميزانيات الذكاء الاصطناعي من منصة الإدارة العليا (واجهة فوق `AiBudgetService`)، وقياس استخراج المستندات ضمن
 * الميزانية نفسها كسياسة اختيارية.
 *
 * تشغيل: php artisan test --filter=AiPlatformBudgetTest
 */
class AiPlatformBudgetTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiAssistant;
    use InteractsWithDocumentPipeline;

    private const PASSWORD = 'platform-password-123';
    private const PRICING = [self::DOC_MODEL => ['input_micro_usd_per_1k' => 3000, 'output_micro_usd_per_1k' => 15000]];

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
    }

    // ───────────────────────── platform budget API ─────────────────────────

    /** @return array{0:PlatformAdministrator,1:string} */
    private function platformToken(array $abilities, string $email = 'budgets@nebrax.test'): array
    {
        $administrator = PlatformAdministrator::create(['name' => 'مدير ميزانيات', 'email' => $email, 'password' => self::PASSWORD]);

        return [$administrator, $administrator->createToken('platform-console', $abilities)->plainTextToken];
    }

    private function putBudget(string $token, array $payload)
    {
        return $this->withToken($token)->putJson('/api/platform/ai-budgets', $payload + ['current_password' => self::PASSWORD]);
    }

    private function period(): string
    {
        return app(AiBudgetService::class)->period();
    }

    /** @test */
    public function a_platform_manager_sets_global_then_tenant_caps_through_the_existing_budget_service(): void
    {
        [$admin, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $tenant = $this->registerTenant('bud-a', 'owner@bud-a.test');
        $p = $this->period();

        $this->putBudget($token, ['scope' => 'global', 'period' => $p, 'cap_tokens' => 5_000_000, 'cap_cost_micro_usd' => 50_000_000])
            ->assertOk()->assertJsonPath('data.global.cap_tokens', 5_000_000)->assertJsonPath('data.global.cap_cost_usd', '50.000000');
        $this->putBudget($token, ['scope' => 'tenant', 'tenant_id' => $tenant['tenant_id'], 'period' => $p, 'cap_tokens' => 1_000_000, 'cap_cost_micro_usd' => 10_000_000])
            ->assertOk()->assertJsonPath('data.tenants.0.tenant_id', $tenant['tenant_id'])->assertJsonPath('data.tenants.0.cap_tokens', 1_000_000)
            ->assertJsonPath('data.over_allocated', false);

        // نفس صفوف المحرك: ما يحجز عليه المساعد.
        $this->assertSame(1_000_000, AiBudget::query()->where('budget_key', 'tenant:' . $tenant['tenant_id'])->where('period', $p)->value('cap_tokens'));
        // تدقيق بأسماء الحقول فقط، لا قيم ولا كلمة مرور.
        $events = PlatformIntegrationAuditEvent::query()->where('integration_key', 'ai_budget')->get();
        $this->assertCount(2, $events);
        $this->assertSame($admin->id, $events[0]->platform_administrator_id);
        $this->assertContains('global.cap_tokens', $events[0]->changed_keys);
        $this->assertStringNotContainsString(self::PASSWORD, json_encode($events->toArray()));
        $this->assertStringNotContainsString('5000000', json_encode($events->toArray()));
    }

    /** @test */
    public function writes_need_the_manage_ability_and_the_current_password_and_reads_need_a_platform_session(): void
    {
        [, $reader] = $this->platformToken(['platform:read'], 'reader@nebrax.test');
        [, $manager] = $this->platformToken(['platform:read', 'platform:manage'], 'manager@nebrax.test');
        $payload = ['scope' => 'global', 'period' => $this->period(), 'cap_tokens' => 100, 'cap_cost_micro_usd' => 100];

        $this->withToken($reader)->getJson('/api/platform/ai-budgets')->assertOk();
        $this->putBudget($reader, $payload)->assertForbidden();
        $this->withToken($manager)->putJson('/api/platform/ai-budgets', $payload + ['current_password' => 'wrong-password'])
            ->assertStatus(422)->assertJsonValidationErrors('current_password');
        $this->assertSame(0, AiBudget::query()->count());

        // مستأجر عادي (رمز مستأجر) لا يصل لا بالقراءة ولا بالكتابة.
        $tenant = $this->registerTenant('bud-b', 'owner@bud-b.test');
        $this->withToken($tenant['token'])->getJson('/api/platform/ai-budgets')->assertStatus(403);
        $this->withToken($tenant['token'])->putJson('/api/platform/ai-budgets', $payload + ['current_password' => self::PASSWORD])->assertStatus(403);
        $this->flushHeaders();
        $this->getJson('/api/platform/ai-budgets')->assertUnauthorized();
    }

    /** @test */
    public function over_spend_guards_reject_past_periods_oversized_caps_unknown_tenants_and_tenant_caps_above_the_global_cap(): void
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $tenant = $this->registerTenant('bud-c', 'owner@bud-c.test');
        $p = $this->period();
        $base = ['scope' => 'global', 'period' => $p, 'cap_tokens' => 1000, 'cap_cost_micro_usd' => 1000];

        $this->putBudget($token, ['period' => '2020-01'] + $base)->assertStatus(422)->assertJsonValidationErrors('period');
        $this->putBudget($token, ['cap_tokens' => 10_000_000_000_000] + $base)->assertStatus(422);
        $this->putBudget($token, ['cap_cost_micro_usd' => 100_000_000_001] + $base)->assertStatus(422);
        $this->putBudget($token, ['cap_tokens' => -1] + $base)->assertStatus(422);
        $this->putBudget($token, ['period' => '2026-13'] + $base)->assertStatus(422);
        $this->putBudget($token, ['scope' => 'tenant', 'tenant_id' => '11111111-1111-4111-8111-111111111111'] + $base)->assertStatus(422)->assertJsonValidationErrors('tenant_id');
        $this->putBudget($token, ['scope' => 'tenant'] + $base)->assertStatus(422)->assertJsonValidationErrors('tenant_id');

        $this->putBudget($token, $base)->assertOk();
        $this->putBudget($token, ['scope' => 'tenant', 'tenant_id' => $tenant['tenant_id'], 'cap_tokens' => 1001] + $base)->assertStatus(422);
        $this->putBudget($token, ['scope' => 'tenant', 'tenant_id' => $tenant['tenant_id'], 'cap_cost_micro_usd' => 1001] + $base)->assertStatus(422);
        $this->putBudget($token, ['scope' => 'tenant', 'tenant_id' => $tenant['tenant_id']] + $base)->assertOk();
    }

    /** @test */
    public function lowering_a_cap_below_current_usage_stops_new_reservations_and_over_allocation_is_reported(): void
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $a = $this->registerTenant('bud-d', 'owner@bud-d.test');
        $b = $this->registerTenant('bud-e', 'owner@bud-e.test');
        $p = $this->period();

        $this->putBudget($token, ['scope' => 'global', 'period' => $p, 'cap_tokens' => 1000, 'cap_cost_micro_usd' => 1000])->assertOk();
        foreach ([$a, $b] as $t) {
            $this->putBudget($token, ['scope' => 'tenant', 'tenant_id' => $t['tenant_id'], 'period' => $p, 'cap_tokens' => 800, 'cap_cost_micro_usd' => 800])->assertOk();
        }
        // 800 + 800 > 1000 ⇒ مسموح لكنه معلن.
        $this->withToken($token)->getJson('/api/platform/ai-budgets?period=' . $p)->assertOk()->assertJsonPath('data.over_allocated', true);

        $budgets = app(AiBudgetService::class);
        $budgets->reserve($a['tenant_id'], $p, 600, 600);
        $this->putBudget($token, ['scope' => 'global', 'period' => $p, 'cap_tokens' => 100, 'cap_cost_micro_usd' => 100])->assertOk();
        $this->expectExceptionObject(\App\Support\AiAssistantDenied::for('platform_budget_exceeded'));
        $budgets->reserve($b['tenant_id'], $p, 1, 1);
    }

    /** @test */
    public function the_overview_splits_consumption_by_feature_and_exposes_no_prices_or_keys(): void
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $tenant = $this->registerTenant('bud-f', 'owner@bud-f.test');
        $p = $this->period();
        config(['ai_assistant.pricing.anthropic' => self::PRICING]);
        AiRequest::query()->create(['tenant_id' => $tenant['tenant_id'], 'actor_id' => '00000000-0000-0000-0000-000000000000', 'feature' => 'document_extraction',
            'provider' => 'anthropic', 'model' => self::DOC_MODEL, 'billable' => true, 'status' => 'settled', 'period' => $p, 'attempt' => 1, 'reserved_tokens' => 0, 'reserved_cost_micro_usd' => 0, 'started_at' => now()]);
        DB::table('ai_requests')->update(['input_tokens' => 4000, 'output_tokens' => 500, 'cost_micro_usd' => 19_500]);

        $res = $this->withToken($token)->getJson('/api/platform/ai-budgets')->assertOk();
        $res->assertJsonPath('data.by_feature.0.feature', 'document_extraction')->assertJsonPath('data.by_feature.0.tokens', 4500)
            ->assertJsonPath('data.by_feature.0.cost_usd', '0.019500')->assertJsonPath('data.policy.meter_document_extraction', false);
        foreach (['micro_usd_per_1k', 'api_key', 'sk-ant', self::DOC_KEY] as $needle) {
            $this->assertStringNotContainsString($needle, $res->getContent());
        }
    }

    /** @test */
    public function budgets_set_by_the_platform_api_are_what_the_assistant_enforces(): void
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $tenant = $this->aiTenant('bud-g');
        $this->aiOptIn($tenant['tenant_id']);
        $this->billableMock();

        $this->aiAsk($tenant['token'])->assertJsonPath('error.code', 'budget_not_configured');

        $p = $this->period();
        $this->putBudget($token, ['scope' => 'global', 'period' => $p, 'cap_tokens' => 5_000_000, 'cap_cost_micro_usd' => 50_000_000])->assertOk();
        $this->putBudget($token, ['scope' => 'tenant', 'tenant_id' => $tenant['tenant_id'], 'period' => $p, 'cap_tokens' => 5_000_000, 'cap_cost_micro_usd' => 50_000_000])->assertOk();
        $this->aiAsk($tenant['token'])->assertOk();

        $this->putBudget($token, ['scope' => 'tenant', 'tenant_id' => $tenant['tenant_id'], 'period' => $p, 'cap_tokens' => 1, 'cap_cost_micro_usd' => 1])->assertOk();
        $this->aiAsk($tenant['token'], ['message' => 'second'])->assertStatus(429)->assertJsonPath('error.code', 'budget_exceeded');
    }

    // ───────────────────────── document extraction metering ─────────────────────────

    private function extractWith(string $slug, ?callable $afterSetup = null): array
    {
        $this->bootDocumentPipeline();
        $auth = $this->documentTenant($slug);
        $afterSetup && $afterSetup($auth);
        $batch = $this->batchWithFile($auth['token']);
        $job = $this->completeAndScan($auth['token'], $batch);

        return [$auth, $batch, $job];
    }

    private function anthropicCalls(): int
    {
        return count(array_filter(Http::recorded()->all(), fn ($pair) => $pair[0]->url() === self::ANTHROPIC_ENDPOINT));
    }

    /** @test */
    public function extraction_through_the_existing_anthropic_path_is_unmetered_by_default_so_current_behaviour_is_unchanged(): void
    {
        [$auth, $batch, $job] = $this->extractWith('ext-meter-off');
        Http::fake([self::ANTHROPIC_ENDPOINT => Http::response($this->anthropicExtractionResponse($this->extractionPayload()))]);

        $this->runExtraction($job);

        $result = DocumentExtractionResult::firstOrFail();
        $this->assertSame('anthropic', $result->provider_key);
        $this->assertSame(self::DOC_MODEL, $result->model);
        $this->assertSame('PI-42', $result->normalized_payload['fields']['document_number']);
        $this->assertSame(0, AiRequest::query()->count(), 'no AI budget rows when the policy is off');
        $this->assertDatabaseHas('document_provider_usage_events', ['provider_key' => 'anthropic', 'input_tokens' => 4200, 'output_tokens' => 900]);
        $this->assertSame(1, $this->anthropicCalls());
        $sent = Http::recorded()->all()[0][0];
        $this->assertSame(self::DOC_KEY, $sent->header('x-api-key')[0]);
    }

    /** @test */
    public function metered_extraction_reserves_before_the_call_and_settles_by_actual_usage_in_the_same_budget(): void
    {
        config(['ai_assistant.budget.meter_document_extraction' => true, 'ai_assistant.pricing.anthropic' => self::PRICING]);
        [$auth, $batch, $job] = $this->extractWith('ext-meter-on', function (array $auth): void {
            $this->setCaps(null, 10_000_000, 100_000_000);
            $this->setCaps($auth['tenant_id'], 10_000_000, 100_000_000);
        });
        $reservedDuringCall = null;
        Http::fake([self::ANTHROPIC_ENDPOINT => function () use ($auth, &$reservedDuringCall) {
            $reservedDuringCall = (int) AiBudget::query()->where('budget_key', 'tenant:' . $auth['tenant_id'])->value('reserved_tokens');

            return Http::response($this->anthropicExtractionResponse($this->extractionPayload(), 4200, 900));
        }]);

        $this->runExtraction($job);

        $this->assertGreaterThan(0, $reservedDuringCall, 'the reservation exists before the provider is called');
        $request = AiRequest::query()->firstOrFail();
        $this->assertSame('document_extraction', $request->feature);
        $this->assertSame(AiRequest::STATUS_SETTLED, $request->status);
        $this->assertSame([4200, 900, 0], [$request->input_tokens, $request->output_tokens, $request->reserved_tokens]);
        // 4200×3000/1000 + 900×15000/1000 = 12,600 + 13,500 micro-USD
        $this->assertSame(26_100, $request->cost_micro_usd);
        foreach (['global', 'tenant:' . $auth['tenant_id']] as $key) {
            $row = AiBudget::query()->where('budget_key', $key)->firstOrFail();
            $this->assertSame([5100, 0, 26_100], [$row->used_tokens, $row->reserved_tokens, $row->used_cost_micro_usd], $key);
        }
        $this->assertSame(1, DocumentExtractionResult::query()->count());
    }

    /** @test */
    public function metered_extraction_never_sends_the_document_without_a_budget_a_price_or_headroom(): void
    {
        config(['ai_assistant.budget.meter_document_extraction' => true]);
        $cases = [
            'no budget row' => [self::PRICING, null, 'ai_budget_budget_not_configured'],
            'no price for the model' => [[], [10_000_000, 100_000_000], 'ai_budget_pricing_unknown'],
            'tenant cap exhausted' => [self::PRICING, [10, 10], 'ai_budget_budget_exceeded'],
        ];
        foreach ($cases as $label => [$pricing, $caps, $code]) {
            Http::fake([self::ANTHROPIC_ENDPOINT => Http::response($this->anthropicExtractionResponse($this->extractionPayload()))]);
            config(['ai_assistant.pricing.anthropic' => $pricing]);
            DB::table('ai_budgets')->delete();
            [$auth, $batch, $job] = $this->extractWith('ext-meter-' . md5($label), function (array $auth) use ($caps): void {
                if ($caps !== null) {
                    $this->setCaps(null, 10_000_000, 100_000_000);
                    $this->setCaps($auth['tenant_id'], $caps[0], $caps[1]);
                }
            });
            $before = $this->anthropicCalls();

            $this->runExtraction($job);

            $this->assertSame($before, $this->anthropicCalls(), "{$label}: the provider was never called");
            $this->assertSame(0, DocumentExtractionResult::query()->count(), $label);
            $this->assertDatabaseHas('document_provider_attempts', ['status' => 'skipped', 'error_code' => $code]);
            $this->assertStringNotContainsString(self::DOC_KEY, json_encode(DocumentProviderAttempt::query()->get()->toArray()));
            DB::table('document_provider_attempts')->delete();
        }
    }

    /** @test */
    public function an_authentication_failure_is_not_billed_but_an_unreported_usage_follows_the_failure_policy(): void
    {
        config(['ai_assistant.budget.meter_document_extraction' => true, 'ai_assistant.pricing.anthropic' => self::PRICING]);
        [$auth, , $job] = $this->extractWith('ext-meter-401', function (array $auth): void {
            $this->setCaps(null, 10_000_000, 100_000_000);
            $this->setCaps($auth['tenant_id'], 10_000_000, 100_000_000);
        });
        Http::fake([self::ANTHROPIC_ENDPOINT => Http::response(['error' => ['message' => 'bad key ' . self::DOC_KEY]], 401)]);

        $this->runExtraction($job);

        $request = AiRequest::query()->firstOrFail();
        $this->assertSame(AiRequest::STATUS_FAILED, $request->status);
        $this->assertSame([0, 0, 0, 0], [$request->input_tokens, $request->output_tokens, $request->unmetered_tokens, $request->cost_micro_usd], '401 generates no tokens');
        $this->assertSame(0, (int) AiBudget::query()->where('budget_key', 'global')->value('reserved_tokens'), 'nothing left reserved');
        $this->assertStringNotContainsString(self::DOC_KEY, json_encode([DB::table('document_provider_attempts')->get(), DB::table('ai_requests')->get()]));
    }

    /** @test */
    public function metered_extraction_is_isolated_per_tenant(): void
    {
        config(['ai_assistant.budget.meter_document_extraction' => true, 'ai_assistant.pricing.anthropic' => self::PRICING]);
        $other = $this->registerTenant('ext-other', 'owner@ext-other.test');
        [$auth, , $job] = $this->extractWith('ext-meter-iso', function (array $auth) use ($other): void {
            $this->setCaps(null, 10_000_000, 100_000_000);
            $this->setCaps($auth['tenant_id'], 10_000_000, 100_000_000);
            $this->setCaps($other['tenant_id'], 10_000_000, 100_000_000);
        });
        Http::fake([self::ANTHROPIC_ENDPOINT => Http::response($this->anthropicExtractionResponse($this->extractionPayload(), 1000, 100))]);

        $this->runExtraction($job);

        $this->assertSame(0, (int) AiBudget::query()->where('budget_key', 'tenant:' . $other['tenant_id'])->value('used_tokens'));
        $this->assertSame(1100, (int) AiBudget::query()->where('budget_key', 'tenant:' . $auth['tenant_id'])->value('used_tokens'));
        $this->assertSame($auth['tenant_id'], AiRequest::query()->withoutGlobalScopes()->firstOrFail()->tenant_id);
    }
}
