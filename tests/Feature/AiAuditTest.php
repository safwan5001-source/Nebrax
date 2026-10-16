<?php

namespace Tests\Feature;

use App\Models\AiAuditEvent;
use App\Models\AiRequest;
use App\Models\PlatformIntegrationSetting;
use App\Models\Role;
use App\Services\AiAuditRecorder;
use App\Services\MockAiAssistantProvider;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * AWJ Intelligence — AI-02A: التدقيق الدائم (وصفي فقط) وصلاحية قراءته وسياسة احتفاظه.
 *
 * تشغيل: php artisan test --filter=AiAuditTest
 */
class AiAuditTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiAssistant;

    private const URL = '/api/ai-assistant/audit-events';

    protected function setUp(): void
    {
        parent::setUp();

        Http::preventStrayRequests();
        Http::fake();
    }

    protected function tearDown(): void
    {
        Http::assertNothingSent();

        parent::tearDown();
    }

    private function recorder(): AiAuditRecorder
    {
        return app(AiAuditRecorder::class);
    }

    /** مفتاح تفعيل سطح القراءة لدور مخصص بصلاحية التدقيق وحدها. */
    private function auditReaderToken(array $auth, string $email = 'auditor@ai.test'): string
    {
        app(TenantContext::class)->set($auth['tenant_id']);
        Role::create(['slug' => 'ai_auditor', 'name' => 'مدقق', 'permissions' => ['ai.audit.view'], 'is_system' => false]);

        return $this->tokenForRole($auth['tenant_id'], 'ai_auditor', $email);
    }

    // ───────────────────────── ما يُدقَّق ─────────────────────────

    /** @test */
    public function a_successful_request_leaves_durable_metadata_only_events(): void
    {
        $auth = $this->aiTenant();
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_ai', 'provider' => 'anthropic', 'enabled' => true,
            'configuration' => ['providers' => ['anthropic' => ['api_key' => self::AI_SECRET]]],
        ]);

        $res = $this->aiAsk($auth['token'])->assertOk();
        $events = $this->auditEvents($res->json('data.request_id'));

        $this->assertEqualsCanonicalizing(['request.started', 'request.completed'], $events->pluck('event')->all());
        $completed = $events->firstWhere('event', 'request.completed');
        $this->assertSame($auth['tenant_id'], $completed->tenant_id);
        $this->assertNotNull($completed->actor_id);
        $this->assertSame(['assistant', 'mock', 'mock-1', 'allowed', 'ok', 1], [
            $completed->feature, $completed->provider, $completed->model, $completed->outcome, $completed->reason, $completed->attempt,
        ]);
        $usage = $this->mockUsageFor();
        $this->assertSame([$usage['input_tokens'], $usage['output_tokens'], 0], [$completed->input_tokens, $completed->output_tokens, $completed->cost_micro_usd]);
        $this->assertEqualsCanonicalizing(
            ['message_chars', 'branch_mode', 'branch_count', 'warehouse_mode', 'warehouse_count', 'billable', 'overrun', 'tool_calls_planned'],
            array_keys($completed->meta),
        );
        $this->assertNotNull($completed->occurred_at);

        // لا شيء من الحقول الحساسة في أي صف: لا prompt ولا ردّ ولا مفتاح منصة.
        $dump = json_encode(DB::table('ai_audit_events')->get(), JSON_UNESCAPED_UNICODE);
        foreach (['PROMPT-CANARY', 'المنارة', self::AI_SECRET, 'ردّ تجريبي'] as $needle) {
            $this->assertStringNotContainsString($needle, $dump, $needle);
        }
    }

    /** @test */
    public function denials_are_audited_with_their_stable_reason_code(): void
    {
        $auth = $this->aiTenant(platform: false);

        $res = $this->aiAsk($auth['token'])->assertStatus(503);

        $events = $this->auditEvents($res->json('request_id'));
        $this->assertCount(1, $events);
        $this->assertSame(['request.denied', 'denied', 'platform_disabled'], [$events[0]->event, $events[0]->outcome, $events[0]->reason]);
        $this->assertSame($auth['tenant_id'], $events[0]->tenant_id);
    }

    /** @test */
    public function the_started_event_is_durable_before_the_provider_is_called(): void
    {
        $auth = $this->aiTenant();
        $seen = null;
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(function () use (&$seen) {
            $seen = $this->auditEvents()->pluck('event')->all();

            return [];
        }));

        $this->aiAsk($auth['token'])->assertOk();

        $this->assertSame(['request.started'], $seen);
    }

    /** @test */
    public function if_the_required_pre_egress_audit_cannot_be_written_the_provider_is_never_called(): void
    {
        $auth = $this->aiTenant();
        $this->billableMock();
        [$tokens, $cost] = $this->reservationFor();
        $this->setCaps(null, $tokens * 5, $cost * 5);
        $this->setCaps($auth['tenant_id'], $tokens * 5, $cost * 5);
        $calls = 0;
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(function () use (&$calls) {
            $calls++;

            return [];
        }));
        $this->app->instance(AiAuditRecorder::class, new class(app(TenantContext::class)) extends AiAuditRecorder {
            public function record(string $requestId, string $tenantId, ?string $actorId, string $event, string $outcome, string $reason, array $extra = [], bool $required = false): bool
            {
                if ($required) {
                    throw new RuntimeException('audit store down');
                }

                return parent::record($requestId, $tenantId, $actorId, $event, $outcome, $reason, $extra, $required);
            }
        });

        $res = $this->aiAsk($auth['token'])->assertStatus(500);

        $this->assertSame('internal_error', $res->json('error.code'));
        $this->assertSame(0, $calls, 'no durable audit ⇒ no egress');
        $row = AiRequest::withoutGlobalScopes()->first();
        $this->assertSame(['failed', 'audit_unavailable'], [$row->status, $row->error_code]);
        // الحجز حُرّر بلا احتساب: لا استدعاء حدث.
        $this->assertSame([0, 0], [$this->budgetRow(null)->reserved_tokens, $this->budgetRow(null)->used_tokens]);
    }

    /** @test */
    public function failures_after_the_call_are_audited_with_usage(): void
    {
        $auth = $this->aiTenant();
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(null, new RuntimeException(self::AI_SECRET)));

        $res = $this->aiAsk($auth['token'])->assertStatus(500);

        $events = $this->auditEvents($res->json('request_id'));
        $failed = $events->firstWhere('event', 'request.failed');
        $this->assertSame(['error', 'provider_error'], [$failed->outcome, $failed->reason]);
        $this->assertCount(1, $events->where('event', 'request.failed'));
        $this->assertStringNotContainsString(self::AI_SECRET, json_encode(DB::table('ai_audit_events')->get()));
    }

    // ───────────────────────── الإخفاء (redaction) ─────────────────────────

    /** @test */
    public function the_recorder_drops_unknown_metadata_and_rejects_free_text_codes(): void
    {
        $auth = $this->aiTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $requestId = (string) Str::uuid();

        $this->recorder()->record($requestId, $auth['tenant_id'], null, 'tool.invoked', 'allowed', 'ok', [
            'tool' => 'finance.income_statement',
            'meta' => [
                'row_count' => 3,
                'prompt' => 'PROMPT-CANARY leaked',
                'reply' => 'reply text',
                'api_key' => self::AI_SECRET,
                'partner_detail' => 'withheld',
                'branch_mode' => 'free text with spaces',   // نصّ حرّ في مفتاح نصّي → يسقط
                'net_income' => 123456,
            ],
        ], required: true);

        $event = AiAuditEvent::withoutGlobalScopes()->where('request_id', $requestId)->firstOrFail();
        $this->assertSame(['row_count' => 3, 'partner_detail' => 'withheld'], $event->meta);

        // رموز حرّة (جمل) مرفوضة — لا يدخل نصّ مستخدم/مزوّد عبر event/reason/tool.
        foreach ([
            ['request.started', 'allowed', 'The user asked about invoice 42'],
            ['Request Started', 'allowed', 'ok'],
            ['request.started', 'maybe', 'ok'],
        ] as [$e, $o, $r]) {
            $this->assertFalse($this->recorder()->record($requestId, $auth['tenant_id'], null, $e, $o, $r), "{$e}/{$o}/{$r}");
        }
        $this->assertFalse($this->recorder()->record($requestId, $auth['tenant_id'], null, 'tool.invoked', 'allowed', 'ok', ['tool' => 'drop table; --']));
        $this->assertSame(1, AiAuditEvent::withoutGlobalScopes()->where('request_id', $requestId)->count());
    }

    /** @test */
    public function the_recorder_refuses_to_write_for_a_tenant_other_than_the_current_one(): void
    {
        $a = $this->aiTenant('ai-a');
        $b = $this->aiTenant('ai-b');
        app(TenantContext::class)->set($a['tenant_id']);

        $this->assertFalse($this->recorder()->record((string) Str::uuid(), $b['tenant_id'], null, 'request.denied', 'denied', 'x'));
        $this->expectException(LogicException::class);
        $this->recorder()->record((string) Str::uuid(), $b['tenant_id'], null, 'request.denied', 'denied', 'x', required: true);
    }

    /** @test */
    public function audit_events_are_append_only_through_the_model(): void
    {
        $auth = $this->aiTenant();
        $this->aiAsk($auth['token'])->assertOk();
        $event = AiAuditEvent::withoutGlobalScopes()->firstOrFail();

        try {
            $event->update(['reason' => 'tampered']);
            $this->fail('update must be refused');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }
        try {
            $event->delete();
            $this->fail('delete must be refused');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }
        $this->assertNotSame('tampered', $event->fresh()->reason);
    }

    // ───────────────────────── التفويض لقراءة السجل ─────────────────────────

    /** @test */
    public function the_audit_permission_is_separate_and_not_granted_to_default_non_admin_roles(): void
    {
        $this->assertContains('ai.audit.view', Rbac::PERMISSIONS);
        $this->assertSame(['*'], Rbac::MATRIX['owner']);
        foreach (['accountant', 'staff', 'self_service'] as $role) {
            $this->assertNotContains('ai.audit.view', Rbac::MATRIX[$role], $role);
        }
        // استعمال المساعد لا يمنح قراءة تدقيقه.
        $this->assertContains('ai.assistant.use', Rbac::MATRIX['accountant']);
    }

    /** @test */
    public function reading_the_audit_requires_its_own_permission(): void
    {
        $auth = $this->aiTenant();
        $this->aiAsk($auth['token'])->assertOk();

        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@ai.test');
        $this->aiAsk($accountant)->assertOk();                                   // يستعمل المساعد…
        $this->withToken($accountant)->getJson(self::URL)->assertForbidden();    // …ولا يقرأ سجله
        $this->withToken($this->tokenForRole($auth['tenant_id'], 'staff', 'staff@ai.test'))->getJson(self::URL)->assertForbidden();
        $this->flushHeaders()->getJson(self::URL)->assertUnauthorized();

        $this->withToken($auth['token'])->getJson(self::URL)->assertOk();
        $this->withToken($this->auditReaderToken($auth))->getJson(self::URL)->assertOk();
    }

    /** @test */
    public function permission_revoked_between_reads_is_effective_immediately(): void
    {
        $auth = $this->aiTenant();
        $token = $this->auditReaderToken($auth);

        $this->withToken($token)->getJson(self::URL)->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        Role::where('slug', 'ai_auditor')->update(['permissions' => []]);
        $this->withToken($token)->getJson(self::URL)->assertForbidden();
    }

    /** @test */
    public function a_tenant_only_ever_reads_its_own_events_even_with_a_foreign_request_id(): void
    {
        $a = $this->aiTenant('ai-a');
        $b = $this->aiTenant('ai-b');
        $aRequest = $this->aiAsk($a['token'])->assertOk()->json('data.request_id');
        $bRequest = $this->aiAsk($b['token'])->assertOk()->json('data.request_id');

        $own = $this->withToken($a['token'])->getJson(self::URL)->assertOk();
        $this->assertEqualsCanonicalizing([$aRequest], array_unique(array_column($own->json('data'), 'request_id')));

        // معرّف طلب مستأجر آخر لا يُرجع شيئاً (ولا يكشف وجوده).
        $foreign = $this->withToken($a['token'])->getJson(self::URL . '?request_id=' . $bRequest)->assertOk();
        $this->assertSame([], $foreign->json('data'));
        $this->assertSame(0, $foreign->json('meta.total'));
    }

    /** @test */
    public function the_read_surface_is_a_whitelist_validated_and_paginated(): void
    {
        $auth = $this->aiTenant();
        $this->aiAsk($auth['token'])->assertOk();
        $this->aiAsk($auth['token'], ['scope' => ['branch_ids' => [(string) Str::uuid()]]])->assertForbidden();

        $res = $this->withToken($auth['token'])->getJson(self::URL . '?per_page=1')->assertOk();
        $this->assertCount(1, $res->json('data'));
        $this->assertGreaterThanOrEqual(3, $res->json('meta.total'));
        $row = $res->json('data.0');
        $this->assertEqualsCanonicalizing(
            ['id', 'request_id', 'actor_id', 'feature', 'event', 'tool', 'provider', 'model', 'outcome', 'reason', 'attempt', 'input_tokens', 'output_tokens', 'cost_micro_usd', 'meta', 'occurred_at'],
            array_keys($row),
        );
        $this->assertArrayNotHasKey('tenant_id', $row);

        $denied = $this->withToken($auth['token'])->getJson(self::URL . '?outcome=denied')->assertOk();
        $this->assertSame(['denied'], array_values(array_unique(array_column($denied->json('data'), 'outcome'))));
        $this->assertSame(['branch_scope_forbidden'], array_values(array_unique(array_column($denied->json('data'), 'reason'))));

        foreach (['per_page=0', 'per_page=101', 'outcome=maybe', 'request_id=not-a-uuid', 'event=' . urlencode('x y'), 'from=junk'] as $bad) {
            $this->withToken($auth['token'])->getJson(self::URL . '?' . $bad)->assertStatus(422);
        }
    }

    // ───────────────────────── الاحتفاظ ─────────────────────────

    /** @test */
    public function the_retention_command_prunes_old_records_and_keeps_recent_and_in_flight_ones(): void
    {
        $auth = $this->aiTenant();
        $old = $this->aiAsk($auth['token'])->assertOk()->json('data.request_id');
        $recent = $this->aiAsk($auth['token'])->assertOk()->json('data.request_id');
        $inFlight = $this->aiAsk($auth['token'])->assertOk()->json('data.request_id');

        $ancient = now()->subDays(500);
        DB::table('ai_audit_events')->where('request_id', $old)->update(['occurred_at' => $ancient]);
        DB::table('ai_requests')->where('id', $old)->update(['created_at' => $ancient]);
        DB::table('ai_requests')->where('id', $inFlight)->update(['created_at' => $ancient, 'status' => 'reserved']);

        $this->assertSame(0, Artisan::call('ai:prune-records'));

        $this->assertSame(0, DB::table('ai_audit_events')->where('request_id', $old)->count());
        $this->assertNull(DB::table('ai_requests')->where('id', $old)->first());
        $this->assertGreaterThan(0, DB::table('ai_audit_events')->where('request_id', $recent)->count());
        $this->assertNotNull(DB::table('ai_requests')->where('id', $recent)->first());
        $this->assertNotNull(DB::table('ai_requests')->where('id', $inFlight)->first(), 'a reserved request is never pruned');
    }

    /** @test */
    public function retention_cannot_be_configured_below_the_thirty_day_floor(): void
    {
        $auth = $this->aiTenant();
        $this->aiAsk($auth['token'])->assertOk();
        DB::table('ai_audit_events')->update(['occurred_at' => now()->subDays(10)]);
        config(['ai_assistant.audit.retention_days' => 1]);

        Artisan::call('ai:prune-records');

        $this->assertGreaterThan(0, DB::table('ai_audit_events')->count(), '10-day-old events survive a 1-day setting');

        DB::table('ai_audit_events')->update(['occurred_at' => now()->subDays(31)]);
        Artisan::call('ai:prune-records');
        $this->assertSame(0, DB::table('ai_audit_events')->count());
    }

    /** @test */
    public function the_retention_command_is_scheduled(): void
    {
        $commands = collect(app(\Illuminate\Console\Scheduling\Schedule::class)->events())->pluck('command')->implode("\n");

        $this->assertStringContainsString('ai:prune-records', $commands);
    }
}
