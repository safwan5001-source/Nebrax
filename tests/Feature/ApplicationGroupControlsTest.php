<?php

namespace Tests\Feature;

use App\Models\TenantApplicationGroupEvent;
use App\Models\TenantApplicationGroupState;
use App\Models\TenantApplicationState;
use App\Services\TenantApplicationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * التحكم الهرمي في التطبيقات: حالة التطبيق الرئيسي بوابة تشغيلية مستقلة عن
 * حالات الفروع المحفوظة، مع بقاء الاستحقاق وRBAC خارج هذه الطبقة.
 */
class ApplicationGroupControlsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function disabling_and_reenabling_a_principal_application_preserves_child_state(): void
    {
        $auth = $this->registerTenant('group-preserve', 'owner@group-preserve.test', autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $applications = app(TenantApplicationService::class);

        $applications->enable('sales.pos', null, 'اختبار الحفظ');

        $this->assertDatabaseHas('tenant_application_states', [
            'tenant_id' => $auth['tenant_id'],
            'application_key' => 'sales.pos',
            'requested_enabled' => true,
            'status' => 'enabled',
        ]);
        $this->assertSame('enabled', $applications->statusFor('sales.pos'));

        $applications->disableGroup('sales', null, 'تعطيل المبيعات');

        // POS يعيش في مجموعة مستقلة، لكنه يعتمد على sales.invoicing؛ لذلك
        // يُحجب تشغيلياً من دون العبث بصف حالته المحفوظ.
        $this->assertSame('disabled', $applications->statusFor('sales.invoicing'));
        $this->assertSame('disabled', $applications->statusFor('sales.pos'));
        $this->assertDatabaseHas('tenant_application_states', [
            'tenant_id' => $auth['tenant_id'],
            'application_key' => 'sales.pos',
            'requested_enabled' => true,
            'status' => 'enabled',
        ]);

        $applications->enableGroup('sales', null, 'إعادة المبيعات');

        $this->assertSame('enabled', $applications->statusFor('sales.invoicing'));
        $this->assertSame('enabled', $applications->statusFor('sales.pos'));
        $this->assertDatabaseHas('tenant_application_states', [
            'tenant_id' => $auth['tenant_id'],
            'application_key' => 'sales.pos',
            'requested_enabled' => true,
            'status' => 'enabled',
        ]);
    }

    /** @test */
    public function disabling_a_principal_application_hides_its_mandatory_capabilities_from_navigation(): void
    {
        $auth = $this->registerTenant('group-nav', 'owner@group-nav.test', autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $applications = app(TenantApplicationService::class);

        $applications->disableGroup('sales', null);
        $nav = $applications->navVisibility();

        $this->assertArrayHasKey('sales.invoicing', $nav);
        $this->assertFalse($nav['sales.invoicing']);
    }

    /** @test */
    public function global_principal_toggle_does_not_mutate_saved_child_states(): void
    {
        $auth = $this->registerTenant('group-global', 'owner@group-global.test', autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $applications = app(TenantApplicationService::class);
        $applications->enable('hr.employees', null);

        $before = TenantApplicationState::where('application_key', 'hr.employees')->firstOrFail();
        $beforeSnapshot = [
            'requested_enabled' => $before->requested_enabled,
            'status' => $before->status,
            'reason' => $before->reason,
        ];

        $applications->setAllGroups(false, null, 'تعطيل التطبيقات الرئيسية');

        $afterDisable = TenantApplicationState::where('application_key', 'hr.employees')->firstOrFail();
        $this->assertSame($beforeSnapshot['requested_enabled'], $afterDisable->requested_enabled);
        $this->assertSame($beforeSnapshot['status'], $afterDisable->status);
        $this->assertSame($beforeSnapshot['reason'], $afterDisable->reason);
        $this->assertSame('disabled', $applications->statusFor('hr.employees'));

        $applications->setAllGroups(true, null, 'إعادة التطبيقات الرئيسية');

        $afterEnable = TenantApplicationState::where('application_key', 'hr.employees')->firstOrFail();
        $this->assertSame($beforeSnapshot['requested_enabled'], $afterEnable->requested_enabled);
        $this->assertSame($beforeSnapshot['status'], $afterEnable->status);
        $this->assertSame('enabled', $applications->statusFor('hr.employees'));
    }

    /** @test */
    public function existing_application_endpoints_accept_principal_and_global_scopes_and_append_audit_events(): void
    {
        $auth = $this->registerTenant('group-api', 'owner@group-api.test', autoEnableApplications: false);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', [
            'scope' => 'group',
            'group_key' => 'customers',
            'reason' => 'إيقاف مؤقت',
        ])->assertOk()
            ->assertJsonPath('data.key', 'customers')
            ->assertJsonPath('data.enabled', false);

        $this->assertDatabaseHas('tenant_application_group_states', [
            'tenant_id' => $auth['tenant_id'],
            'group_key' => 'customers',
            'requested_enabled' => false,
            'reason' => 'إيقاف مؤقت',
        ]);
        $this->assertDatabaseHas('tenant_application_group_events', [
            'tenant_id' => $auth['tenant_id'],
            'group_key' => 'customers',
            'action' => 'disabled',
            'reason' => 'إيقاف مؤقت',
        ]);

        $index = $this->withToken($auth['token'])->getJson('/api/applications')->assertOk();
        $index->assertJsonPath('groups.customers.enabled', false);
        $this->assertFalse($index->json('data')['crm.customers']['group_enabled']);

        $this->withToken($auth['token'])->postJson('/api/applications/enable', [
            'scope' => 'all_groups',
        ])->assertOk()
            ->assertJsonPath('groups.customers.enabled', true);

        $this->assertGreaterThanOrEqual(2, TenantApplicationGroupEvent::where('group_key', 'customers')->count());
        $this->assertTrue((bool) TenantApplicationGroupState::where('group_key', 'customers')->value('requested_enabled'));
    }

    /** @test */
    public function legacy_capability_contract_remains_backward_compatible_without_scope(): void
    {
        $auth = $this->registerTenant('group-compat', 'owner@group-compat.test', autoEnableApplications: false);

        $this->withToken($auth['token'])->postJson('/api/applications/enable', [
            'application_key' => 'hr.employees',
        ])->assertOk()
            ->assertJsonPath('data.key', 'hr.employees')
            ->assertJsonPath('data.enabled', true);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', [
            'application_key' => 'hr.employees',
        ])->assertOk()
            ->assertJsonPath('data.key', 'hr.employees')
            ->assertJsonPath('data.enabled', false);
    }
}
