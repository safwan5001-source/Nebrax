<?php

namespace Tests\Feature;

use App\Models\AiAuditEvent;
use App\Models\Role;
use App\Support\Rbac;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * IMP-H2-S4 — قبول المؤسسة لـAI Actions (`ai_actions.enabled`): مسار كتابة وقراءة مدقَّقان.
 *
 * تشغيل: php artisan test --filter=AiActionTenantEnablementTest
 */
class AiActionTenantEnablementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const URL = '/api/ai-actions-settings';

    private function customRole(string $tenantId, string $slug, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($tenantId, $slug, $email);
    }

    private function tenantFlag(string $tenantId): bool
    {
        app(TenantContext::class)->set($tenantId);

        return (Settings::group('ai_actions')['enabled'] ?? false) === true;
    }

    private function auditCount(string $tenantId): int
    {
        return AiAuditEvent::query()->withoutGlobalScopes()->where('tenant_id', $tenantId)->where('event', 'ai_actions.enablement.updated')->count();
    }

    private function draft(string $token, string $key)
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', $key)
            ->postJson('/api/ai-actions', ['type' => 'product_import.v1', 'proposal' => ['schema_version' => 1, 'rows' => []]]);
    }

    /** @test */
    public function default_is_off_and_the_owner_can_turn_it_on_and_off_with_an_audit_trail(): void
    {
        config(['ai_actions.enabled' => true]);
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->getJson(self::URL)->assertOk()
            ->assertJsonPath('data', ['platform_enabled' => true, 'tenant_enabled' => false, 'effective' => false, 'reason' => 'tenant_not_enabled']);
        $this->draft($auth['token'], 'enable-0001')->assertForbidden()->assertJsonPath('error.code', 'tenant_not_enabled');

        $this->withToken($auth['token'])->putJson(self::URL, ['enabled' => true])->assertOk()
            ->assertJsonPath('data', ['platform_enabled' => true, 'tenant_enabled' => true, 'effective' => true, 'reason' => 'enabled']);
        $this->assertTrue($this->tenantFlag($auth['tenant_id']));
        $this->draft($auth['token'], 'enable-0002')->assertCreated();

        $this->withToken($auth['token'])->putJson(self::URL, ['enabled' => false])->assertOk()->assertJsonPath('data.effective', false);
        $this->draft($auth['token'], 'enable-0003')->assertForbidden()->assertJsonPath('error.code', 'tenant_not_enabled');

        $this->assertSame(2, $this->auditCount($auth['tenant_id']));
        $event = AiAuditEvent::query()->withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->where('event', 'ai_actions.enablement.updated')->orderBy('occurred_at')->first();
        $this->assertSame(['ai_actions_enabled' => true], $event->meta);
    }

    /** @test */
    public function an_unchanged_value_writes_nothing_and_audits_nothing(): void
    {
        config(['ai_actions.enabled' => true]);
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->putJson(self::URL, ['enabled' => false])->assertOk();
        $this->withToken($auth['token'])->putJson(self::URL, ['enabled' => true])->assertOk();
        $this->withToken($auth['token'])->putJson(self::URL, ['enabled' => true])->assertOk();

        $this->assertSame(1, $this->auditCount($auth['tenant_id']));
    }

    /** @test */
    public function the_platform_flag_stays_a_hard_floor_enabling_is_refused_but_disabling_is_always_allowed(): void
    {
        config(['ai_actions.enabled' => true]);
        $auth = $this->registerTenant();
        $this->withToken($auth['token'])->putJson(self::URL, ['enabled' => true])->assertOk();

        config(['ai_actions.enabled' => false]);
        $this->withToken($auth['token'])->getJson(self::URL)->assertOk()
            ->assertJsonPath('data.tenant_enabled', true)->assertJsonPath('data.effective', false)->assertJsonPath('data.reason', 'platform_disabled');
        $this->draft($auth['token'], 'floor-0001')->assertForbidden()->assertJsonPath('error.code', 'platform_disabled');

        $this->withToken($auth['token'])->putJson(self::URL, ['enabled' => false])->assertOk()->assertJsonPath('data.tenant_enabled', false);

        $this->withToken($auth['token'])->putJson(self::URL, ['enabled' => true])->assertStatus(409)->assertJsonPath('error.code', 'platform_disabled');
        $this->assertFalse($this->tenantFlag($auth['tenant_id']));
    }

    /** @test */
    public function only_a_holder_of_the_manage_permission_can_write_and_other_ai_roles_can_only_read(): void
    {
        config(['ai_actions.enabled' => true]);
        $auth = $this->registerTenant();
        $tid = $auth['tenant_id'];

        foreach (['accountant' => 'acc@acme.test', 'staff' => 'staff@acme.test'] as $role => $email) {
            $token = $this->tokenForRole($tid, $role, $email);
            $this->withToken($token)->putJson(self::URL, ['enabled' => true])->assertForbidden();
        }
        // مستعمل AI Actions يقرأ الحالة ليفهم سبب الإيقاف لكنه لا يغيّرها.
        $user = $this->customRole($tid, 'ai_user', ['ai.actions.use'], 'user@acme.test');
        $this->withToken($user)->getJson(self::URL)->assertOk();
        $this->withToken($user)->putJson(self::URL, ['enabled' => true])->assertForbidden();
        // بلا أي صلاحية AI Actions: لا قراءة ولا كتابة.
        $none = $this->customRole($tid, 'no_ai', ['products.view'], 'none@acme.test');
        $this->withToken($none)->getJson(self::URL)->assertForbidden();
        // سلطة الإدارة وحدها تكفي للكتابة (مستقلة عن الاستعمال والاعتماد).
        $manager = $this->customRole($tid, 'ai_manager', ['ai.actions.manage'], 'mgr@acme.test');
        $this->withToken($manager)->putJson(self::URL, ['enabled' => true])->assertOk();

        $this->flushHeaders()->getJson(self::URL)->assertUnauthorized();
        $this->assertContains('ai.actions.manage', Rbac::PERMISSIONS);
        foreach (['accountant', 'staff'] as $role) {
            $this->assertFalse(Rbac::allows($role, 'ai.actions.manage'), $role);
        }
        $this->assertTrue(Rbac::allows('owner', 'ai.actions.manage'));
    }

    /** @test */
    public function the_contract_is_closed_to_the_single_enabled_flag(): void
    {
        config(['ai_actions.enabled' => true]);
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->putJson(self::URL, [])->assertUnprocessable();
        $this->withToken($auth['token'])->putJson(self::URL, ['enabled' => 'maybe'])->assertUnprocessable();
        $this->withToken($auth['token'])->putJson(self::URL, ['enabled' => true, 'execution_enabled' => true])->assertUnprocessable();
        $this->withToken($auth['token'])->putJson(self::URL, ['enabled' => true, 'tenant_id' => 'x'])->assertUnprocessable();
        $this->assertFalse($this->tenantFlag($auth['tenant_id']));
        // مفاتيح الاستعلام ليست جزءاً من الجسم المغلق.
        $this->withToken($auth['token'])->putJson(self::URL.'?trace=1', ['enabled' => true])->assertOk();
    }

    /** @test */
    public function one_tenant_never_changes_or_sees_another_tenants_flag(): void
    {
        config(['ai_actions.enabled' => true]);
        $a = $this->registerTenant('acme-a', 'owner@a.test');
        $b = $this->registerTenant('acme-b', 'owner@b.test');

        $this->withToken($a['token'])->putJson(self::URL, ['enabled' => true])->assertOk();

        $this->assertTrue($this->tenantFlag($a['tenant_id']));
        $this->assertFalse($this->tenantFlag($b['tenant_id']));
        $this->withToken($b['token'])->getJson(self::URL)->assertOk()->assertJsonPath('data.tenant_enabled', false);
        $this->assertSame(0, $this->auditCount($b['tenant_id']));
    }
}
