<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\TenantApplicationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * الإنفاذ الفعلي: `EnsureApplicationActive` على المسارات + `navVisibility()`
 * للشريط الجانبي. راجع تعليق `ENFORCEMENT_CUTOVER_AT` في
 * `TenantApplicationService` — الفارق بين مستأجر "قديم" (مُعامَل كمفعّل
 * دوماً) و"جديد" (يبدأ بالافتراضي الحقيقي: معطّل حتى يُفعَّل صراحة) هو محور
 * هذا الملف. تشغيل:  php artisan test --filter=ApplicationEnforcementTest
 */
class ApplicationEnforcementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function a_new_tenant_is_blocked_from_a_gated_route_until_the_capability_is_enabled(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);

        $this->withToken($auth['token'])->getJson('/api/pos-sessions')->assertStatus(403);

        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'sales.pos'])->assertOk();

        $this->withToken($auth['token'])->getJson('/api/pos-sessions')->assertOk();
    }

    /** @test */
    public function a_tenant_registered_before_the_enforcement_cutover_is_treated_as_enabled_without_ever_opting_in(): void
    {
        $tenant = Tenant::create([
            'name' => 'مؤسسة قديمة', 'slug' => 'legacy-tenant',
            'vat_number' => '300000000000059', 'currency' => 'SAR',
        ]);
        $tenant->forceFill(['created_at' => '2020-01-01 00:00:00'])->save();

        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        $token = $this->tokenForRole($tenant->id, 'owner', 'owner@legacy-tenant.test');

        // لم تُستدعَ enable() إطلاقاً — والمسار يمرّ رغم ذلك لأن المستأجر أُنشئ
        // قبل لحظة تفعيل الإنفاذ.
        $this->withToken($token)->getJson('/api/pos-sessions')->assertOk();
        $this->withToken($token)->getJson('/api/employees')->assertOk();
    }

    /** @test */
    public function a_suspended_capability_allows_reads_but_blocks_writes(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $employee = Employee::create(['employee_no' => 'EMP-ENF-1', 'name' => 'موظف الإنفاذ']);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', ['application_key' => 'hr.employees'])
            ->assertOk()->assertJsonPath('data.status', 'suspended');

        // قراءة: تبقى متاحة رغم التعليق.
        $this->withToken($auth['token'])->getJson("/api/employees/{$employee->id}")->assertOk();
        // كتابة: تُرفض.
        $this->withToken($auth['token'])->postJson('/api/employees', ['employee_no' => 'EMP-ENF-2', 'name' => 'موظف آخر'])
            ->assertStatus(403);
    }

    /** @test */
    public function nav_state_is_available_to_every_role_and_reflects_the_hidden_capability(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@nav-state.test');

        $before = $this->withToken($staff)->getJson('/api/applications/nav-state')->assertOk();
        $this->assertFalse($before['data']['hr.employees']);

        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'hr.employees'])->assertOk();

        $after = $this->withToken($staff)->getJson('/api/applications/nav-state')->assertOk();
        $this->assertTrue($after['data']['hr.employees']);
    }
}
