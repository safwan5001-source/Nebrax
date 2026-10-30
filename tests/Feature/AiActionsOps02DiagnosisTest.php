<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Services\AiActionControlService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * OPS-02 (تشخيص منطق التطبيق، بلا أي تغيير سلوك): عرض «التنفيذ غير متاح حالياً من إدارة المنصة» = `platform_unavailable` يدمج ستة أسباب مستوى منصة
 * (أرضية البيئة، ومفتاحا المنصة الرئيسي والنوع للاستخدام، ومفتاحا الرئيسي والنوع للتنفيذ). هذه الاختبارات تثبّت بالتسلسل الدقيق أي منحة تُحوِّل أي سبب، وأن
 * منح المستأجر وموافقة المالك وحدهما لا يكفيان — فيعرف مدير المنصة بالضبط أي مفتاح ناقص (لوحة المنصة تعرض السبب الخام لكل قدرة في تفاصيل المستأجر).
 */
class AiActionsOps02DiagnosisTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const TYPE = 'product_import.v1';

    private PlatformAdministrator $admin;

    protected function setUp(): void
    {
        parent::setUp();
        // سيناريو المالك: الأعلام الثلاثة مفتوحة (التفعيل، التنفيذ، إنفاذ الضوابط).
        config(['ai_actions.enabled' => true, 'ai_actions.execution_enabled' => true, 'ai_actions.runtime_controls_enforced' => true]);
        $this->admin = PlatformAdministrator::create([
            'name' => 'مدير منصة', 'email' => Str::random(8).'@platform.test', 'password' => 'secret-password-1', 'is_active' => true,
        ]);
    }

    private function service(): AiActionControlService
    {
        return app(AiActionControlService::class);
    }

    /** المستأجر كما في الحالة المُبلَّغ عنها: مفعَّل بقبول المؤسسة + موافقة المالك + منحتا المستأجر (استخدام وتنفيذ) — ولا صف منصة. */
    private function ownerScenarioTenant(bool $grantTenantRows = true): array
    {
        $auth = $this->registerTenant('ops02', 'owner@ops02.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('ai_actions', ['enabled' => true, 'execution_approved' => true]);
        if ($grantTenantRows) {
            $this->service()->setTenantState($this->admin, $auth['tenant_id'], self::TYPE, 'use', true, 'منحة استخدام للمستأجر');
            $this->service()->setTenantState($this->admin, $auth['tenant_id'], self::TYPE, 'execution', true, 'منحة تنفيذ للمستأجر');
        }

        return $auth;
    }

    /** @return array{preview:string,execution:string} ما يراه المستأجر فعلاً في الشاشة (`allowed` أو رمز السبب). */
    private function seen(array $auth): array
    {
        $access = $this->withToken($auth['token'])->getJson('/api/ai-actions-settings')->assertOk()->json('data.access')[self::TYPE];

        return [
            'preview' => $access['preview']['allowed'] ? 'allowed' : $access['preview']['reason'],
            'execution' => $access['execution']['allowed'] ? 'allowed' : $access['execution']['reason'],
        ];
    }

    /** @return array{preview:string,execution:string} ما يراه مدير المنصة (الأسباب الخام) لهذا المستأجر. */
    private function rawReasons(array $auth): array
    {
        $matrix = app(\App\Services\AiActionsAccessResolver::class)->matrix($auth['tenant_id'])[self::TYPE];

        return [
            'preview' => $matrix['preview']['allowed'] ? 'allowed' : $matrix['preview']['reason'],
            'execution' => $matrix['execution']['allowed'] ? 'allowed' : $matrix['execution']['reason'],
        ];
    }

    /** @test */
    public function the_reported_symptom_is_exactly_every_platform_row_missing_and_tenant_grants_alone_do_not_help(): void
    {
        $auth = $this->ownerScenarioTenant();

        $this->assertSame(['preview' => 'platform_unavailable', 'execution' => 'platform_unavailable'], $this->seen($auth), 'العَرَض المُبلَّغ عنه.');
        $this->assertSame(['preview' => 'platform_off', 'execution' => 'platform_off'], $this->rawReasons($auth), 'السبب الخام عند مدير المنصة: المفتاح الرئيسي للاستخدام.');
    }

    /** @test */
    public function four_platform_grants_in_order_turn_each_reason_and_only_the_last_unlocks_execution(): void
    {
        $auth = $this->ownerScenarioTenant();
        $steps = [
            ['*', 'use', ['preview' => 'type_off', 'execution' => 'type_off']],
            [self::TYPE, 'use', ['preview' => 'allowed', 'execution' => 'execution_platform_off']],
            ['*', 'execution', ['preview' => 'allowed', 'execution' => 'execution_type_off']],
            [self::TYPE, 'execution', ['preview' => 'allowed', 'execution' => 'allowed']],
        ];

        foreach ($steps as [$type, $capability, $expectedRaw]) {
            $this->service()->setPlatformState($this->admin, $type, $capability, true, 'منحة منصة للتشخيص');
            $this->assertSame($expectedRaw, $this->rawReasons($auth), "بعد منح {$type}/{$capability}");
        }
        $this->assertSame(['preview' => 'allowed', 'execution' => 'allowed'], $this->seen($auth));
    }

    /** @test */
    public function with_the_platform_rows_on_a_missing_tenant_grant_or_owner_approval_names_its_own_reason_not_the_platform_one(): void
    {
        $auth = $this->ownerScenarioTenant(grantTenantRows: false);
        foreach (['*', self::TYPE] as $type) {
            foreach (['use', 'execution'] as $capability) {
                $this->service()->setPlatformState($this->admin, $type, $capability, true, 'منح كل صفوف المنصة');
            }
        }
        $this->assertSame(['preview' => 'tenant_not_granted', 'execution' => 'tenant_not_granted'], $this->seen($auth));

        $this->service()->setTenantState($this->admin, $auth['tenant_id'], self::TYPE, 'use', true, 'منحة استخدام');
        $this->assertSame(['preview' => 'allowed', 'execution' => 'execution_tenant_not_granted'], $this->seen($auth));

        $this->service()->setTenantState($this->admin, $auth['tenant_id'], self::TYPE, 'execution', true, 'منحة تنفيذ');
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('ai_actions', ['execution_approved' => false]);
        $this->assertSame(['preview' => 'allowed', 'execution' => 'tenant_owner_not_approved'], $this->seen($auth));
    }

    /** @test */
    public function the_execution_environment_floor_off_in_the_serving_process_looks_identical_to_a_missing_platform_row_to_the_tenant(): void
    {
        $auth = $this->ownerScenarioTenant();
        foreach (['*', self::TYPE] as $type) {
            foreach (['use', 'execution'] as $capability) {
                $this->service()->setPlatformState($this->admin, $type, $capability, true, 'منح كل صفوف المنصة');
            }
        }
        $this->assertSame('allowed', $this->seen($auth)['execution']);

        config(['ai_actions.execution_enabled' => false]);

        $this->assertSame('platform_unavailable', $this->seen($auth)['execution'], 'المستأجر لا يميّز أرضية البيئة عن صف منصة ناقص (لا تُكشف أعلام البيئة).');
        $this->assertSame('execution_env_floor_off', $this->rawReasons($auth)['execution'], 'مدير المنصة يرى السبب الخام.');
        $this->assertSame('allowed', $this->seen($auth)['preview'], 'إيقاف التنفيذ لا يوقف المعاينة.');
    }
}
