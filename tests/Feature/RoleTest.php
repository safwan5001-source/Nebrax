<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * الأدوار القابلة للضبط — الوحدة الثالثة، مشروعٌ أمنيٌّ حسّاس.
 * تشغيل:  php artisan test --filter=RoleTest
 */
class RoleTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function registration_seeds_the_four_system_roles(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $slugs = Role::pluck('slug')->sort()->values()->all();
        $this->assertSame(['accountant', 'admin', 'owner', 'staff'], $slugs);
        $this->assertTrue(Role::where('slug', 'owner')->first()->is_system);
    }

    /** @test */
    public function system_roles_carry_the_matrix_permissions_verbatim(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $this->assertSame(['*'], Role::where('slug', 'owner')->first()->permissions);

        $staff = Role::where('slug', 'staff')->first()->permissions;
        $this->assertContains('invoices.view', $staff);
        $this->assertNotContains('invoices.manage', $staff);
    }

    /** @test */
    public function rbac_resolves_permissions_from_the_role_table(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        // قبل التعديل: staff يقرأ الفواتير ولا يديرها (نسخة المصفوفة).
        $this->assertTrue(Rbac::allows('staff', 'invoices.view'));
        $this->assertFalse(Rbac::allows('staff', 'invoices.manage'));

        // بعد منح staff صلاحية الإدارة في الجدول → القرار يتبع الجدول فوراً.
        Role::where('slug', 'staff')->first()->update([
            'permissions' => ['invoices.view', 'invoices.manage'],
        ]);
        $this->assertTrue(Rbac::allows('staff', 'invoices.manage'));
    }

    /** @test */
    public function a_custom_role_drives_enforcement_end_to_end(): void
    {
        $auth = $this->registerTenant();

        // دورٌ مخصَّص يرى الفواتير فقط.
        $role = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'مطّلع', 'permissions' => ['invoices.view'],
        ])->assertCreated()['data'];

        $token = $this->tokenForRole($auth['tenant_id'], $role['slug'], 'viewer@acme.test');

        // يقرأ الفواتير، ولا يُنشئها (403 من الحارس لا 422 من التحقّق).
        $this->withToken($token)->getJson('/api/invoices')->assertOk();
        $this->withToken($token)->postJson('/api/invoices', [])->assertStatus(403);

        // امنحه الإدارة → يتجاوز الحارس (يصل للتحقّق فيردّ 422 لا 403).
        $this->withToken($auth['token'])->putJson("/api/roles/{$role['id']}", [
            'name' => 'مطّلع', 'permissions' => ['invoices.view', 'invoices.manage'],
        ])->assertOk();
        $this->withToken($token)->postJson('/api/invoices', [])->assertStatus(422);
    }

    /** @test */
    public function the_owner_role_is_immutable(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $ownerId = Role::where('slug', 'owner')->first()->id;

        $this->withToken($auth['token'])->putJson("/api/roles/{$ownerId}", [
            'name' => 'المالك', 'permissions' => ['invoices.view'],
        ])->assertStatus(422);

        $this->assertSame(['*'], Role::where('slug', 'owner')->first()->permissions);
    }

    /** @test */
    public function a_system_role_cannot_be_deleted(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $staffId = Role::where('slug', 'staff')->first()->id;

        $this->withToken($auth['token'])->deleteJson("/api/roles/{$staffId}")->assertStatus(422);
        $this->assertNotNull(Role::where('slug', 'staff')->first());
    }

    /** @test */
    public function a_custom_role_rejects_wildcard_and_unknown_permissions(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'خارق', 'permissions' => ['*'],
        ])->assertStatus(422)->assertJsonValidationErrors('permissions.0');

        $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'وهمي', 'permissions' => ['invoices.destroy_everything'],
        ])->assertStatus(422)->assertJsonValidationErrors('permissions.0');
    }

    /** @test */
    public function a_role_assigned_to_a_user_cannot_be_deleted(): void
    {
        $auth = $this->registerTenant();
        $role = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'كاشير', 'permissions' => ['invoices.view'],
        ])->assertCreated()['data'];

        $this->tokenForRole($auth['tenant_id'], $role['slug'], 'cashier@acme.test');

        $this->withToken($auth['token'])->deleteJson("/api/roles/{$role['id']}")->assertStatus(422);
    }

    /** @test */
    public function an_unassigned_custom_role_can_be_deleted(): void
    {
        $auth = $this->registerTenant();
        $role = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'مؤقّت', 'permissions' => ['reports.view'],
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->deleteJson("/api/roles/{$role['id']}")->assertOk();
    }

    /** @test */
    public function roles_are_isolated_per_tenant(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $this->withToken($a['token'])->postJson('/api/roles', [
            'name' => 'خاص بأكمي', 'permissions' => ['reports.view'],
        ])->assertCreated();

        $b = $this->registerTenant('other', 'owner@other.test');
        // مؤسسة أخرى ترى أدوارها النظامية الأربعة فقط، لا الدور المخصَّص لأكمي.
        $this->withToken($b['token'])->getJson('/api/roles')->assertOk()->assertJsonCount(4, 'data');
    }

    /** @test */
    public function role_management_requires_the_roles_permission(): void
    {
        $auth = $this->registerTenant();
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $this->withToken($staff)->getJson('/api/roles')->assertStatus(403);
        $this->withToken($staff)->postJson('/api/roles', [
            'name' => 'محاولة', 'permissions' => ['reports.view'],
        ])->assertStatus(403);
    }

    /** @test */
    public function the_index_exposes_the_permission_catalogue_and_user_counts(): void
    {
        $auth = $this->registerTenant();

        $res = $this->withToken($auth['token'])->getJson('/api/roles')->assertOk();
        $res->assertJsonPath('meta.permissions', Rbac::PERMISSIONS);
        // المالك المسجَّل مسنَدٌ لدور owner → عدّه واحد على الأقلّ.
        $owner = collect($res['data'])->firstWhere('slug', 'owner');
        $this->assertSame(1, $owner['users_count']);
    }
}
