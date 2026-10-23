<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Services\AiActionRegistry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-X-01a — مسارات المنصة لضوابط إجراءات المساعد: الصلاحيات (قراءة/إدارة)، إلزامية السبب، العزل بين المستأجرين، وأن الضبط لا يمنح تنفيذاً دون
 * قبول المؤسسة ولا يتجاوز أرضية البيئة.
 */
class AiActionControlApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const TYPE = AiActionRegistry::PRODUCT_IMPORT;

    protected function setUp(): void
    {
        parent::setUp();
        config(['ai_actions.enabled' => true, 'ai_actions.execution_enabled' => false]);
    }

    private function platformToken(array $abilities = ['platform:read', 'platform:manage']): string
    {
        return PlatformAdministrator::create([
            'name' => 'مشغّل', 'email' => 'ops+'.uniqid().'@nebrax.test', 'password' => 'platform-password-123',
        ])->createToken('platform-console', $abilities)->plainTextToken;
    }

    /** @test */
    public function only_platform_administrators_can_reach_the_routes_and_tenant_tokens_never_can(): void
    {
        $a = $this->registerTenant('ac-a', 'owner@ac-a.test');
        $body = ['action_type' => self::TYPE, 'capability' => 'use', 'enabled' => true, 'reason' => 'محاولة مستأجر'];
        $routes = [
            ['getJson', '/api/platform/ai-action-controls', []],
            ['putJson', '/api/platform/ai-action-controls', $body],
            ['getJson', "/api/platform/tenants/{$a['tenant_id']}/ai-action-controls", []],
            ['putJson', "/api/platform/tenants/{$a['tenant_id']}/ai-action-controls", $body],
        ];

        foreach ($routes as [$verb, $uri, $payload]) {
            $this->flushHeaders();
            $this->{$verb}($uri, $payload)->assertUnauthorized();
            $this->withToken($a['token'])->{$verb}($uri, $payload)->assertForbidden();
        }

        $this->assertSame([0, 0], [DB::table('ai_action_controls')->count(), DB::table('ai_action_control_events')->count()]);
    }

    /** @test */
    public function a_read_only_platform_token_can_read_but_not_change(): void
    {
        $a = $this->registerTenant('ac-ro', 'owner@ac-ro.test');
        $token = $this->platformToken(['platform:read']);

        $this->withToken($token)->getJson('/api/platform/ai-action-controls')->assertOk()
            ->assertJsonPath('data.env_floor.use', true)->assertJsonPath('data.env_floor.execution', false)
            ->assertJsonPath('data.master.use.enabled', false)->assertJsonPath('data.types.0.action_type', self::TYPE);
        $this->withToken($token)->getJson("/api/platform/tenants/{$a['tenant_id']}/ai-action-controls")->assertOk()
            ->tap(fn ($r) => $this->assertSame('platform_off', $r->json('data.effective')[self::TYPE]['preview']['reason']))
            ->assertJsonCount(0, 'data.events');
        $this->withToken($token)->putJson('/api/platform/ai-action-controls', ['action_type' => '*', 'capability' => 'use', 'enabled' => true, 'reason' => 'قراءة فقط'])->assertForbidden();
        $this->withToken($token)->putJson("/api/platform/tenants/{$a['tenant_id']}/ai-action-controls", ['action_type' => self::TYPE, 'capability' => 'use', 'enabled' => true, 'reason' => 'قراءة فقط'])->assertForbidden();
        $this->assertSame(0, DB::table('ai_action_control_events')->count());
    }

    /** @test */
    public function a_manager_walks_the_layers_and_each_change_is_audited_with_its_reason(): void
    {
        $a = $this->registerTenant('ac-m', 'owner@ac-m.test');
        $token = $this->platformToken();
        $tenantUri = "/api/platform/tenants/{$a['tenant_id']}/ai-action-controls";

        $this->withToken($token)->putJson('/api/platform/ai-action-controls', ['action_type' => '*', 'capability' => 'use', 'enabled' => true, 'reason' => 'تشغيل المفتاح الرئيسي'])
            ->assertOk()->assertJsonPath('data.changed', true);
        $this->withToken($token)->putJson('/api/platform/ai-action-controls', ['action_type' => self::TYPE, 'capability' => 'use', 'enabled' => true, 'reason' => 'توفّر النوع'])->assertOk();
        $this->withToken($token)->putJson($tenantUri, ['action_type' => self::TYPE, 'capability' => 'use', 'enabled' => true, 'reason' => 'منحة للمؤسسة'])
            ->assertOk()->assertJsonPath('data.changed', true)
            ->tap(fn ($r) => $this->assertSame('tenant_not_enabled', $r->json('data.effective')[self::TYPE]['preview']['reason']));

        $show = $this->withToken($token)->getJson($tenantUri)->assertOk()
            ->assertJsonPath('data.grants.0.enabled', true)->assertJsonPath('data.events.0.reason', 'منحة للمؤسسة');
        $this->assertSame(1, count($show->json('data.events')));

        // الضبط الصريح المتكرر لا يكتب حدثاً جديداً.
        $this->withToken($token)->putJson($tenantUri, ['action_type' => self::TYPE, 'capability' => 'use', 'enabled' => true, 'reason' => 'تكرار الحالة'])
            ->assertOk()->assertJsonPath('data.changed', false);
        $this->assertSame(3, DB::table('ai_action_control_events')->count());
    }

    /** @test */
    public function validation_and_domain_refusals_use_the_right_status_and_write_nothing(): void
    {
        $a = $this->registerTenant('ac-v', 'owner@ac-v.test');
        $token = $this->platformToken();
        $tenantUri = "/api/platform/tenants/{$a['tenant_id']}/ai-action-controls";
        $good = ['action_type' => self::TYPE, 'capability' => 'use', 'enabled' => true, 'reason' => 'سبب كاف'];

        foreach ([['reason' => 'ab'], ['reason' => null], ['capability' => 'write'], ['enabled' => 'maybe'], ['action_type' => null]] as $override) {
            $this->withToken($token)->putJson('/api/platform/ai-action-controls', array_merge($good, $override))->assertStatus(422);
        }
        $this->withToken($token)->putJson('/api/platform/ai-action-controls', array_merge($good, ['action_type' => 'nope.v1']))->assertStatus(422)->assertHeader('X-Control-Reason', 'invalid_action_type');
        $this->withToken($token)->putJson($tenantUri, array_merge($good, ['action_type' => '*']))->assertStatus(422)->assertHeader('X-Control-Reason', 'invalid_action_type');
        $this->withToken($token)->putJson('/api/platform/tenants/'.\Illuminate\Support\Str::uuid().'/ai-action-controls', $good)->assertNotFound();
        $this->withToken($token)->getJson('/api/platform/tenants/'.\Illuminate\Support\Str::uuid().'/ai-action-controls')->assertNotFound();

        $this->assertSame([0, 0], [DB::table('ai_action_controls')->count(), DB::table('ai_action_control_events')->count()]);
    }

    /** @test */
    public function one_tenants_grant_neither_enables_another_nor_leaks_into_its_read(): void
    {
        $a = $this->registerTenant('ac-iso-a', 'owner@ac-iso-a.test');
        $b = $this->registerTenant('ac-iso-b', 'owner@ac-iso-b.test');
        $token = $this->platformToken();

        $this->withToken($token)->putJson("/api/platform/tenants/{$a['tenant_id']}/ai-action-controls", ['action_type' => self::TYPE, 'capability' => 'use', 'enabled' => true, 'reason' => 'منحة للمؤسسة أ'])->assertOk();

        $show = $this->withToken($token)->getJson("/api/platform/tenants/{$b['tenant_id']}/ai-action-controls")->assertOk()
            ->assertJsonCount(0, 'data.grants')->assertJsonCount(0, 'data.events');
        $this->assertSame('platform_off', $show->json('data.effective')[self::TYPE]['preview']['reason']);
        $this->assertSame(1, DB::table('ai_action_controls')->count());
    }

    /** @test */
    public function the_environment_floor_is_shown_and_can_never_be_changed_from_the_console(): void
    {
        $token = $this->platformToken();
        config(['ai_actions.enabled' => false]);

        $this->withToken($token)->putJson('/api/platform/ai-action-controls', ['action_type' => '*', 'capability' => 'use', 'enabled' => true, 'reason' => 'محاولة تجاوز الأرضية'])->assertOk();

        $this->withToken($token)->getJson('/api/platform/ai-action-controls')->assertOk()
            ->assertJsonPath('data.env_floor.use', false)->assertJsonPath('data.master.use.enabled', true);
        $a = $this->registerTenant('ac-floor', 'owner@ac-floor.test');
        $this->withToken($token)->getJson("/api/platform/tenants/{$a['tenant_id']}/ai-action-controls")->assertOk()
            ->tap(fn ($r) => $this->assertSame('env_floor_off', $r->json('data.effective')[self::TYPE]['preview']['reason']))
            ->tap(fn ($r) => $this->assertSame('env_floor_off', $r->json('data.effective')[self::TYPE]['execution']['reason']));
    }
}
