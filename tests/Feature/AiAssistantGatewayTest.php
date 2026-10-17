<?php

namespace Tests\Feature;

use App\Contracts\AiAssistantTool;
use App\Models\PlatformIntegrationSetting;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Services\AiAssistantPolicy;
use App\Services\AiAssistantToolRegistry;
use App\Services\MockAiAssistantProvider;
use App\Support\AiAssistantDataCategory;
use App\Support\AiAssistantDenied;
use App\Support\Rbac;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AWJ Intelligence — AI-01 Secure Gateway.
 *
 * يثبت: مغلقة افتراضياً، موافقة مستقلة، تفويض طازج لكل طلب ولكل أداة، رفض صريح
 * للنطاق الممنوع، سجلّ أدوات مغلق، مزوّد تجريبي حتمي، وصفر اتصال خارجي، وأن لا
 * أسرار ولا نصّ رسائل في الاستجابات أو السجلات.
 *
 * تشغيل: php artisan test --filter=AiAssistantGatewayTest
 */
class AiAssistantGatewayTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const URL = '/api/ai-assistant/messages';
    private const SECRET = 'sk-ant-api03-TOP-SECRET-DO-NOT-LEAK';
    private const PROMPT = 'ما هو رصيد العميل الخاص بشركة المنارة؟ PROMPT-CANARY-7731';

    protected function setUp(): void
    {
        parent::setUp();

        // لا اتصال شبكي مسموح في أي اختبار هنا.
        Http::preventStrayRequests();
        Http::fake();
    }

    protected function tearDown(): void
    {
        Http::assertNothingSent();

        parent::tearDown();
    }

    // ───────────────────────── helpers ─────────────────────────

    /** مستأجر + مالك، مع تفعيل المنصة وموافقة المستأجر افتراضياً. */
    private function readyTenant(string $slug = 'ai-a', bool $platform = true, bool $tenantOptIn = true): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        config(['ai_assistant.enabled' => $platform]);
        if ($tenantOptIn) {
            $this->optIn($auth['tenant_id']);
        }

        return $auth;
    }

    private function optIn(string $tenantId, array $categories = [AiAssistantDataCategory::ASSISTANT_MESSAGES], bool $enabled = true): void
    {
        $context = app(TenantContext::class);
        $previous = $context->id();
        $context->set($tenantId);
        Settings::put('ai_assistant', ['enabled' => $enabled, 'consented_categories' => $categories]);
        $previous === null ? $context->forget() : $context->set($previous);
    }

    private function ask(string $token, array $payload = []): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->postJson(self::URL, array_merge(['message' => self::PROMPT], $payload));
    }

    /** @return array{0:string,1:string} [mainBranchId, otherBranchId] */
    private function twoBranches(string $token): array
    {
        $main = $this->withToken($token)->getJson('/api/branches')['data'][0]['id'];
        $other = $this->withToken($token)->postJson('/api/branches', ['name' => 'فرع الخبر'])->assertCreated()['data']['id'];

        return [$main, $other];
    }

    private function restrictedToken(array $auth, array $payload, string $email = 'br@ai.test'): string
    {
        $this->withToken($auth['token'])->postJson('/api/users', array_merge([
            'name' => 'مقيَّد', 'email' => $email, 'password' => 'password123', 'role' => 'admin',
        ], $payload))->assertCreated();

        return $this->postJson('/api/login', ['email' => $email, 'password' => 'password123'])->assertOk()['token'];
    }

    private function setRolePermissions(string $tenantId, string $slug, array $permissions): void
    {
        $context = app(TenantContext::class);
        $previous = $context->id();
        $context->set($tenantId);
        Role::where('slug', $slug)->firstOrFail()->update(['permissions' => $permissions]);
        $previous === null ? $context->forget() : $context->set($previous);
    }

    /** @return list<string> */
    private function accountantBase(): array
    {
        return array_values(array_diff(Rbac::MATRIX['accountant'], ['ai.assistant.use']));
    }

    // ───────────────────── default OFF / kill switch ─────────────────────

    /** @test */
    public function the_shipped_defaults_are_off_and_mock(): void
    {
        $defaults = require base_path('config/ai_assistant.php');

        $this->assertFalse($defaults['enabled']);
        $this->assertSame('mock', $defaults['provider']);
        $this->assertSame([], Settings::DEFAULTS['ai_assistant']['consented_categories']);
        $this->assertFalse(Settings::DEFAULTS['ai_assistant']['enabled']);
    }

    /** @test */
    public function platform_kill_switch_off_blocks_even_a_fully_opted_in_tenant(): void
    {
        $auth = $this->readyTenant(platform: false);

        $res = $this->ask($auth['token'])->assertStatus(503);

        $res->assertJsonPath('error.code', 'platform_disabled');
        $this->assertTrue(Str::isUuid($res->json('request_id')));
        $this->assertArrayNotHasKey('data', $res->json());
    }

    /**
     * سلوك موثَّق ومقصود: التحقق من شكل الطلب (422) يسبق مفتاح الإيقاف (503).
     * لا مشكلة أمنية: الردّ 422 لا يكشف حالة المنصة ولا يعالج أي بيانات، ولا يصل
     * إلى السياسة أو المزوّد أو التدقيق. الطلب الصالح وحده يبلغ المفتاح فيُرفض بـ503.
     *
     * @test
     */
    public function shape_validation_runs_before_the_kill_switch_and_leaks_nothing(): void
    {
        $auth = $this->readyTenant(platform: false);

        $invalid = $this->withToken($auth['token'])->postJson(self::URL, ['tenant_id' => 'x'])->assertStatus(422);
        $this->assertSame('invalid_request', $invalid->json('error.code'));
        $this->assertStringNotContainsString('platform', strtolower($invalid->getContent()));
        $this->assertStringNotContainsString('disabled', strtolower($invalid->getContent()));

        // نفس الشكل الخاطئ والمنصة مفتوحة يعطي الردّ نفسه — لا فرق يكشف حالة المفتاح.
        config(['ai_assistant.enabled' => true]);
        $open = $this->withToken($auth['token'])->postJson(self::URL, ['tenant_id' => 'x'])->assertStatus(422);
        $this->assertSame($invalid->json('error'), $open->json('error'));

        // الطلب الصالح يبلغ المفتاح.
        config(['ai_assistant.enabled' => false]);
        $this->ask($auth['token'])->assertStatus(503)->assertJsonPath('error.code', 'platform_disabled');
    }

    /** @test */
    public function the_endpoint_requires_authentication(): void
    {
        config(['ai_assistant.enabled' => true]);

        $this->postJson(self::URL, ['message' => 'x'])->assertUnauthorized();
    }

    // ───────────────────── tenant opt-in / consent ─────────────────────

    /** @test */
    public function a_tenant_that_never_opted_in_is_denied_by_default(): void
    {
        $auth = $this->readyTenant(tenantOptIn: false);

        $this->ask($auth['token'])->assertForbidden()->assertJsonPath('error.code', 'tenant_not_enabled');
    }

    /** @test */
    public function enabled_without_category_consent_is_denied(): void
    {
        $auth = $this->readyTenant(tenantOptIn: false);
        $this->optIn($auth['tenant_id'], categories: []);

        $this->ask($auth['token'])->assertForbidden()->assertJsonPath('error.code', 'consent_required');
    }

    /** @test */
    public function consent_without_the_enabled_flag_is_denied(): void
    {
        $auth = $this->readyTenant(tenantOptIn: false);
        $this->optIn($auth['tenant_id'], enabled: false);

        $this->ask($auth['token'])->assertForbidden()->assertJsonPath('error.code', 'tenant_not_enabled');
    }

    /** @test */
    public function document_center_consent_does_not_authorize_the_assistant(): void
    {
        $auth = $this->readyTenant(tenantOptIn: false);

        // أوسع موافقة ممكنة لمركز المستندات: المنصة تسمح بالإرسال والمستأجر يفعّل المعالجة.
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_ai', 'provider' => 'anthropic', 'enabled' => true,
            'configuration' => ['allow_document_sending' => true, 'providers' => ['anthropic' => ['enabled' => true, 'api_key' => self::SECRET]]],
        ]);
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('document_intelligence', ['processing_enabled' => true, 'allowed_document_types' => ['purchase_invoice']]);
        app(TenantContext::class)->forget();

        $this->ask($auth['token'])->assertForbidden()->assertJsonPath('error.code', 'tenant_not_enabled');
    }

    /** @test */
    public function the_reserved_document_category_cannot_be_used_even_if_stored_while_financial_needs_its_own_consent(): void
    {
        $auth = $this->readyTenant(tenantOptIn: false);
        $this->optIn($auth['tenant_id'], [
            AiAssistantDataCategory::ASSISTANT_MESSAGES,
            AiAssistantDataCategory::DOCUMENT_PROJECTED_TEXT,
        ]);

        // الفئة المحجوزة (مستندات) غير قابلة للاستعمال مهما خُزِّنت.
        $this->ask($auth['token'], ['data_categories' => [AiAssistantDataCategory::DOCUMENT_PROJECTED_TEXT]])
            ->assertForbidden()->assertJsonPath('error.code', 'data_category_unavailable');
        $this->ask($auth['token'], ['data_categories' => [AiAssistantDataCategory::ASSISTANT_MESSAGES, AiAssistantDataCategory::DOCUMENT_PROJECTED_TEXT]])
            ->assertForbidden()->assertJsonPath('error.code', 'data_category_unavailable');

        // الفئة المالية متاحة كقدرة، لكنها لا تعمل بلا موافقة صريحة عليها (موافقة الرسائل لا تشملها).
        $this->ask($auth['token'], ['data_categories' => [AiAssistantDataCategory::FINANCIAL_SUMMARY]])
            ->assertForbidden()->assertJsonPath('error.code', 'consent_required');

        $this->optIn($auth['tenant_id'], [AiAssistantDataCategory::ASSISTANT_MESSAGES, AiAssistantDataCategory::FINANCIAL_SUMMARY]);
        $this->ask($auth['token'], ['data_categories' => [AiAssistantDataCategory::FINANCIAL_SUMMARY]])->assertOk();

        // والفئة المتاحة تبقى تعمل.
        $this->ask($auth['token'], ['data_categories' => [AiAssistantDataCategory::ASSISTANT_MESSAGES]])->assertOk();
    }

    /** @test */
    public function consent_is_per_tenant_and_never_leaks_between_companies(): void
    {
        $a = $this->readyTenant('ai-a');
        $b = $this->registerTenant('ai-b', 'owner@ai-b.test'); // لم يوافق

        $this->ask($a['token'])->assertOk();
        $this->ask($b['token'])->assertForbidden()->assertJsonPath('error.code', 'tenant_not_enabled');
    }

    // ───────────────────── actor / RBAC / revocation ─────────────────────

    /** @test */
    public function the_permission_is_registered_and_granted_only_to_the_intended_default_roles(): void
    {
        $this->assertContains('ai.assistant.use', Rbac::PERMISSIONS);

        // owner/admin عبر `*`، وaccountant صراحةً؛ staff وself_service لا.
        $this->assertSame(['*'], Rbac::MATRIX['owner']);
        $this->assertSame(['*'], Rbac::MATRIX['admin']);
        $this->assertContains('ai.assistant.use', Rbac::MATRIX['accountant']);
        $this->assertNotContains('ai.assistant.use', Rbac::MATRIX['staff']);
        $this->assertNotContains('ai.assistant.use', Rbac::MATRIX['self_service']);

        // المصفوفة الثابتة (السقوط الآمن) تعطي المحاسب الصلاحية خارج أي مستأجر أيضاً.
        $this->assertTrue(Rbac::allows('accountant', 'ai.assistant.use'));
        $this->assertFalse(Rbac::allows('staff', 'ai.assistant.use'));
        $this->assertFalse(Rbac::allows('self_service', 'ai.assistant.use'));
    }

    /** @test */
    public function granting_the_assistant_permission_to_accountant_changes_no_other_accountant_permission(): void
    {
        // الفرق الوحيد عن مصفوفة المحاسب السابقة هو الصلاحية الجديدة نفسها.
        $this->assertSame(
            [],
            array_values(array_diff(Rbac::MATRIX['accountant'], $this->accountantBase(), ['ai.assistant.use'])),
        );
        $this->assertCount(count($this->accountantBase()) + 1, Rbac::MATRIX['accountant']);

        // صلاحيات البيانات المالية والتقارير مستقلة وباقية كما هي للمحاسب، والصلاحية
        // الجديدة لا تُضيف شيئاً منها إلى دورٍ لا يملكها (staff/self_service لم يتغيّرا).
        foreach (['reports.view', 'invoices.view', 'payments.view', 'accounts.view'] as $dataPermission) {
            $this->assertContains($dataPermission, Rbac::MATRIX['accountant']);
            $this->assertNotContains($dataPermission, Rbac::MATRIX['self_service'], $dataPermission);
        }
        $this->assertNotContains('ai.assistant.use', Rbac::MATRIX['staff']);
    }

    /** @test */
    public function a_newly_registered_tenants_default_accountant_can_use_the_assistant_once_enabled(): void
    {
        $auth = $this->readyTenant();
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@ai.test');

        $this->ask($accountant)->assertOk()->assertJsonPath('data.status', 'ok');
    }

    /** @test */
    public function the_default_accountant_is_still_denied_while_the_platform_or_tenant_gate_is_closed(): void
    {
        $platformOff = $this->readyTenant('ai-off', platform: false);
        $this->ask($this->tokenForRole($platformOff['tenant_id'], 'accountant', 'acc@ai-off.test'))
            ->assertStatus(503)->assertJsonPath('error.code', 'platform_disabled');

        $noOptIn = $this->readyTenant('ai-noopt', tenantOptIn: false);
        $this->ask($this->tokenForRole($noOptIn['tenant_id'], 'accountant', 'acc@ai-noopt.test'))
            ->assertForbidden()->assertJsonPath('error.code', 'tenant_not_enabled');
    }

    /** @test */
    public function staff_and_self_service_remain_denied_even_when_platform_and_tenant_allow(): void
    {
        $auth = $this->readyTenant();

        $this->ask($this->tokenForRole($auth['tenant_id'], 'staff', 'staff@ai.test'))->assertForbidden();
        $this->ask($this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@ai.test'))->assertForbidden();
    }

    /** @test */
    public function a_stored_accountant_role_without_the_permission_is_not_silently_backfilled(): void
    {
        // مستأجر قائم دوره المخزَّن سابق للصلاحية: يبقى مرفوضاً حتى يُمنحها صراحةً (لا هجرة).
        $auth = $this->readyTenant();
        $token = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@ai.test');
        $this->setRolePermissions($auth['tenant_id'], 'accountant', $this->accountantBase());

        $this->ask($token)->assertForbidden();
    }

    /** @test */
    public function the_assistant_permission_alone_grants_no_financial_or_report_access(): void
    {
        $auth = $this->readyTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        Role::create(['slug' => 'ai_only', 'name' => 'مساعد فقط', 'permissions' => ['ai.assistant.use'], 'is_system' => false]);
        $token = $this->tokenForRole($auth['tenant_id'], 'ai_only', 'aionly@ai.test');

        $this->ask($token)->assertOk();
        foreach (['/api/reports/income-statement', '/api/invoices', '/api/payments', '/api/accounts', '/api/purchases'] as $url) {
            $this->withToken($token)->getJson($url)->assertForbidden();
        }
    }

    /** @test */
    public function a_tool_permission_is_independent_of_the_assistant_permission(): void
    {
        $auth = $this->readyTenant();
        $token = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@ai.test');
        // المحاسب يملك ai.assistant.use لكنه لا يملك users.manage.
        $this->assertFalse(Rbac::allows('accountant', 'users.manage'));

        $probe = $this->probeTool(AiAssistantDataCategory::ASSISTANT_MESSAGES, 'users.manage');
        $this->app->instance(AiAssistantToolRegistry::class, $this->registryWith($probe));
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(fn () => [['name' => 'probe.echo', 'arguments' => []]]));

        $this->ask($token)->assertForbidden()->assertJsonPath('error.code', 'tool_permission_denied');
        $this->assertSame(0, $probe->calls);
    }

    /** @test */
    public function permission_revoked_between_requests_is_effective_immediately(): void
    {
        $auth = $this->readyTenant();
        $token = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@ai.test');

        $this->setRolePermissions($auth['tenant_id'], 'accountant', [...$this->accountantBase(), 'ai.assistant.use']);
        $this->ask($token)->assertOk();

        $this->setRolePermissions($auth['tenant_id'], 'accountant', $this->accountantBase());
        $this->ask($token)->assertForbidden();
    }

    /** @test */
    public function consent_withdrawn_between_requests_is_effective_immediately(): void
    {
        $auth = $this->readyTenant();

        $this->ask($auth['token'])->assertOk();

        $this->optIn($auth['tenant_id'], categories: []);
        $this->ask($auth['token'])->assertForbidden()->assertJsonPath('error.code', 'consent_required');
    }

    /** @test */
    public function a_deactivated_actor_or_tenant_is_denied_by_the_policy_itself(): void
    {
        $auth = $this->readyTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $owner = User::where('email', 'owner@ai-a.test')->firstOrFail();
        $policy = app(AiAssistantPolicy::class);
        $cat = [AiAssistantDataCategory::ASSISTANT_MESSAGES];

        $this->assertSame($owner->id, $policy->authorize($owner->id, $cat)->id);

        $owner->update(['is_active' => false]);
        $this->assertDenied('actor_inactive', fn () => $policy->authorize($owner->id, $cat));

        $owner->update(['is_active' => true]);
        Tenant::whereKey($auth['tenant_id'])->update(['is_active' => false]);
        $this->assertDenied('tenant_inactive', fn () => $policy->authorize($owner->id, $cat));
    }

    /** @test */
    public function an_actor_from_another_tenant_is_never_resolved(): void
    {
        $a = $this->readyTenant('ai-a');
        $b = $this->readyTenant('ai-b');

        app(TenantContext::class)->set($b['tenant_id']);
        $userB = User::where('email', 'owner@ai-b.test')->firstOrFail();

        // سياق المستأجر A + معرّف مستخدم من B.
        app(TenantContext::class)->set($a['tenant_id']);
        $this->assertDenied('actor_unavailable', fn () => app(AiAssistantPolicy::class)->authorize($userB->id, [AiAssistantDataCategory::ASSISTANT_MESSAGES]));
    }

    // ───────────────────── branch / warehouse scope ─────────────────────

    /** @test */
    public function an_unrestricted_actor_cannot_name_another_tenants_branch_or_warehouse(): void
    {
        $a = $this->readyTenant('ai-a');
        $b = $this->readyTenant('ai-b');
        [$bBranch] = $this->twoBranches($b['token']);
        $bWarehouse = $this->withToken($b['token'])->getJson('/api/warehouses')['data'][0]['id'];

        $this->ask($a['token'], ['scope' => ['branch_ids' => [$bBranch]]])
            ->assertForbidden()->assertJsonPath('error.code', 'branch_scope_forbidden');
        $this->ask($a['token'], ['scope' => ['warehouse_ids' => [$bWarehouse]]])
            ->assertForbidden()->assertJsonPath('error.code', 'warehouse_scope_forbidden');
        // معرّف غير موجود إطلاقاً
        $this->ask($a['token'], ['scope' => ['branch_ids' => [(string) Str::uuid()]]])
            ->assertForbidden()->assertJsonPath('error.code', 'branch_scope_forbidden');
    }

    /** @test */
    public function an_unrestricted_actor_keeps_unrestricted_semantics_and_can_select_own_ids(): void
    {
        $auth = $this->readyTenant();
        [$main, $other] = $this->twoBranches($auth['token']);

        $none = $this->ask($auth['token'])->assertOk()->json('data.scope');
        $this->assertSame(['mode' => 'all', 'ids' => []], $none['branch']);
        $this->assertSame(['mode' => 'all', 'ids' => []], $none['warehouse']);

        $selected = $this->ask($auth['token'], ['scope' => ['branch_ids' => [$other, $main]]])->assertOk()->json('data.scope.branch');
        $this->assertSame('selected', $selected['mode']);
        $this->assertEqualsCanonicalizing([$main, $other], $selected['ids']);
    }

    /** @test */
    public function a_restricted_actor_requesting_a_forbidden_branch_is_rejected_not_widened(): void
    {
        $auth = $this->readyTenant();
        [$main, $other] = $this->twoBranches($auth['token']);
        $token = $this->restrictedToken($auth, ['branch_ids' => [$other]]);

        // الممنوع صراحةً يُرفض — لا يعود نطاقه هو (سلوك ReportBranchScope الأوسع).
        $this->ask($token, ['scope' => ['branch_ids' => [$main]]])
            ->assertForbidden()->assertJsonPath('error.code', 'branch_scope_forbidden');
        // خليط ممنوع + مسموح يُرفض كله.
        $this->ask($token, ['scope' => ['branch_ids' => [$main, $other]]])
            ->assertForbidden()->assertJsonPath('error.code', 'branch_scope_forbidden');

        // المسموح يمر، والإغفال يعني «ما أُسند إليه» لا «الكل».
        $this->assertSame(['mode' => 'selected', 'ids' => [$other]], $this->ask($token, ['scope' => ['branch_ids' => [$other]]])->assertOk()->json('data.scope.branch'));
        $this->assertSame(['mode' => 'assigned', 'ids' => [$other]], $this->ask($token)->assertOk()->json('data.scope.branch'));
    }

    /** @test */
    public function a_restricted_actor_requesting_a_forbidden_warehouse_is_rejected_not_widened(): void
    {
        $auth = $this->readyTenant();
        $mine = $this->withToken($auth['token'])->getJson('/api/warehouses')['data'][0]['id'];
        $theirs = $this->withToken($auth['token'])->postJson('/api/warehouses', ['name' => 'مخزن آخر'])->assertCreated()['data']['id'];
        $token = $this->restrictedToken($auth, ['warehouse_ids' => [$mine]]);

        $this->ask($token, ['scope' => ['warehouse_ids' => [$theirs]]])
            ->assertForbidden()->assertJsonPath('error.code', 'warehouse_scope_forbidden');
        $this->assertSame(['mode' => 'selected', 'ids' => [$mine]], $this->ask($token, ['scope' => ['warehouse_ids' => [$mine]]])->assertOk()->json('data.scope.warehouse'));
        $this->assertSame(['mode' => 'assigned', 'ids' => [$mine]], $this->ask($token)->assertOk()->json('data.scope.warehouse'));
    }

    // ───────────────────── bounded / malformed input ─────────────────────

    /** @test */
    public function malformed_and_unbounded_inputs_are_rejected_with_the_error_contract(): void
    {
        $auth = $this->readyTenant();
        $t = $auth['token'];
        $uuid = (string) Str::uuid();

        $bad = [
            'missing message' => [[], 'message'],
            'empty message' => [['message' => ''], 'message'],
            'whitespace message' => [['message' => "   \n "], 'message'],
            'array message' => [['message' => ['a']], 'message'],
            'too long' => [['message' => str_repeat('a', 2001)], 'message'],
            'control chars' => [['message' => "hi\x00there"], 'message'],
            'bad locale' => [['message' => 'x', 'locale' => 'fr'], 'locale'],
            'unknown category' => [['message' => 'x', 'data_categories' => ['secrets']], 'data_categories.0'],
            'empty categories' => [['message' => 'x', 'data_categories' => []], 'data_categories'],
            'dup categories' => [['message' => 'x', 'data_categories' => ['assistant_messages', 'assistant_messages']], 'data_categories.0'],
            'non-uuid branch' => [['message' => 'x', 'scope' => ['branch_ids' => ['br-1']]], 'scope.branch_ids.0'],
            'too many branches' => [['message' => 'x', 'scope' => ['branch_ids' => array_map(fn () => (string) Str::uuid(), range(1, 11))]], 'scope.branch_ids'],
            'dup warehouse' => [['message' => 'x', 'scope' => ['warehouse_ids' => [$uuid, $uuid]]], 'scope.warehouse_ids.0'],
            'scope not array' => [['message' => 'x', 'scope' => 'all'], 'scope'],
        ];
        foreach ($bad as $label => [$payload, $field]) {
            $res = $this->withToken($t)->postJson(self::URL, $payload);
            $res->assertStatus(422);
            $this->assertSame('invalid_request', $res->json('error.code'), $label);
            $this->assertArrayHasKey($field, $res->json('error.fields'), $label);
            $this->assertTrue(Str::isUuid($res->json('request_id')), $label);
        }

        // الحدّ نفسه مقبول، بما فيه نصّ عربي متعدد البايتات (الحدّ بالأحرف).
        $this->ask($t, ['message' => str_repeat('a', 2000)])->assertOk();
        $this->ask($t, ['message' => str_repeat('م', 2000)])->assertOk();
    }

    /** @test */
    public function client_chosen_tenant_actor_provider_tools_sql_or_urls_are_rejected_not_ignored(): void
    {
        $a = $this->readyTenant('ai-a');
        $b = $this->readyTenant('ai-b');

        $smuggled = [
            'tenant_id' => $b['tenant_id'],
            'user_id' => (string) Str::uuid(),
            'provider' => 'openai',
            'model' => 'gpt-x',
            'tools' => ['sql'],
            'sql' => 'select * from users',
            'url' => 'https://evil.example/exfil',
            'api_key' => self::SECRET,
        ];
        foreach ($smuggled as $field => $value) {
            $res = $this->ask($a['token'], [$field => $value])->assertStatus(422);
            $this->assertSame('invalid_request', $res->json('error.code'));
            $this->assertSame(['unsupported_field'], $res->json("error.fields.{$field}"));
        }

        $res = $this->ask($a['token'], ['scope' => ['tenant_id' => $b['tenant_id']]])->assertStatus(422);
        $this->assertSame(['unsupported_field'], $res->json('error.fields')['scope.tenant_id']);
    }

    // ───────────────────── mock provider behaviour ─────────────────────

    /** @test */
    public function the_mock_provider_is_deterministic_and_does_not_echo_the_prompt(): void
    {
        $auth = $this->readyTenant();

        $first = $this->ask($auth['token'])->assertOk();
        $second = $this->ask($auth['token'], ['message' => 'سؤال مختلف تماماً'])->assertOk();

        $this->assertSame($first->json('data.message'), $second->json('data.message'));
        $this->assertSame('assistant', $first->json('data.message.role'));
        $this->assertStringNotContainsString('PROMPT-CANARY', $first->getContent());
        $this->assertSame('mock', $first->json('data.provider'));
        $this->assertSame('ok', $first->json('data.status'));
        $this->assertSame([], $first->json('data.tool_calls'));
        $this->assertSame([AiAssistantDataCategory::ASSISTANT_MESSAGES], $first->json('data.data_categories'));
        $this->assertTrue(Str::isUuid($first->json('data.request_id')));
        $this->assertSame($first->json('data.request_id'), $first->headers->get('X-AI-Request-Id'));
        $this->assertNotSame($first->json('data.request_id'), $second->json('data.request_id'));

        $en = $this->ask($auth['token'], ['locale' => 'en'])->assertOk();
        $this->assertSame('en', $en->json('data.locale'));
        $this->assertNotSame($first->json('data.message.content'), $en->json('data.message.content'));
    }

    // ───────────────────── closed tool registry / per-invocation reauth ─────────────────────

    /** @test */
    public function the_shipped_tool_registry_is_closed_to_exactly_the_reviewed_tools(): void
    {
        $registry = app(AiAssistantToolRegistry::class);

        $this->assertEqualsCanonicalizing(
            // AI-04 يضيف أداة واحدة صريحة الاستدعاء فقط (قراءة مستند مُسقَط)؛ ما عداها مغلق.
            ['finance.income_statement', 'finance.receivables_aging', 'finance.payables_aging', 'documents.projected_read'],
            $registry->names(),
        );
        foreach (['sql', 'finance.getIncomeStatement', 'finance.journal_entries', 'finance.account_ledger', 'documents.read', 'documents.search', 'documents.download', ''] as $unknown) {
            $this->assertNull($registry->find($unknown), $unknown);
        }
    }

    /** @test */
    public function a_tool_call_planned_by_the_provider_is_rejected_when_not_registered(): void
    {
        $auth = $this->readyTenant();
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(
            fn () => [['name' => 'finance.getIncomeStatement', 'arguments' => ['tenant_id' => 'other']]],
        ));

        $this->ask($auth['token'])->assertForbidden()->assertJsonPath('error.code', 'tool_not_registered');
    }

    /** @test */
    public function too_many_planned_tool_calls_are_rejected_not_truncated(): void
    {
        $auth = $this->readyTenant();
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(
            fn () => array_fill(0, 4, ['name' => 'x', 'arguments' => []]),
        ));

        $this->ask($auth['token'])->assertStatus(422)->assertJsonPath('error.code', 'too_many_tool_calls');
    }

    /** @test */
    public function a_registered_tool_is_fully_reauthorized_with_a_fresh_actor_at_invocation_time(): void
    {
        $auth = $this->readyTenant();
        $token = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@ai.test');
        $granted = [...$this->accountantBase(), 'ai.assistant.use'];
        $this->setRolePermissions($auth['tenant_id'], 'accountant', $granted);

        $probe = $this->probeTool(AiAssistantDataCategory::ASSISTANT_MESSAGES, 'reports.view');
        $this->app->instance(AiAssistantToolRegistry::class, $this->registryWith($probe));
        $plan = fn () => [['name' => 'probe.echo', 'arguments' => ['n' => 1]]];

        // ١) كل شيء مسموح: تنفَّذ الأداة بفاعل طازج ونطاق محلول.
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider($plan));
        $res = $this->ask($token)->assertOk();
        $this->assertSame('probe.echo', $res->json('data.tool_calls.0.tool'));
        $this->assertSame(1, $probe->calls);
        $this->assertSame('acc@ai.test', $probe->lastActor->email);
        $this->assertSame($probe->lastActor, $probe->authUser, 'the fresh actor is the authenticated user while a tool runs');
        $this->assertSame(['mode' => 'all', 'ids' => []], $probe->lastBranchScope);

        // ٢) سُحبت صلاحية الأداة بعد التخطيط وقبل التنفيذ → لا تنفيذ.
        $revokeToolPermission = fn () => $this->setRolePermissions($auth['tenant_id'], 'accountant', [...array_diff($this->accountantBase(), ['reports.view']), 'ai.assistant.use']);
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(function () use ($plan, $revokeToolPermission) {
            $revokeToolPermission();

            return $plan();
        }));
        $this->ask($token)->assertForbidden()->assertJsonPath('error.code', 'tool_permission_denied');
        $this->assertSame(1, $probe->calls, 'the tool must not execute after revocation');

        // ٣) سُحبت صلاحية المساعد نفسها بعد التخطيط.
        $this->setRolePermissions($auth['tenant_id'], 'accountant', $granted);
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(function () use ($auth, $plan) {
            $this->setRolePermissions($auth['tenant_id'], 'accountant', $this->accountantBase());

            return $plan();
        }));
        $this->ask($token)->assertForbidden();
        $this->assertSame(1, $probe->calls);

        // ٤) سُحبت موافقة المستأجر بعد التخطيط.
        $this->setRolePermissions($auth['tenant_id'], 'accountant', $granted);
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(function () use ($auth, $plan) {
            $this->optIn($auth['tenant_id'], categories: []);

            return $plan();
        }));
        $this->ask($token)->assertForbidden();
        $this->assertSame(1, $probe->calls);
    }

    /** @test */
    public function a_tool_that_carries_a_reserved_data_category_is_refused(): void
    {
        $auth = $this->readyTenant();
        $this->optIn($auth['tenant_id'], [AiAssistantDataCategory::ASSISTANT_MESSAGES, AiAssistantDataCategory::DOCUMENT_PROJECTED_TEXT]);
        $probe = $this->probeTool(AiAssistantDataCategory::DOCUMENT_PROJECTED_TEXT, 'reports.view');
        $this->app->instance(AiAssistantToolRegistry::class, $this->registryWith($probe));
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(fn () => [['name' => 'probe.echo', 'arguments' => []]]));

        $this->ask($auth['token'])->assertForbidden()->assertJsonPath('error.code', 'data_category_unavailable');
        $this->assertSame(0, $probe->calls);
    }

    /** @test */
    public function a_tool_scope_is_re_resolved_and_a_forbidden_scope_blocks_execution(): void
    {
        $auth = $this->readyTenant();
        [$main, $other] = $this->twoBranches($auth['token']);
        $token = $this->restrictedToken($auth, ['branch_ids' => [$other]]);
        $probe = $this->probeTool(AiAssistantDataCategory::ASSISTANT_MESSAGES, 'reports.view');
        $this->app->instance(AiAssistantToolRegistry::class, $this->registryWith($probe));
        $this->app->instance(MockAiAssistantProvider::class, new MockAiAssistantProvider(fn () => [['name' => 'probe.echo', 'arguments' => []]]));

        $this->ask($token, ['scope' => ['branch_ids' => [$other]]])->assertOk();
        $this->assertSame(['mode' => 'selected', 'ids' => [$other]], $probe->lastBranchScope);

        $this->ask($token, ['scope' => ['branch_ids' => [$main]]])->assertForbidden();
        $this->assertSame(1, $probe->calls);
    }

    // ───────────────────── provider routing / zero egress ─────────────────────

    /** @test */
    public function any_provider_other_than_mock_fails_closed_without_network_or_secret_access(): void
    {
        $auth = $this->readyTenant();
        // اتصال حقيقي ومهيّأ في المنصة: يجب ألا يُستعمل ولا يُقرأ.
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_ai', 'provider' => 'anthropic', 'enabled' => true,
            'configuration' => ['allow_document_sending' => true, 'providers' => ['anthropic' => ['enabled' => true, 'api_key' => self::SECRET]]],
        ]);
        config(['document_center.provider_network_enabled' => true]);

        foreach (['anthropic', 'openai', 'google_gemini', '', 'MOCK'] as $provider) {
            config(['ai_assistant.provider' => $provider]);
            $res = $this->ask($auth['token'])->assertStatus(503);
            $res->assertJsonPath('error.code', 'provider_unavailable');
            $this->assertStringNotContainsString(self::SECRET, $res->getContent());
        }
        // (tearDown يؤكد Http::assertNothingSent)
    }

    /** @test */
    public function the_assistant_sources_contain_no_network_or_provider_client_code(): void
    {
        $files = [
            'app/Services/AiAssistantGateway.php', 'app/Services/AiAssistantPolicy.php',
            'app/Services/AiAssistantScopeGuard.php', 'app/Services/AiAssistantToolRegistry.php',
            'app/Services/MockAiAssistantProvider.php', 'app/Contracts/AiAssistantProvider.php',
            'app/Contracts/AiAssistantTool.php', 'app/Http/Controllers/Api/AiAssistantController.php',
            'app/Http/Requests/AiAssistantMessageRequest.php', 'app/Support/AiAssistantDenied.php',
            'app/Support/AiAssistantDataCategory.php', 'config/ai_assistant.php',
        ];
        $forbidden = [
            'Http::', 'Illuminate\\Support\\Facades\\Http', 'GuzzleHttp', 'curl_', 'fsockopen', 'stream_socket',
            'file_get_contents', 'PlatformIntegration', 'api_key', 'Crypt::', 'DB::raw', 'DB::select', 'DB::statement',
            'openai', 'gemini',
        ];

        foreach ($files as $file) {
            $path = base_path($file);
            $this->assertFileExists($path, $file);
            $source = file_get_contents($path);
            // التعليقات تذكر المزوّدين بالاسم عمداً؛ نفحص الشيفرة فقط.
            $code = implode("\n", array_map(
                fn ($token) => is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true) ? '' : (is_array($token) ? $token[1] : $token),
                token_get_all($source),
            ));
            foreach ($forbidden as $needle) {
                $this->assertStringNotContainsStringIgnoringCase($needle, $code, "{$file} must not contain `{$needle}`");
            }
            // AI-07: only the gateway and the config may NAME the one allowed external provider; nothing else in the list may.
            if (! in_array($file, ['app/Services/AiAssistantGateway.php', 'config/ai_assistant.php'], true)) {
                $this->assertStringNotContainsStringIgnoringCase('anthropic', $code, "{$file} must not name a provider");
            }
        }
    }

    /** @test */
    public function the_external_provider_class_has_no_network_secret_or_logging_code_of_its_own(): void
    {
        $code = implode("\n", array_map(
            fn ($token) => is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true) ? '' : (is_array($token) ? $token[1] : $token),
            token_get_all((string) file_get_contents(base_path('app/Services/AnthropicAssistantProvider.php'))),
        ));
        // It must reuse the platform integration + the existing client: no HTTP of its own, no key handling, no logging.
        foreach (['Http::', 'GuzzleHttp', 'curl_', 'fsockopen', 'stream_socket', 'file_get_contents', 'Crypt::', 'Log::', 'error_log', 'api_key', 'x-api-key', 'dd(', 'dump(', 'var_dump', 'print_r', 'openai', 'gemini'] as $needle) {
            $this->assertStringNotContainsStringIgnoringCase($needle, $code, "AnthropicAssistantProvider must not contain `{$needle}`");
        }
        $this->assertStringContainsString('converse', $code, 'it must go through the existing Anthropic client');
        $this->assertStringContainsString('aiProviderConfiguration', $code, 'it must read the existing platform integration');
    }

    // ───────────────────── secrets / audit ─────────────────────

    /** @test */
    public function audit_is_metadata_only_and_nothing_secret_or_prompt_reaches_logs_or_responses(): void
    {
        $auth = $this->readyTenant();
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_ai', 'provider' => 'anthropic', 'enabled' => true,
            'configuration' => ['providers' => ['anthropic' => ['enabled' => true, 'api_key' => self::SECRET]]],
        ]);
        Log::spy();

        $ok = $this->ask($auth['token'])->assertOk();
        config(['ai_assistant.provider' => 'openai']);
        $denied = $this->ask($auth['token'])->assertStatus(503);

        foreach ([$ok, $denied] as $res) {
            $this->assertStringNotContainsString(self::SECRET, $res->getContent());
            $this->assertStringNotContainsString('sk-', $res->getContent());
        }

        $contexts = [];
        Log::shouldHaveReceived('info')->withArgs(function ($message, $context = []) use (&$contexts) {
            if ($message === 'ai_assistant.request') {
                $contexts[] = $context;
            }

            return true;
        });
        $this->assertCount(2, $contexts);

        $allowedKeys = [
            'request_id', 'tenant_id', 'actor_id', 'data_categories', 'locale', 'message_chars',
            'branch_ids_requested', 'warehouse_ids_requested', 'tool_calls_planned', 'tool_calls_executed',
            'provider', 'outcome', 'reason',
        ];
        foreach ($contexts as $context) {
            $this->assertSame([], array_diff(array_keys($context), $allowedKeys), 'unexpected audit keys');
            $encoded = json_encode($context, JSON_UNESCAPED_UNICODE);
            $this->assertStringNotContainsString('PROMPT-CANARY', $encoded);
            $this->assertStringNotContainsString('المنارة', $encoded);
            $this->assertStringNotContainsString(self::SECRET, $encoded);
            $this->assertSame($auth['tenant_id'], $context['tenant_id']);
            $this->assertSame(mb_strlen(self::PROMPT), $context['message_chars']);
        }
        $this->assertSame(['allowed', 'ok'], [$contexts[0]['outcome'], $contexts[0]['reason']]);
        $this->assertSame(['denied', 'provider_unavailable'], [$contexts[1]['outcome'], $contexts[1]['reason']]);
    }

    /** @test */
    public function platform_integration_secrets_stay_encrypted_and_unchanged_by_the_gateway(): void
    {
        $auth = $this->readyTenant();
        $row = PlatformIntegrationSetting::create([
            'integration_key' => 'document_ai', 'provider' => 'anthropic', 'enabled' => true,
            'configuration' => ['providers' => ['anthropic' => ['api_key' => self::SECRET]]],
        ]);
        $before = $row->fresh()->getRawOriginal('configuration');

        $this->ask($auth['token'])->assertOk();

        $this->assertSame($before, $row->fresh()->getRawOriginal('configuration'));
        $this->assertStringNotContainsString(self::SECRET, $before);
        $this->assertSame(1, PlatformIntegrationSetting::count(), 'no second provider settings store');
    }

    // ───────────────────── fixtures ─────────────────────

    private function assertDenied(string $reason, callable $fn): void
    {
        try {
            $fn();
        } catch (AiAssistantDenied $denied) {
            $this->assertSame($reason, $denied->reason);

            return;
        }

        $this->fail("Expected AiAssistantDenied({$reason}).");
    }

    private function registryWith(AiAssistantTool $tool): AiAssistantToolRegistry
    {
        return new class($tool) extends AiAssistantToolRegistry {
            public function __construct(private readonly AiAssistantTool $tool) {}

            protected function definitions(): array
            {
                return [$this->tool];
            }
        };
    }

    private function probeTool(string $category, string $permission): object
    {
        return new class($category, $permission) implements AiAssistantTool {
            public int $calls = 0;
            public ?User $lastActor = null;
            public mixed $authUser = null;
            public array $lastBranchScope = [];

            public function __construct(private readonly string $category, private readonly string $permission) {}

            public function name(): string
            {
                return 'probe.echo';
            }

            public function description(): string
            {
                return 'probe';
            }

            public function inputSchema(): array
            {
                return ['type' => 'object', 'properties' => new \stdClass, 'additionalProperties' => false];
            }

            public function requiredPermission(): string
            {
                return $this->permission;
            }

            public function dataCategory(): string
            {
                return $this->category;
            }

            public function supportsWarehouseScope(): bool
            {
                return true;
            }

            public function validate(array $arguments): array
            {
                return $arguments;
            }

            public function auditMeta(array $result): array
            {
                return [];
            }

            public function execute(User $actor, array $arguments, array $branchScope, array $warehouseScope): array
            {
                $this->calls++;
                $this->lastActor = $actor;
                $this->authUser = \Illuminate\Support\Facades\Auth::guard()->user();
                $this->lastBranchScope = $branchScope;

                return ['ok' => true];
            }
        };
    }
}
