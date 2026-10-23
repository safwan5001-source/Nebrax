<?php

namespace Tests\Feature;

use App\Models\AiAuditEvent;
use App\Models\Role;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * IMP-X-01c — موافقة مالك المؤسسة على تنفيذ AI Actions (المفتاح الثاني بعد منحة المشغّل، قرار D-11): للمالك وحده، تتطلب قبول المؤسسة، سحبها متاح دائماً،
 * ذرّية بتدقيق وصفي، ولا تمنح تنفيذاً بذاتها.
 */
class AiActionExecutionApprovalTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const URL = '/api/ai-actions-settings/execution-approval';

    protected function setUp(): void
    {
        parent::setUp();
        config(['ai_actions.enabled' => true]);
    }

    private function approved(string $tenantId): bool
    {
        app(TenantContext::class)->set($tenantId);

        return (Settings::group('ai_actions')['execution_approved'] ?? false) === true;
    }

    private function optIn(string $token): void
    {
        $this->withToken($token)->putJson('/api/ai-actions-settings', ['enabled' => true])->assertOk();
    }

    private function events(string $tenantId): int
    {
        return AiAuditEvent::query()->withoutGlobalScopes()->where('tenant_id', $tenantId)->where('event', 'ai_actions.execution_approval.updated')->count();
    }

    /** @test */
    public function the_owner_approves_and_withdraws_with_an_audit_trail_and_default_is_not_approved(): void
    {
        config(['ai_actions.enabled' => true]);
        $auth = $this->registerTenant();
        $this->assertFalse($this->approved($auth['tenant_id']));
        $this->withToken($auth['token'])->getJson('/api/ai-actions-settings')->assertOk()->assertJsonPath('data.execution_approved', false);
        $this->optIn($auth['token']);

        $this->withToken($auth['token'])->putJson(self::URL, ['approved' => true])->assertOk()
            ->assertJsonPath('data.execution_approved', true)->assertJsonPath('data.tenant_enabled', true);
        $this->assertTrue($this->approved($auth['tenant_id']));
        $this->withToken($auth['token'])->putJson(self::URL, ['approved' => false])->assertOk()->assertJsonPath('data.execution_approved', false);

        $this->assertSame(2, $this->events($auth['tenant_id']));
        $event = AiAuditEvent::query()->withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->where('event', 'ai_actions.execution_approval.updated')->orderBy('occurred_at')->first();
        $this->assertSame(['ai_actions_execution_approved' => true], $event->meta);
    }

    /** @test */
    public function an_unchanged_value_writes_nothing_and_audits_nothing(): void
    {
        $auth = $this->registerTenant();
        $this->optIn($auth['token']);

        $this->withToken($auth['token'])->putJson(self::URL, ['approved' => false])->assertOk();
        $this->withToken($auth['token'])->putJson(self::URL, ['approved' => true])->assertOk();
        $this->withToken($auth['token'])->putJson(self::URL, ['approved' => true])->assertOk();

        $this->assertSame(1, $this->events($auth['tenant_id']));
    }

    /** @test */
    public function approval_needs_the_tenant_opt_in_first_but_withdrawal_is_always_possible(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->putJson(self::URL, ['approved' => true])->assertStatus(409)->assertJsonPath('error.code', 'tenant_not_enabled');
        $this->assertFalse($this->approved($auth['tenant_id']));

        $this->optIn($auth['token']);
        $this->withToken($auth['token'])->putJson(self::URL, ['approved' => true])->assertOk();
        // السحب يعمل في أي حال، ولو بعد إيقاف قبول المؤسسة.
        $this->withToken($auth['token'])->putJson(self::URL, ['approved' => false])->assertOk()->assertJsonPath('data.execution_approved', false);
    }

    /** @test */
    public function turning_the_organisations_acceptance_off_withdraws_the_execution_approval_and_re_enabling_does_not_restore_it(): void
    {
        $auth = $this->registerTenant();
        $this->optIn($auth['token']);
        $this->withToken($auth['token'])->putJson(self::URL, ['approved' => true])->assertOk();
        $admin = $this->tokenForRole($auth['tenant_id'], 'admin', 'admin@exec-reenable.test');

        $this->withToken($auth['token'])->putJson('/api/ai-actions-settings', ['enabled' => false])->assertOk()->assertJsonPath('data.execution_approved', false);
        $this->assertFalse($this->approved($auth['tenant_id']));

        // إعادة التفعيل — حتى بيد admin — لا تعيد موافقة المالك القديمة.
        $this->withToken($admin)->putJson('/api/ai-actions-settings', ['enabled' => true])->assertOk()->assertJsonPath('data.execution_approved', false);
        $this->assertFalse($this->approved($auth['tenant_id']));

        $event = AiAuditEvent::query()->withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->where('event', 'ai_actions.enablement.updated')->orderBy('occurred_at')->get()->first(fn ($e) => ($e->meta['ai_actions_enabled'] ?? null) === false);
        $this->assertSame(['ai_actions_enabled' => false, 'ai_actions_execution_approved' => false], $event->meta);
    }

    /** @test */
    public function only_the_owner_can_approve_not_an_admin_nor_a_custom_role_even_with_the_permission(): void
    {
        $auth = $this->registerTenant();
        $this->optIn($auth['token']);
        $admin = $this->tokenForRole($auth['tenant_id'], 'admin', 'admin@exec-approve.test');

        $this->withToken($admin)->putJson(self::URL, ['approved' => true])->assertForbidden()->assertJsonPath('error.code', 'owner_required');

        app(TenantContext::class)->set($auth['tenant_id']);
        Role::create(['slug' => 'exec-approver', 'name' => 'موافق', 'permissions' => ['ai.actions.execution_approve'], 'is_system' => false]);
        $custom = $this->tokenForRole($auth['tenant_id'], 'exec-approver', 'custom@exec-approve.test');
        $this->withToken($custom)->putJson(self::URL, ['approved' => true])->assertForbidden()->assertJsonPath('error.code', 'owner_required');

        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@exec-approve.test');
        $this->withToken($accountant)->putJson(self::URL, ['approved' => true])->assertForbidden();

        $this->assertFalse($this->approved($auth['tenant_id']));
        $this->assertSame(0, $this->events($auth['tenant_id']));
    }

    /** @test */
    public function the_contract_is_closed_and_the_route_is_authenticated(): void
    {
        $auth = $this->registerTenant();
        $this->optIn($auth['token']);

        $this->flushHeaders();
        $this->putJson(self::URL, ['approved' => true])->assertUnauthorized();
        $this->withToken($auth['token'])->putJson(self::URL, [])->assertStatus(422);
        $this->withToken($auth['token'])->putJson(self::URL, ['approved' => 'maybe'])->assertStatus(422);
        $this->withToken($auth['token'])->putJson(self::URL, ['approved' => true, 'enabled' => false])->assertStatus(422);
        $this->assertFalse($this->approved($auth['tenant_id']));
    }

    /** @test */
    public function one_tenants_approval_never_touches_another(): void
    {
        $a = $this->registerTenant('exec-a', 'owner@exec-a.test');
        $b = $this->registerTenant('exec-b', 'owner@exec-b.test');
        $this->optIn($a['token']);
        $this->optIn($b['token']);

        $this->withToken($a['token'])->putJson(self::URL, ['approved' => true])->assertOk();

        $this->assertTrue($this->approved($a['tenant_id']));
        $this->assertFalse($this->approved($b['tenant_id']));
        $this->withToken($b['token'])->getJson('/api/ai-actions-settings')->assertOk()->assertJsonPath('data.execution_approved', false);
    }

    /** @test */
    public function the_status_explains_availability_only_when_the_operator_gate_is_open(): void
    {
        config(['ai_actions.enabled' => true]);
        $auth = $this->registerTenant();
        $this->optIn($auth['token']);

        $this->withToken($auth['token'])->getJson('/api/ai-actions-settings')->assertOk()
            ->assertJsonPath('data.controls_enforced', false)->assertJsonPath('data.access', null);

        config(['ai_actions.runtime_controls_enforced' => true]);
        $access = $this->withToken($auth['token'])->getJson('/api/ai-actions-settings')->assertOk()
            ->assertJsonPath('data.controls_enforced', true)->json('data.access');
        $this->assertSame('platform_unavailable', $access['product_import.v1']['preview']['reason'], 'أسباب المنصة لا تُكشف للمستأجر');
        $this->assertFalse($access['product_import.v1']['execution']['allowed']);
    }
}
