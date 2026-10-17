<?php

namespace Tests\Feature;

use App\Models\AiAuditEvent;
use App\Models\AiBudget;
use App\Models\AiRequest;
use App\Models\Role;
use App\Models\Tenant;
use App\Services\AiAuditRecorder;
use App\Services\MockAiAssistantProvider;
use App\Support\AiAssistantDataCategory;
use App\Support\Rbac;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * AWJ Intelligence — AI-03: واجهات الخادم الصغيرة التي تحتاجها الواجهة (حالة، موافقة المؤسسة، تشغيل أداة صريح).
 *
 * تشغيل: php artisan test --filter=AiAssistantUiApiTest
 */
class AiAssistantUiApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiAssistant;

    private const STATUS = '/api/ai-assistant/status';
    private const SETTINGS = '/api/ai-assistant/settings';
    private const RUN = '/api/ai-assistant/tools/run';
    private const TODAY = '2026-10-20';

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

    // ───────────────────────── helpers ─────────────────────────

    /** مستأجر جديد بلا أي موافقة (الافتراضي)، والمنصة مفعّلة أو لا. */
    private function freshTenant(string $slug = 'ui-a', bool $platform = true): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        config(['ai_assistant.enabled' => $platform]);

        return $auth;
    }

    private function settings(string $tenantId): array
    {
        $context = app(TenantContext::class);
        $previous = $context->id();
        $context->set($tenantId);
        $value = Settings::group('ai_assistant', Tenant::query()->findOrFail($tenantId));
        $previous === null ? $context->forget() : $context->set($previous);

        return $value;
    }

    private function customRole(string $tenantId, string $slug, array $permissions, string $email): string
    {
        $context = app(TenantContext::class);
        $context->set($tenantId);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($tenantId, $slug, $email);
    }

    private function putSettings(string $token, array $payload)
    {
        return $this->withToken($token)->putJson(self::SETTINGS, $payload);
    }

    private function grant(string $token, array $categories, bool $enabled = true)
    {
        return $this->putSettings($token, ['enabled' => $enabled, 'consented_categories' => $categories, 'acknowledge_privacy' => true]);
    }

    private function runTool(string $token, string $tool, array $arguments, array $extra = [])
    {
        return $this->withToken($token)->postJson(self::RUN, array_merge(['tool' => $tool, 'arguments' => $arguments], $extra));
    }

    private const INCOME = ['finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20']];

    // ───────────────────────── status ─────────────────────────

    /** @test */
    public function status_reports_the_default_off_state_without_exposing_platform_internals(): void
    {
        $auth = $this->freshTenant();

        $res = $this->withToken($auth['token'])->getJson(self::STATUS)->assertOk();

        $this->assertTrue($res->json('data.platform_enabled'));
        $this->assertSame(['enabled' => false, 'consented_categories' => []], $res->json('data.tenant'));
        $this->assertSame('tenant_disabled', $res->json('data.chat'));
        $this->assertSame('tenant_disabled', $res->json('data.financial'));
        $this->assertSame('mock', $res->json('data.provider_mode'));
        $this->assertSame(['timezone' => 'Asia/Riyadh', 'today' => '2026-10-20'], $res->json('data.clock'));
        $this->assertEquals(
            ['assistant_messages' => [true, false], 'financial_summary' => [true, false], 'document_projected_text' => [false, false]],
            collect($res->json('data.categories'))->mapWithKeys(fn ($c) => [$c['key'] => [$c['available'], $c['consented']]])->all(),
        );
        // لا مفاتيح ولا أسعار ولا ميزانيات ولا اسم مزوّد حقيقي ولا إعدادات مركز المستندات.
        $dump = strtolower($res->getContent());
        foreach (['api_key', 'secret', 'pricing', 'budget', 'micro_usd', 'anthropic', 'openai', 'gemini', 'allow_document_sending'] as $needle) {
            $this->assertStringNotContainsString($needle, $dump, $needle);
        }
    }

    /** @test */
    public function status_distinguishes_every_state_the_ui_must_render(): void
    {
        $auth = $this->freshTenant();
        $tid = $auth['tenant_id'];
        $token = $auth['token'];
        $state = fn () => $this->withToken($token)->getJson(self::STATUS)->json('data');

        // المنصة معطّلة
        config(['ai_assistant.enabled' => false]);
        $this->assertSame(['platform_disabled', 'platform_disabled'], [$state()['chat'], $state()['financial']]);
        config(['ai_assistant.enabled' => true]);

        // المؤسسة معطّلة ← موافقة مطلوبة ← جاهز
        $this->assertSame('tenant_disabled', $state()['chat']);
        $this->grant($token, [])->assertOk();
        $this->assertSame(['consent_required', 'consent_required'], [$state()['chat'], $state()['financial']]);
        $this->grant($token, [AiAssistantDataCategory::ASSISTANT_MESSAGES])->assertOk();
        $this->assertSame(['ready', 'consent_required'], [$state()['chat'], $state()['financial']]);
        $this->grant($token, [AiAssistantDataCategory::ASSISTANT_MESSAGES, AiAssistantDataCategory::FINANCIAL_SUMMARY])->assertOk();
        $this->assertSame(['ready', 'ready'], [$state()['chat'], $state()['financial']]);

        // مزوّد غير متاح يخص المحادثة وحدها
        config(['ai_assistant.provider' => 'anthropic']);
        $this->assertSame(['provider_unavailable', 'ready', 'unavailable'], [$state()['chat'], $state()['financial'], $state()['provider_mode']]);
        config(['ai_assistant.provider' => 'mock']);

        // عملة غير SAR تخص المالية وحدها
        Tenant::whereKey($tid)->update(['currency' => 'USD']);
        $this->assertSame(['ready', 'currency_unsupported'], [$state()['chat'], $state()['financial']]);
    }

    /** @test */
    public function status_reflects_the_actors_permissions_not_just_the_tenant(): void
    {
        $auth = $this->freshTenant();
        $tid = $auth['tenant_id'];
        $this->grant($auth['token'], [AiAssistantDataCategory::ASSISTANT_MESSAGES, AiAssistantDataCategory::FINANCIAL_SUMMARY])->assertOk();

        $accountant = $this->withToken($this->tokenForRole($tid, 'accountant', 'acc@ui.test'))->getJson(self::STATUS)->assertOk();
        $this->assertSame(['use' => true, 'manage_consent' => false, 'view_audit' => false, 'partner_detail' => true, 'document_read' => false], $accountant->json('data.abilities'));
        $this->assertSame(['ready', 'ready'], [$accountant->json('data.chat'), $accountant->json('data.financial')]);

        // يستعمل المساعد لكنه بلا reports.view: المحادثة جاهزة والمالية مرفوضة
        $noReports = $this->customRole($tid, 'ai_only', ['ai.assistant.use'], 'aionly@ui.test');
        $res = $this->withToken($noReports)->getJson(self::STATUS)->assertOk();
        $this->assertSame(['ready', 'permission_denied'], [$res->json('data.chat'), $res->json('data.financial')]);

        // مدير موافقة بلا استعمال: يرى الحالة ويدير الموافقة لكن لا يستعمل
        $manager = $this->customRole($tid, 'ai_manager', ['ai.consent.manage'], 'mgr@ui.test');
        $res = $this->withToken($manager)->getJson(self::STATUS)->assertOk();
        $this->assertSame(['permission_denied', 'permission_denied'], [$res->json('data.chat'), $res->json('data.financial')]);
        $this->assertTrue($res->json('data.abilities.manage_consent'));
    }

    /** @test */
    public function status_is_refused_to_users_with_no_assistant_permission_and_unauthenticated_callers(): void
    {
        $auth = $this->freshTenant();

        $this->withToken($this->tokenForRole($auth['tenant_id'], 'staff', 'staff@ui.test'))->getJson(self::STATUS)->assertForbidden();
        $this->flushHeaders()->getJson(self::STATUS)->assertUnauthorized();
    }

    /** @test */
    public function status_never_shows_another_tenants_consent(): void
    {
        $a = $this->freshTenant('ui-a');
        $b = $this->freshTenant('ui-b');
        $this->grant($a['token'], [AiAssistantDataCategory::ASSISTANT_MESSAGES, AiAssistantDataCategory::FINANCIAL_SUMMARY])->assertOk();

        $res = $this->withToken($b['token'])->getJson(self::STATUS)->assertOk();

        $this->assertSame(['enabled' => false, 'consented_categories' => []], $res->json('data.tenant'));
        $this->assertSame('tenant_disabled', $res->json('data.chat'));
    }

    // ───────────────────────── consent writes: authorization ─────────────────────────

    /** @test */
    public function only_owner_admin_or_an_explicit_role_can_change_consent(): void
    {
        $auth = $this->freshTenant();
        $tid = $auth['tenant_id'];
        $payload = ['enabled' => true, 'consented_categories' => ['assistant_messages'], 'acknowledge_privacy' => true];

        foreach (['accountant', 'staff', 'self_service'] as $role) {
            $this->putSettings($this->tokenForRole($tid, $role, "{$role}@ui.test"), $payload)->assertForbidden();
        }
        // مستعمل المساعد بلا إدارة الموافقة: مرفوض أيضاً (الاستعمال لا يمنح الإدارة).
        $this->putSettings($this->customRole($tid, 'ai_user', ['ai.assistant.use', 'ai.audit.view'], 'user@ui.test'), $payload)->assertForbidden();
        $this->flushHeaders()->putJson(self::SETTINGS, $payload)->assertUnauthorized();
        $this->assertSame(['enabled' => false, 'consented_categories' => []], $this->settings($tid), 'nothing was written by refused callers');

        // المالك ومن يحمل الصلاحية صراحةً
        $this->putSettings($auth['token'], $payload)->assertOk();
        $this->putSettings($this->customRole($tid, 'ai_manager', ['ai.consent.manage'], 'mgr@ui.test'), array_merge($payload, ['consented_categories' => []]))->assertOk();
    }

    /** @test */
    public function the_consent_permission_is_registered_and_held_by_owner_and_admin_only(): void
    {
        $this->assertContains('ai.consent.manage', Rbac::PERMISSIONS);
        $this->assertSame(['*'], Rbac::MATRIX['owner']);
        $this->assertSame(['*'], Rbac::MATRIX['admin']);
        foreach (['accountant', 'staff', 'self_service'] as $role) {
            $this->assertNotContains('ai.consent.manage', Rbac::MATRIX[$role], $role);
            $this->assertFalse(Rbac::allows($role, 'ai.consent.manage'), $role);
        }
        // الاستعمال لا يمنح إدارة الموافقة ولا قراءة التدقيق للمحاسب.
        $this->assertTrue(Rbac::allows('accountant', 'ai.assistant.use'));
        $this->assertFalse(Rbac::allows('accountant', 'ai.audit.view'));
    }

    // ───────────────────────── consent writes: validation and rules ─────────────────────────

    /** @test */
    public function categories_are_validated_unknown_and_document_categories_are_blocked(): void
    {
        $auth = $this->freshTenant();
        $token = $auth['token'];

        foreach ([
            [['secrets'], 'consented_categories.0'],
            [['assistant_messages', 'assistant_messages'], 'consented_categories.0'],
            [[AiAssistantDataCategory::DOCUMENT_PROJECTED_TEXT], 'consented_categories.0'],
            [['assistant_messages', AiAssistantDataCategory::DOCUMENT_PROJECTED_TEXT], 'consented_categories.1'],
        ] as [$categories, $field]) {
            $res = $this->grant($token, $categories)->assertStatus(422);
            $this->assertSame('invalid_request', $res->json('error.code'));
            $this->assertArrayHasKey($field, $res->json('error.fields'));
        }
        $this->assertSame(['enabled' => false, 'consented_categories' => []], $this->settings($auth['tenant_id']));

        // أخطاء الشكل: الحقول الناقصة والمجهولة (لا tenant_id ولا مفاتيح منصة ولا أسعار).
        $this->putSettings($token, ['consented_categories' => []])->assertStatus(422);
        $this->putSettings($token, ['enabled' => true])->assertStatus(422);
        foreach (['tenant_id' => 'x', 'platform_enabled' => true, 'budget' => 1, 'provider' => 'openai', 'api_key' => 'k'] as $field => $value) {
            $res = $this->putSettings($token, ['enabled' => false, 'consented_categories' => [], $field => $value])->assertStatus(422);
            $this->assertSame(['unsupported_field'], $res->json("error.fields.{$field}"));
        }
    }

    /** @test */
    public function granting_requires_an_explicit_acknowledgement_but_revoking_never_does(): void
    {
        $auth = $this->freshTenant();
        $token = $auth['token'];

        $res = $this->putSettings($token, ['enabled' => true, 'consented_categories' => ['assistant_messages']])->assertStatus(422);
        $this->assertSame('acknowledgement_required', $res->json('error.code'));
        $this->putSettings($token, ['enabled' => true, 'consented_categories' => ['assistant_messages'], 'acknowledge_privacy' => false])->assertStatus(422);
        $this->assertSame(['enabled' => false, 'consented_categories' => []], $this->settings($auth['tenant_id']));

        $this->grant($token, ['assistant_messages', 'financial_summary'])->assertOk();
        // إضافة فئة تحتاج إقراراً، وسحب فئة لا يحتاج
        $this->putSettings($token, ['enabled' => true, 'consented_categories' => ['assistant_messages', 'financial_summary']])->assertOk(); // لا تغيير
        $this->putSettings($token, ['enabled' => true, 'consented_categories' => ['assistant_messages']])->assertOk();
        $this->assertSame(['assistant_messages'], $this->settings($auth['tenant_id'])['consented_categories']);
        $this->putSettings($token, ['enabled' => true, 'consented_categories' => ['assistant_messages', 'financial_summary']])->assertStatus(422);
        $this->putSettings($token, ['enabled' => false, 'consented_categories' => []])->assertOk();
    }

    /** @test */
    public function disabling_the_assistant_revokes_every_category(): void
    {
        $auth = $this->freshTenant();
        $this->grant($auth['token'], ['assistant_messages', 'financial_summary'])->assertOk();

        // حتى لو أُرسلت فئات مع enabled=false تُمسح كلها
        $res = $this->putSettings($auth['token'], ['enabled' => false, 'consented_categories' => ['assistant_messages', 'financial_summary']])->assertOk();

        $this->assertSame(['enabled' => false, 'consented_categories' => []], $this->settings($auth['tenant_id']));
        $this->assertSame('tenant_disabled', $res->json('data.chat'));
        // إعادة التفعيل لا تُعيد الموافقات القديمة
        $this->grant($auth['token'], [])->assertOk();
        $this->assertSame([], $this->settings($auth['tenant_id'])['consented_categories']);
    }

    /** @test */
    public function granting_is_refused_while_the_platform_is_off_but_revoking_always_works(): void
    {
        $auth = $this->freshTenant(platform: true);
        $this->grant($auth['token'], ['assistant_messages'])->assertOk();

        config(['ai_assistant.enabled' => false]);
        $res = $this->grant($auth['token'], ['assistant_messages', 'financial_summary'])->assertStatus(503);
        $this->assertSame('platform_disabled', $res->json('error.code'));
        $this->assertSame(['assistant_messages'], $this->settings($auth['tenant_id'])['consented_categories']);

        $this->putSettings($auth['token'], ['enabled' => false, 'consented_categories' => []])->assertOk();
        $this->assertFalse($this->settings($auth['tenant_id'])['enabled']);
    }

    /** @test */
    public function consent_is_isolated_per_tenant_and_a_write_never_touches_another_company(): void
    {
        $a = $this->freshTenant('ui-a');
        $b = $this->freshTenant('ui-b');
        $this->grant($b['token'], ['assistant_messages'])->assertOk();

        $this->grant($a['token'], ['assistant_messages', 'financial_summary'])->assertOk();
        $this->putSettings($a['token'], ['enabled' => false, 'consented_categories' => []])->assertOk();

        $this->assertSame(['enabled' => true, 'consented_categories' => ['assistant_messages']], $this->settings($b['tenant_id']));
        // الجسم لا يقبل tenant_id أصلاً: لا مسار لكتابة مؤسسة أخرى.
        $this->putSettings($a['token'], ['enabled' => true, 'consented_categories' => [], 'tenant_id' => $b['tenant_id']])->assertStatus(422);
    }

    /** @test */
    public function the_write_is_atomic_and_fails_closed_when_the_durable_audit_cannot_be_written(): void
    {
        $auth = $this->freshTenant();
        $this->app->instance(AiAuditRecorder::class, new class(app(TenantContext::class)) extends AiAuditRecorder {
            public function record(string $requestId, string $tenantId, ?string $actorId, string $event, string $outcome, string $reason, array $extra = [], bool $required = false): bool
            {
                if ($required) {
                    throw new RuntimeException('audit store down');
                }

                return parent::record($requestId, $tenantId, $actorId, $event, $outcome, $reason, $extra, $required);
            }
        });

        $this->withoutExceptionHandling();
        try {
            $this->grant($auth['token'], ['assistant_messages']);
            $this->fail('the write must not succeed without its audit trail');
        } catch (RuntimeException $e) {
            $this->assertSame('audit store down', $e->getMessage());
        }

        $this->assertSame(['enabled' => false, 'consented_categories' => []], $this->settings($auth['tenant_id']), 'no audit ⇒ no consent');
    }

    /** @test */
    public function every_change_is_audited_with_metadata_only(): void
    {
        $auth = $this->freshTenant();
        $this->grant($auth['token'], ['assistant_messages', 'financial_summary'])->assertOk();
        $this->putSettings($auth['token'], ['enabled' => true, 'consented_categories' => ['assistant_messages']])->assertOk();
        $this->putSettings($auth['token'], ['enabled' => true, 'consented_categories' => ['assistant_messages']])->assertOk(); // لا تغيير ⇒ لا حدث

        $events = $this->auditEvents()->where('event', 'consent.updated')->values();
        $this->assertCount(2, $events);
        $this->assertEquals(['consent_enabled' => true, 'categories_granted' => ['assistant_messages', 'financial_summary']], $events[0]->meta);
        $this->assertEquals(['consent_enabled' => true, 'categories_revoked' => ['financial_summary']], $events[1]->meta);
        foreach ($events as $event) {
            $this->assertSame($auth['tenant_id'], $event->tenant_id);
            $this->assertNotNull($event->actor_id);
            $this->assertSame(['allowed', 'ok'], [$event->outcome, $event->reason]);
        }
        $this->assertStringNotContainsString('PROMPT', json_encode(DB::table('ai_audit_events')->get()));
    }

    /** @test */
    public function the_recorder_still_drops_unknown_categories_and_free_text_from_consent_metadata(): void
    {
        $auth = $this->freshTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $request = (string) Str::uuid();

        app(AiAuditRecorder::class)->record($request, $auth['tenant_id'], null, 'consent.updated', 'allowed', 'ok', ['meta' => [
            'categories_granted' => ['assistant_messages', 'my secret note', 'drop table'],
            'categories_revoked' => 'not-a-list',
            'consent_enabled' => 1,
        ]], required: true);

        $event = AiAuditEvent::withoutGlobalScopes()->where('request_id', $request)->firstOrFail();
        $this->assertEquals(['consent_enabled' => true, 'categories_granted' => ['assistant_messages']], $event->meta);
    }

    /** @test */
    public function document_center_consent_neither_grants_nor_revokes_assistant_consent(): void
    {
        $auth = $this->freshTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('document_intelligence', ['processing_enabled' => true, 'allowed_document_types' => ['purchase_invoice']]);
        app(TenantContext::class)->forget();

        $this->assertSame('tenant_disabled', $this->withToken($auth['token'])->getJson(self::STATUS)->json('data.chat'));
        $this->grant($auth['token'], ['assistant_messages'])->assertOk();
        $this->assertTrue(Settings::group('document_intelligence', Tenant::find($auth['tenant_id']))['processing_enabled']);
    }

    // ───────────────────────── takes effect on the next request / tool invocation ─────────────────────────

    /** @test */
    public function consent_changes_take_effect_on_the_very_next_message_and_tool_run(): void
    {
        $auth = $this->freshTenant();
        $token = $auth['token'];

        $this->aiAsk($token)->assertForbidden()->assertJsonPath('error.code', 'tenant_not_enabled');

        $this->grant($token, ['assistant_messages'])->assertOk();
        $this->aiAsk($token)->assertOk();
        $this->runTool($token, ...self::INCOME)->assertForbidden()->assertJsonPath('error.code', 'consent_required');

        $this->grant($token, ['assistant_messages', 'financial_summary'])->assertOk();
        $this->runTool($token, ...self::INCOME)->assertOk();

        $this->putSettings($token, ['enabled' => true, 'consented_categories' => ['assistant_messages']])->assertOk();
        $this->runTool($token, ...self::INCOME)->assertForbidden()->assertJsonPath('error.code', 'consent_required');
        $this->aiAsk($token)->assertOk();

        $this->putSettings($token, ['enabled' => false, 'consented_categories' => []])->assertOk();
        $this->aiAsk($token)->assertForbidden()->assertJsonPath('error.code', 'tenant_not_enabled');
        $this->runTool($token, ...self::INCOME)->assertForbidden()->assertJsonPath('error.code', 'tenant_not_enabled');
    }

    // ───────────────────────── tools/run ─────────────────────────

    /** @test */
    public function an_explicit_tool_run_returns_exactly_what_the_assistants_own_tool_path_returns(): void
    {
        $auth = $this->freshTenant();
        $this->grant($auth['token'], ['assistant_messages', 'financial_summary'])->assertOk();

        $viaMessage = $this->aiAsk($auth['token'], ['message' => 'income statement'])->assertOk()->json('data.tool_calls.0.result');
        $viaRun = $this->runTool($auth['token'], ...self::INCOME)->assertOk();

        $result = $viaRun->json('data.tool_calls.0.result');
        $this->assertSame('finance.income_statement', $viaRun->json('data.tool_calls.0.tool'));
        $this->assertSame($viaMessage, $result);
        $this->assertTrue(Str::isUuid($viaRun->json('data.request_id')));
        $this->assertSame($viaRun->json('data.request_id'), $viaRun->headers->get('X-AI-Request-Id'));
        $this->assertSame('SAR', $result['currency']);
        $this->assertSame('not_applicable', $result['scope']['warehouse']['mode']);
        // لا غلاف نطاق تفويض هنا يُلتبس بمرشّح: المرجع الوحيد نتيجة الأداة.
        $this->assertArrayNotHasKey('scope', $viaRun->json('data'));
    }

    /** @test */
    public function a_tool_run_never_calls_a_provider_nor_creates_a_request_or_budget_record(): void
    {
        $auth = $this->freshTenant();
        $this->grant($auth['token'], ['assistant_messages', 'financial_summary'])->assertOk();
        $calls = 0;
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(function () use (&$calls) {
            $calls++;

            return [];
        }));
        config(['ai_assistant.pricing.mock.mock-1' => ['billable' => true, 'input_micro_usd_per_1k' => 1, 'output_micro_usd_per_1k' => 1]]);

        $this->runTool($auth['token'], 'finance.receivables_aging', ['as_of' => self::TODAY])->assertOk();

        $this->assertSame(0, $calls);
        $this->assertSame(0, AiRequest::withoutGlobalScopes()->count());
        $this->assertSame(0, AiBudget::count(), 'no budget is touched or required: nothing is spent');
        $event = $this->auditEvents()->firstWhere('event', 'tool.invoked');
        $this->assertSame(['finance.receivables_aging', 'allowed', 'ok'], [$event->tool, $event->outcome, $event->reason]);
    }

    /** @test */
    public function a_tool_run_preserves_every_ai_02_gate(): void
    {
        $auth = $this->freshTenant();
        $tid = $auth['tenant_id'];
        $this->grant($auth['token'], ['assistant_messages', 'financial_summary'])->assertOk();

        // الصلاحية: reports.view مطلوبة فوق ai.assistant.use
        $aiOnly = $this->customRole($tid, 'ai_only', ['ai.assistant.use'], 'aionly@ui.test');
        $this->runTool($aiOnly, ...self::INCOME)->assertForbidden()->assertJsonPath('error.code', 'tool_permission_denied');
        // بلا ai.assistant.use: مرفوض على مستوى المسار
        $reportsOnly = $this->customRole($tid, 'reports_only', ['reports.view'], 'repo@ui.test');
        $this->runTool($reportsOnly, ...self::INCOME)->assertForbidden();
        $this->runTool($this->tokenForRole($tid, 'staff', 'staff@ui.test'), ...self::INCOME)->assertForbidden();
        $this->flushHeaders()->postJson(self::RUN, ['tool' => self::INCOME[0], 'arguments' => self::INCOME[1]])->assertUnauthorized();

        // المنصة
        config(['ai_assistant.enabled' => false]);
        $this->runTool($auth['token'], ...self::INCOME)->assertStatus(503)->assertJsonPath('error.code', 'platform_disabled');
        config(['ai_assistant.enabled' => true]);

        // عملة غير SAR
        Tenant::whereKey($tid)->update(['currency' => 'USD']);
        $this->runTool($auth['token'], ...self::INCOME)->assertStatus(422)->assertJsonPath('error.code', 'currency_unsupported');
        Tenant::whereKey($tid)->update(['currency' => 'SAR']);

        // سحب الصلاحية بين طلبين
        $accountant = $this->tokenForRole($tid, 'accountant', 'acc@ui.test');
        $this->runTool($accountant, ...self::INCOME)->assertOk();
        Role::where('slug', 'accountant')->update(['permissions' => array_values(array_diff(Rbac::MATRIX['accountant'], ['reports.view']))]);
        $this->runTool($accountant, ...self::INCOME)->assertForbidden()->assertJsonPath('error.code', 'tool_permission_denied');
    }

    /** @test */
    public function a_tool_run_validates_the_tool_arguments_and_the_scope(): void
    {
        $a = $this->freshTenant('ui-a');
        $b = $this->freshTenant('ui-b');
        $this->grant($a['token'], ['assistant_messages', 'financial_summary'])->assertOk();
        $t = $a['token'];
        $bBranch = $this->withToken($b['token'])->getJson('/api/branches')['data'][0]['id'];
        $bWarehouse = $this->withToken($b['token'])->getJson('/api/warehouses')['data'][0]['id'];
        $aWarehouse = $this->withToken($t)->getJson('/api/warehouses')['data'][0]['id'];

        // الأداة خارج السجل المغلق، وشكل الطلب
        $this->runTool($t, 'finance.account_ledger', [])->assertStatus(422)->assertJsonPath('error.code', 'invalid_request');
        $this->runTool($t, 'sql', ['query' => 'select 1'])->assertStatus(422);
        $this->withToken($t)->postJson(self::RUN, ['tool' => self::INCOME[0], 'arguments' => self::INCOME[1], 'tenant_id' => $b['tenant_id']])->assertStatus(422);
        $this->withToken($t)->postJson(self::RUN, ['tool' => self::INCOME[0]])->assertStatus(422);

        // معطيات الأداة (مخططها المغلق) ← 422 invalid_tool_arguments
        foreach ([
            ['finance.income_statement', ['from' => '2026-10-21', 'to' => '2026-10-22']],   // مستقبل
            ['finance.income_statement', ['from' => '2026-10-20', 'to' => '2026-10-01']],   // معكوس
            ['finance.income_statement', ['from' => '2026-10-01', 'to' => '2026-10-20', 'x' => '1']],
            ['finance.receivables_aging', ['as_of' => 'today']],
        ] as [$tool, $args]) {
            $this->runTool($t, $tool, $args)->assertStatus(422)->assertJsonPath('error.code', 'invalid_tool_arguments');
        }

        // النطاق: معرّفات مستأجر آخر ← 403، ومخزن مسمّى لأداة بلا بُعد مخزن ← 422
        $this->runTool($t, ...self::INCOME, ...[['scope' => ['branch_ids' => [$bBranch]]]])->assertForbidden()->assertJsonPath('error.code', 'branch_scope_forbidden');
        $this->runTool($t, ...self::INCOME, ...[['scope' => ['warehouse_ids' => [$bWarehouse]]]])->assertForbidden()->assertJsonPath('error.code', 'warehouse_scope_forbidden');
        $this->runTool($t, ...self::INCOME, ...[['scope' => ['warehouse_ids' => [$aWarehouse]]]])->assertStatus(422)->assertJsonPath('error.code', 'scope_not_supported');
    }

    /** @test */
    public function a_tool_run_for_tenant_a_never_returns_tenant_b_data(): void
    {
        $a = $this->freshTenant('ui-a');
        $b = $this->freshTenant('ui-b');
        $this->grant($a['token'], ['assistant_messages', 'financial_summary'])->assertOk();
        $this->grant($b['token'], ['assistant_messages', 'financial_summary'])->assertOk();

        $ra = $this->runTool($a['token'], ...self::INCOME)->assertOk();
        $rb = $this->runTool($b['token'], ...self::INCOME)->assertOk();

        $this->assertNotSame($ra->json('data.request_id'), $rb->json('data.request_id'));
        $events = $this->auditEvents()->where('event', 'tool.invoked');
        $this->assertEqualsCanonicalizing([$a['tenant_id'], $b['tenant_id']], $events->pluck('tenant_id')->all());
    }

    /** @test */
    public function the_new_endpoints_are_still_closed_to_a_non_mock_provider_and_open_no_network_connection(): void
    {
        $auth = $this->freshTenant();
        $this->grant($auth['token'], ['assistant_messages', 'financial_summary'])->assertOk();
        config(['ai_assistant.provider' => 'anthropic']);

        // الأدوات المالية حتمية بلا مزوّد: تعمل، والمحادثة وحدها تفشل مغلقة.
        $this->runTool($auth['token'], ...self::INCOME)->assertOk();
        $this->aiAsk($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'provider_unavailable');
        // (tearDown يؤكد Http::assertNothingSent)
    }
}
