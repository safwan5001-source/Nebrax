<?php

namespace Tests\Feature;

use App\Models\AiAction;
use App\Models\AiActionExecution;
use App\Models\AiActionExecutionRow;
use App\Models\PlatformAdministrator;
use App\Models\Product;
use App\Services\AiActionControlService;
use App\Services\AiActionRegistry;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * IMP-X-01b — توصيل ضوابط المشغّل بنقطتي التنفيذ الوحيدتين (`AiActionPolicy::authorize` و`AiActionProductExecutionService`) خلف بوابة نشر مغلقة افتراضياً.
 * البوابة مغلقة ⇒ لا تغيير لأي مستأجر (باقي حزم AI Actions تمرّ بلا مساس)؛ مفتوحة ⇒ الافتراضي رفض، والمعاينة تبقى مستقلة عن التنفيذ، والإيقاف أثناء
 * التنفيذ يسري خلال صفٍّ واحد، وأعلام البيئة أرضية صلبة.
 */
class AiActionControlWiringTest extends TestCase
{
    use InteractsWithAiProductActions;
    use InteractsWithApi;
    use RefreshDatabase;

    private const TYPE = AiActionRegistry::PRODUCT_IMPORT;

    private PlatformAdministrator $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = PlatformAdministrator::create(['name' => 'مدير', 'email' => 'wiring@platform.test', 'password' => 'secret-password-1', 'is_active' => true]);
    }

    private function control(): AiActionControlService
    {
        return app(AiActionControlService::class);
    }

    private function grantUse(string $tenant): void
    {
        $this->control()->setPlatformState($this->admin, '*', 'use', true, 'مفتاح رئيسي للاختبار');
        $this->control()->setPlatformState($this->admin, self::TYPE, 'use', true, 'توفّر النوع للاختبار');
        $this->control()->setTenantState($this->admin, $tenant, self::TYPE, 'use', true, 'منحة المستأجر للاختبار');
    }

    private function grantExecution(string $tenant): void
    {
        $this->control()->setPlatformState($this->admin, '*', 'execution', true, 'تنفيذ عام للاختبار');
        $this->control()->setPlatformState($this->admin, self::TYPE, 'execution', true, 'تنفيذ النوع للاختبار');
        $this->control()->setTenantState($this->admin, $tenant, self::TYPE, 'execution', true, 'تنفيذ المستأجر للاختبار');
        app(TenantContext::class)->set($tenant);
        Settings::put('ai_actions', ['execution_approved' => true]);
    }

    private function create(string $token, string $key = 'wire-create-0001')
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', $key)->postJson('/api/ai-actions', ['type' => self::TYPE, 'proposal' => ['schema_version' => 1, 'rows' => []]]);
    }

    /** @test */
    public function the_gate_is_dark_by_default_and_a_closed_gate_changes_nothing(): void
    {
        $this->assertFalse(config('ai_actions.runtime_controls_enforced'));
        $auth = $this->registerTenant();
        $this->enable($auth['tenant_id']);

        // لا ضوابط ولا منح، ومع ذلك يعمل كما كان قبل التوصيل.
        $this->create($auth['token'])->assertCreated();
    }

    /** @test */
    public function with_the_gate_open_the_default_is_deny_with_a_stable_reason_per_layer(): void
    {
        $auth = $this->registerTenant();
        $this->enable($auth['tenant_id']);
        config(['ai_actions.runtime_controls_enforced' => true]);

        $this->create($auth['token'])->assertForbidden()->assertJsonPath('error.code', 'platform_off');

        $this->control()->setPlatformState($this->admin, '*', 'use', true, 'مفتاح رئيسي للاختبار');
        $this->create($auth['token'])->assertForbidden()->assertJsonPath('error.code', 'type_off');

        $this->control()->setPlatformState($this->admin, self::TYPE, 'use', true, 'توفّر النوع للاختبار');
        $this->create($auth['token'])->assertForbidden()->assertJsonPath('error.code', 'tenant_not_granted');

        $this->control()->setTenantState($this->admin, $auth['tenant_id'], self::TYPE, 'use', true, 'منحة المستأجر للاختبار');
        $this->create($auth['token'])->assertCreated();
    }

    /** @test */
    public function a_grant_never_replaces_rbac_the_tenant_opt_in_or_the_environment_floor(): void
    {
        $auth = $this->registerTenant();
        $this->enable($auth['tenant_id']);
        config(['ai_actions.runtime_controls_enforced' => true]);
        $this->grantUse($auth['tenant_id']);
        $this->create($auth['token'], 'wire-ok-0001')->assertCreated();

        // قبول المؤسسة نفسه لا يُستغنى عنه.
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('ai_actions', ['enabled' => false]);
        $this->create($auth['token'], 'wire-optin-0001')->assertForbidden()->assertJsonPath('error.code', 'tenant_not_enabled');
        Settings::put('ai_actions', ['enabled' => true]);

        // أرضية البيئة: تغلق كل شيء مهما كانت المنح.
        config(['ai_actions.enabled' => false]);
        $this->create($auth['token'], 'wire-floor-0001')->assertForbidden();
    }

    /** @test */
    public function one_tenants_grant_does_not_let_another_tenant_in(): void
    {
        $a = $this->registerTenant('wire-a', 'owner@wire-a.test');
        $b = $this->registerTenant('wire-b', 'owner@wire-b.test');
        $this->enable($a['tenant_id']);
        $this->enable($b['tenant_id']);
        config(['ai_actions.runtime_controls_enforced' => true]);
        $this->grantUse($a['tenant_id']);

        $this->create($a['token'], 'wire-a-0001')->assertCreated();
        $this->create($b['token'], 'wire-b-0001')->assertForbidden()->assertJsonPath('error.code', 'tenant_not_granted');
    }

    /** @test */
    public function execution_is_refused_until_its_own_grants_and_the_owners_approval_while_preview_and_approval_keep_working(): void
    {
        $auth = $this->registerTenant();
        config(['ai_actions.runtime_controls_enforced' => true]);
        $this->enable($auth['tenant_id']);
        $this->grantUse($auth['tenant_id']);
        [$id] = $this->approvedAction($auth);

        $run = fn () => $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'wire-run-0001')->postJson("/api/ai-actions/{$id}/executions", ['expected_version' => 1]);
        $run()->assertForbidden()->assertJsonPath('error.code', 'execution_platform_off');
        $this->assertSame(0, Product::withoutGlobalScopes()->count());

        $this->grantExecution($auth['tenant_id']);
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('ai_actions', ['execution_approved' => false]);
        $run()->assertForbidden()->assertJsonPath('error.code', 'tenant_owner_not_approved');

        Settings::put('ai_actions', ['execution_approved' => true]);
        $run()->assertSuccessful();
        $this->assertSame(1, Product::withoutGlobalScopes()->count());
    }

    /** @test */
    public function an_operator_stop_during_execution_takes_effect_within_one_row_and_the_run_resumes_after_release(): void
    {
        $auth = $this->registerTenant();
        config(['ai_actions.runtime_controls_enforced' => true, 'ai_actions.execution_batch_rows' => 10]);
        $this->enable($auth['tenant_id']);
        $this->grantUse($auth['tenant_id']);
        $this->grantExecution($auth['tenant_id']);
        [$id] = $this->approvedAction($auth, [$this->good('a', 2, 'STOP-1'), $this->good('b', 3, 'STOP-2'), $this->good('c', 4, 'STOP-3')]);

        // بعد أول منتج يُحفظ يُوقف المشغّل التنفيذ عالمياً؛ الصف الثاني يجب ألا يُكتب.
        $stopped = false;
        Product::created(function () use (&$stopped): void {
            if (! $stopped) {
                $stopped = true;
                $this->control()->setPlatformState($this->admin, '*', 'execution', false, 'إيقاف طارئ أثناء التنفيذ');
            }
        });

        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'wire-stop-0001')->postJson("/api/ai-actions/{$id}/executions", ['expected_version' => 1])
            ->assertForbidden()->assertJsonPath('error.code', 'execution_platform_off');

        $this->assertSame(1, Product::withoutGlobalScopes()->count(), 'لا صف بعد الإيقاف');
        $execution = AiActionExecution::query()->withoutGlobalScopes()->firstOrFail();
        $this->assertSame(AiActionExecution::STATUS_RUNNING, $execution->status);
        $this->assertSame(2, AiActionExecutionRow::query()->withoutGlobalScopes()->where('ai_action_execution_id', $execution->id)->where('status', AiActionExecutionRow::STATUS_PENDING)->count());
        $this->assertNull($execution->fresh()->claim_token, 'الاستئجار يُحرَّر عند الإيقاف');

        // المعاينة والمراجعة تعملان والتنفيذ مرفوض مع سبب ثابت.
        $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}")->assertOk();
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'wire-stop-0002')->postJson("/api/ai-actions/{$id}/executions", ['expected_version' => 1])
            ->assertForbidden()->assertJsonPath('error.code', 'execution_platform_off');

        // رفع الإيقاف ⇒ يستأنف من حيث وقف ولا يكرّر المنتج الأول.
        $this->control()->setPlatformState($this->admin, '*', 'execution', true, 'رفع الإيقاف');
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'wire-stop-0003')->postJson("/api/ai-actions/{$id}/executions", ['expected_version' => 1])->assertSuccessful();
        $this->assertSame(3, Product::withoutGlobalScopes()->count());
        $this->assertSame(3, Product::withoutGlobalScopes()->distinct()->count('sku'));
    }

    /** @test */
    public function every_policy_call_in_the_gateway_names_the_action_type_and_the_executor_checks_the_controls(): void
    {
        $gateway = (string) file_get_contents(base_path('app/Services/AiActionGateway.php'));
        preg_match_all('/->policy->authorize\((.*?)\);/s', $gateway, $matches);
        $this->assertNotEmpty($matches[1]);
        foreach ($matches[1] as $arguments) {
            $this->assertStringContainsString("\$definition['type']", $arguments, 'كل استدعاء authorize يمرّر نوع الإجراء لضوابط المشغّل');
        }

        $executor = (string) file_get_contents(base_path('app/Services/AiActionProductExecutionService.php'));
        $this->assertGreaterThanOrEqual(4, substr_count($executor, 'controls->assertAllowed('), 'run + retry + قبل كل صف + قبل الصور');
    }

    /** @return array{0: string, 1: array<string, mixed>} */
    private function approvedAction(array $auth, ?array $rows = null): array
    {
        $rows ??= [$this->good('a', 2, 'WIRE-1')];
        $id = $this->makeAction($auth, $rows, 'wire-act-0001');
        $preview = $this->preview($auth['token'], $id, 1, 'wire-act-0001-pv')->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview, 1, 'wire-act-0001-ap')->assertCreated();

        return [$id, $preview];
    }
}
