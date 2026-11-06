<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Support\FuelStaffTemplates;
use App\Support\Rbac;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * FUEL-B3 — إدارة موظفي المحطات: القوالب، الصلاحيات الفردية، «كل صلاحيات الوقود»، حدود التفويض، التصعيد الذاتي، نطاق الفاعل، التزامن (revision).
 */
class FuelStaffAccessTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations/staff';

    // ───────────────────────── القوالب ─────────────────────────

    /** @test */
    public function templates_are_fuel_only_nested_and_never_carry_accounting_admin_or_reserved_keys(): void
    {
        $all = FuelStaffTemplates::all();
        $this->assertSame(['seller', 'supervisor', 'station_manager'], array_keys($all));

        foreach ($all as $key => $template) {
            foreach ($template['permissions'] as $permission) {
                $this->assertContains($permission, Rbac::PERMISSIONS, "{$key}: {$permission} must exist");
                $this->assertTrue(FuelStaffTemplates::isFuelDomain($permission), "{$key}: {$permission} must be a fuel key");
            }
            foreach (['fuel.governance.manage', 'fuel.staff.manage', 'fuel_stations.manage', 'products.view_cost', 'accounts.manage', 'users.manage', 'roles.manage', '*'] as $forbidden) {
                $this->assertNotContains($forbidden, $template['permissions'], "{$key} must not contain {$forbidden}");
            }
        }
        $this->assertEmpty(array_diff($all['seller']['permissions'], $all['supervisor']['permissions']));
        $this->assertEmpty(array_diff($all['supervisor']['permissions'], $all['station_manager']['permissions']));
        $this->assertNotEmpty(array_diff($all['station_manager']['permissions'], $all['supervisor']['permissions']));
        // البائع لا يعتمد ولا يسجّل استلاماً؛ المشرف لا يعتمد استلاماً ولا تسوية؛ المدير يعتمد.
        $this->assertNotContains('fuel.delivery.create', $all['seller']['permissions']);
        $this->assertNotContains('fuel.delivery.approve', $all['supervisor']['permissions']);
        $this->assertContains('fuel.delivery.approve', $all['station_manager']['permissions']);
        $this->assertContains('fuel.shift.approve', $all['supervisor']['permissions']);
    }

    /** @test */
    public function the_staff_key_exists_and_is_never_granted_to_builtin_roles(): void
    {
        $this->assertContains('fuel.staff.manage', Rbac::PERMISSIONS);
        foreach (['accountant', 'staff', 'self_service'] as $role) {
            $this->assertFalse(Rbac::allows($role, 'fuel.staff.manage'), $role);
        }
        $this->assertTrue(Rbac::allows('owner', 'fuel.staff.manage'));
        $this->assertTrue(Rbac::allows('admin', 'fuel.staff.manage'));
        // الأدوار الشخصية لا تتسرب إلى MATRIX.
        $this->assertArrayNotHasKey('fuel-staff-xxxxxxxx', Rbac::MATRIX);
    }

    // ───────────────────────── الإسناد والعزل بين الموظفين ─────────────────────────

    /** @test */
    public function assigning_a_template_creates_a_personal_role_and_leaves_other_employees_and_the_shared_role_untouched(): void
    {
        $this->buildFixture();
        $e1 = $this->makeUser('emp1', 'staff');
        $e2 = $this->makeUser('emp2', 'staff');
        $staffRolePermissions = Role::where('slug', 'staff')->value('permissions');

        $res = $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $e1['user']->id, [
            'template' => 'seller', 'station_ids' => [$this->fx['s1']->id], 'reason' => 'تعيين بائع',
        ])->assertOk();

        $res->assertJsonPath('data.template', 'seller')->assertJsonPath('data.fuel_permissions', FuelStaffTemplates::permissions('seller'))
            ->assertJsonPath('data.station_ids', [$this->fx['s1']->id])->assertJsonPath('data.fuel_station_scope', 'assigned');
        $e1['user']->refresh();
        $this->assertStringStartsWith('fuel-staff-', $e1['user']->role);
        $this->assertSame('assigned', $e1['user']->fuel_station_scope);

        // الدور الشخصي = قالب البائع + الصلاحيات غير الوقودية القائمة (خط أساس staff) — لا يُسحب منه شيء ولا يُمنح شيء آخر.
        $personal = Role::where('slug', $e1['user']->role)->firstOrFail();
        $this->assertEqualsCanonicalizing([...$staffRolePermissions, ...FuelStaffTemplates::permissions('seller')], $personal->permissions);
        $this->assertFalse((bool) $personal->is_system);
        $this->assertTrue(Rbac::allows($personal->slug, 'fuel.shift.open'));
        $this->assertFalse(Rbac::allows($personal->slug, 'fuel.delivery.approve'));
        $this->assertFalse(Rbac::allows($personal->slug, 'fuel_stations.manage'));

        // الموظف الآخر والدور المشترك لم يتغيّرا.
        $e2['user']->refresh();
        $this->assertSame('staff', $e2['user']->role);
        $this->assertNull($e2['user']->fuel_station_scope);
        $this->assertSame($staffRolePermissions, Role::where('slug', 'staff')->value('permissions'));
        $this->assertFalse(Rbac::allows('staff', 'fuel.shift.open'));
    }

    /** @test */
    public function individual_tweaks_change_only_that_employee_and_not_the_template(): void
    {
        $this->buildFixture();
        $e1 = $this->makeUser('emp1', 'staff');
        $e2 = $this->makeUser('emp2', 'staff');
        $owner = $this->fx['owner'];
        foreach ([$e1, $e2] as $e) {
            $this->withToken($owner)->putJson(self::BASE . '/' . $e['user']->id, ['template' => 'supervisor', 'station_ids' => [$this->fx['s1']->id]])->assertOk();
        }
        $before2 = $this->withToken($owner)->getJson(self::BASE . '/' . $e2['user']->id)->assertOk()->json('data');

        $res = $this->withToken($owner)->putJson(self::BASE . '/' . $e1['user']->id, [
            'add_permissions' => ['fuel.alerts.manage'], 'remove_permissions' => ['fuel.reconciliation.create'],
        ])->assertOk()->json('data');

        $this->assertSame('custom', $res['template']);
        $this->assertContains('fuel.alerts.manage', $res['fuel_permissions']);
        $this->assertNotContains('fuel.reconciliation.create', $res['fuel_permissions']);
        // الباقي من القالب محفوظ، والمحطات كما هي.
        $this->assertContains('fuel.delivery.create', $res['fuel_permissions']);
        $this->assertSame([$this->fx['s1']->id], $res['station_ids']);

        $after2 = $this->withToken($owner)->getJson(self::BASE . '/' . $e2['user']->id)->assertOk()->json('data');
        $this->assertSame($before2, $after2, 'الموظف الآخر لم يتغيّر بتاتاً');
        $this->assertSame(FuelStaffTemplates::permissions('supervisor'), $after2['fuel_permissions']);
        $templates = $this->withToken($owner)->getJson(self::BASE . '/templates')->assertOk()->json('data.templates');
        $this->assertSame(FuelStaffTemplates::permissions('supervisor'), collect($templates)->firstWhere('key', 'supervisor')['permissions']);
    }

    /** @test */
    public function the_remove_list_wins_over_the_template_and_clearing_the_template_clears_all_fuel_permissions(): void
    {
        $this->buildFixture();
        $e = $this->makeUser('emp1', 'staff');
        $owner = $this->fx['owner'];

        $res = $this->withToken($owner)->putJson(self::BASE . '/' . $e['user']->id, ['template' => 'seller', 'remove_permissions' => ['fuel.shift.close'], 'station_ids' => []])->assertOk()->json('data');
        $this->assertNotContains('fuel.shift.close', $res['fuel_permissions']);
        $this->assertContains('fuel.shift.open', $res['fuel_permissions']);

        $cleared = $this->withToken($owner)->putJson(self::BASE . '/' . $e['user']->id, ['template' => null])->assertOk()->json('data');
        $this->assertSame([], $cleared['fuel_permissions']);
        $this->assertSame('none', $cleared['template']);
        $this->assertSame('assigned', $cleared['fuel_station_scope']);
        $this->assertSame([], $cleared['station_ids']); // بلا محطة ⇒ لا وصول (فشل مغلق)
    }

    /** @test */
    public function grant_all_fuel_expands_to_the_catalog_the_actor_may_delegate_and_never_to_reserved_keys(): void
    {
        $this->buildFixture();
        $e = $this->makeUser('emp1', 'staff');
        $mgr = $this->makeUser('mgr', 'fuel-b3-mgr', $this->managerPermissions());

        // المالك: الكتالوج كله عدا المحجوز.
        $owner = $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $e['user']->id, ['grant_all_fuel' => true, 'station_ids' => []])->assertOk()->json('data.fuel_permissions');
        $this->assertEqualsCanonicalizing(array_values(array_diff(FuelStaffTemplates::catalog(), FuelStaffTemplates::RESERVED)), $owner);
        $this->assertNotContains('fuel.governance.manage', $owner);
        $this->assertNotContains('fuel.staff.manage', $owner);

        // المدير: ما يملكه فقط (لا يوسّع بـ«الكل» سقفه).
        $e2 = $this->makeUser('emp2', 'staff');
        $granted = $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $e2['user']->id, ['grant_all_fuel' => true])->assertOk()->json('data.fuel_permissions');
        $this->assertEmpty(array_diff($granted, $this->managerPermissions()));
        $this->assertNotContains('fuel.staff.manage', $granted);
        $this->assertNotContains('fuel.sale.price.manage', $granted); // لا يملكها المدير فلا يفوّضها
    }

    // ───────────────────────── حدود التفويض والتصعيد ─────────────────────────

    /** @test */
    public function the_endpoints_require_the_staff_permission(): void
    {
        $this->buildFixture();
        $legacy = $this->makeUser('legacy', 'fuel-b3-legacy', ['fuel_stations.view', 'fuel_stations.manage']);
        $e = $this->makeUser('emp1', 'staff');

        foreach (['get' => self::BASE, 'get2' => self::BASE . '/templates', 'get3' => self::BASE . '/' . $e['user']->id] as $url) {
            $this->withToken($legacy['token'])->getJson($url)->assertForbidden();
        }
        $this->withToken($legacy['token'])->putJson(self::BASE . '/' . $e['user']->id, ['template' => 'seller'])->assertForbidden();
        $this->withToken($e['token'])->putJson(self::BASE . '/' . $e['user']->id, ['template' => 'station_manager'])->assertForbidden();
    }

    /** @test */
    public function a_manager_cannot_grant_what_they_cannot_delegate(): void
    {
        $this->buildFixture();
        // مدير بصلاحيات بائع فقط + إدارة الموظفين.
        $low = $this->makeUser('lowmgr', 'fuel-b3-low', [...FuelStaffTemplates::permissions('seller'), 'fuel.staff.manage']);
        $e = $this->makeUser('emp1', 'staff');
        $id = $e['user']->id;

        $this->withToken($low['token'])->putJson(self::BASE . '/' . $id, ['template' => 'seller'])->assertOk();
        // قوالب أعلى من سقفه، أو مفتاح فردي لا يملكه.
        $this->withToken($low['token'])->putJson(self::BASE . '/' . $id, ['template' => 'supervisor'])->assertForbidden();
        $this->withToken($low['token'])->putJson(self::BASE . '/' . $id, ['template' => 'station_manager'])->assertForbidden();
        $this->withToken($low['token'])->putJson(self::BASE . '/' . $id, ['add_permissions' => ['fuel.delivery.approve']])->assertForbidden();
        // «كل الوقود» لا يتجاوز سقفه (يمنح ما يملكه فقط، بلا رفض).
        $all = $this->withToken($low['token'])->putJson(self::BASE . '/' . $id, ['grant_all_fuel' => true])->assertOk()->json('data.fuel_permissions');
        $this->assertEmpty(array_diff($all, FuelStaffTemplates::permissions('seller')));

        $this->assertFalse(Rbac::allows(User::findOrFail($id)->role, 'fuel.delivery.approve'));
    }

    /** @test */
    public function reserved_keys_are_granted_only_by_a_top_level_actor_and_never_through_templates_or_grant_all(): void
    {
        $this->buildFixture();
        $e = $this->makeUser('emp1', 'staff');
        $mgr = $this->makeUser('mgr', 'fuel-b3-mgr', [...$this->managerPermissions(), 'fuel.governance.manage']);

        // حتى مدير يملك المفتاحين لا يمنحهما (حكرٌ على `*`).
        foreach (['fuel.governance.manage', 'fuel.staff.manage'] as $reserved) {
            $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $e['user']->id, ['add_permissions' => [$reserved]])->assertForbidden();
        }
        foreach (array_keys(FuelStaffTemplates::all()) as $template) {
            $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $e['user']->id, ['template' => $template])->assertOk();
            $this->assertNotContains('fuel.governance.manage', Rbac::permissionsForRole(User::findOrFail($e['user']->id)->role));
            $this->assertNotContains('fuel.staff.manage', Rbac::permissionsForRole(User::findOrFail($e['user']->id)->role));
        }

        // المالك يمنح صراحةً (قرار واعٍ منفصل) فيظهر المفتاح، ولا يصل لغيره.
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $e['user']->id, ['add_permissions' => ['fuel.governance.manage']])->assertOk();
        $this->assertContains('fuel.governance.manage', Rbac::permissionsForRole(User::findOrFail($e['user']->id)->role));
        // ولم يتسرب إلى الدور المشترك للموظفين.
        $this->assertNotContains('fuel.governance.manage', Rbac::permissionsForRole('staff'));
    }

    /** @test */
    public function no_self_management_no_top_accounts_no_non_fuel_users_and_no_superiors(): void
    {
        $this->buildFixture();
        $mgr = $this->makeUser('mgr', 'fuel-b3-mgr', $this->managerPermissions());
        $accountant = $this->makeUser('acct', 'accountant');
        $owner = User::where('tenant_id', $this->tenantId)->where('role', 'owner')->firstOrFail();
        $admin = $this->makeUser('adm', 'admin');
        // موظف أعلى من سقف المدير (يملك مفتاحاً وقودياً لا يملكه المدير).
        $superior = $this->makeUser('sup', 'fuel-b3-sup', ['fuel_stations.view', 'fuel.sale.price.manage']);
        $peer = $this->makeUser('peer', 'fuel-b3-peer', $this->managerPermissions());

        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $mgr['user']->id, ['template' => 'station_manager'])->assertForbidden();        // نفسه
        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $owner->id, ['template' => 'seller'])->assertForbidden();                          // المالك
        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $admin['user']->id, ['template' => 'seller'])->assertForbidden();                  // المسؤول الأعلى
        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $accountant['user']->id, ['template' => 'seller'])->assertForbidden();            // صلاحيات غير وقودية
        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $superior['user']->id, ['template' => 'seller'])->assertForbidden();               // فوق سقفه
        // مدير آخر بنفس السقف تماماً: مسموح (لا تفرقة بالمنصب) — القيد سقفي لا هرمي.
        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $peer['user']->id, ['template' => 'seller'])->assertOk();

        // لا شيء تغيّر على المستهدفين المحجوبين.
        $this->assertSame('accountant', $accountant['user']->fresh()->role);
        $this->assertSame('admin', $admin['user']->fresh()->role);
        $this->assertSame('owner', $owner->fresh()->role);
        $this->assertSame('fuel-b3-sup', $superior['user']->fresh()->role);
        // والمالك نفسه لا يعدّل نفسه من هنا أيضاً.
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $owner->id, ['template' => 'seller'])->assertForbidden();
    }

    /** @test */
    public function a_station_restricted_manager_acts_only_within_their_own_stations_and_scope(): void
    {
        $this->buildFixture();
        $s1 = $this->fx['s1']->id;
        $s2 = $this->fx['s2']->id;
        $mgr = $this->makeUser('mgr', 'fuel-b3-mgr', $this->managerPermissions(), stations: [$s1]);
        $scopedEmp = $this->makeUser('emp-s1', 'staff', stations: [$s1]);
        $otherEmp = $this->makeUser('emp-s2', 'staff', stations: [$s2]);
        $wideEmp = $this->makeUser('emp-wide', 'staff'); // بلا تقييد محطات (قديم) ⇒ نطاقه أوسع من المدير

        // ضمن نطاقه: يعدّل موظفاً مقيَّداً بمحطته، ويُسند محطته.
        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $scopedEmp['user']->id, ['template' => 'seller', 'station_ids' => [$s1]])->assertOk();
        // محطة خارج نطاقه، أو موظف في محطة أخرى، أو موظف أوسع نطاقاً: كلها محجوبة.
        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $scopedEmp['user']->id, ['station_ids' => [$s1, $s2]])->assertForbidden();
        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $otherEmp['user']->id, ['template' => 'seller'])->assertForbidden();
        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $wideEmp['user']->id, ['template' => 'seller', 'station_ids' => [$s1]])->assertForbidden();
        // وقراءته: لا يرى إلا من ضمن نطاقه.
        $this->withToken($mgr['token'])->getJson(self::BASE . '/' . $otherEmp['user']->id)->assertNotFound();
        $this->withToken($mgr['token'])->getJson(self::BASE . '/' . $wideEmp['user']->id)->assertNotFound();
        $ids = collect($this->withToken($mgr['token'])->getJson(self::BASE)->assertOk()->json('data'))->pluck('user.id')->all();
        $this->assertContains($scopedEmp['user']->id, $ids);
        $this->assertNotContains($otherEmp['user']->id, $ids);
        $this->assertNotContains($wideEmp['user']->id, $ids);
        $this->assertSame([$s1], $scopedEmp['user']->fuelStations()->pluck('fuel_stations.id')->all());
    }

    /** @test */
    public function an_assigned_station_must_exist_belong_to_the_actor_and_fit_the_targets_branch_and_warehouse(): void
    {
        $this->buildFixture();
        $owner = $this->fx['owner'];
        // موظف مقيَّد بالفرع A: محطة الفرع B غير قابلة للوصول فعلياً ⇒ 422 لا إسناد خامل مضلِّل.
        $branchA = $this->makeUser('emp-a', 'staff', branches: [$this->fx['branchA']->id]);

        $this->withToken($owner)->putJson(self::BASE . '/' . $branchA['user']->id, ['template' => 'seller', 'station_ids' => [$this->fx['s3']->id]])->assertStatus(422);
        $this->withToken($owner)->putJson(self::BASE . '/' . $branchA['user']->id, ['template' => 'seller', 'station_ids' => ['00000000-0000-4000-8000-000000000999']])->assertStatus(422);
        $this->withToken($owner)->putJson(self::BASE . '/' . $branchA['user']->id, ['template' => 'seller', 'station_ids' => [$this->fx['s1']->id, $this->fx['s2']->id]])->assertOk();
        $this->assertCount(2, $branchA['user']->fuelStations()->get());
    }

    /** @test */
    public function validation_rejects_unknown_templates_non_fuel_and_wildcard_keys(): void
    {
        $this->buildFixture();
        $e = $this->makeUser('emp1', 'staff');
        $owner = $this->fx['owner'];
        $url = self::BASE . '/' . $e['user']->id;

        $this->withToken($owner)->putJson($url, ['template' => 'cashier'])->assertStatus(422);
        foreach (['*', 'users.manage', 'accounts.manage', 'products.view_cost', 'nope.nope'] as $bad) {
            $this->withToken($owner)->putJson($url, ['add_permissions' => [$bad]])->assertStatus(422);
        }
        $this->assertStringNotContainsString('fuel-staff-', User::findOrFail($e['user']->id)->role);
    }

    // ───────────────────────── التزامن (revision) ─────────────────────────

    /** @test */
    public function a_stale_revision_is_rejected_with_409_and_no_write(): void
    {
        $this->buildFixture();
        $e = $this->makeUser('emp1', 'staff');
        $owner = $this->fx['owner'];
        $url = self::BASE . '/' . $e['user']->id;

        $first = $this->withToken($owner)->putJson($url, ['template' => 'seller', 'station_ids' => []])->assertOk()->json('data.revision');
        $this->withToken($owner)->putJson($url, ['template' => 'supervisor', 'expected_revision' => $first])->assertOk();

        $response = $this->withToken($owner)->putJson($url, ['template' => 'station_manager', 'expected_revision' => $first])->assertStatus(409);
        $response->assertJsonPath('reason', 'staff_revision_conflict');
        $this->assertNotSame($first, $response->json('current_revision'));
        $this->assertSame('supervisor', $this->withToken($owner)->getJson($url)->json('data.template'));
    }

    /** @test */
    public function another_tenants_manager_cannot_see_or_change_this_tenants_staff(): void
    {
        $this->buildFixture();
        $e = $this->makeUser('emp1', 'staff');
        $foreign = $this->registerTenant('globex-b3', 'owner@globex-b3.test', autoEnableApplications: true);
        app(\App\Services\EntitlementGrantService::class)->grant(
            \App\Models\Tenant::findOrFail($foreign['tenant_id']), 'fuel_stations.core', \App\Support\EntitlementAccessMode::FULL, \App\Support\EntitlementSourceType::MANUAL,
            \Carbon\CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_b3_x', reason: 'مستأجر آخر.',
        );

        $this->withToken($foreign['token'])->putJson(self::BASE . '/' . $e['user']->id, ['template' => 'seller'])->assertNotFound();
        $this->withToken($foreign['token'])->getJson(self::BASE . '/' . $e['user']->id)->assertNotFound();
        $this->assertSame('staff', DB::table('users')->where('id', $e['user']->id)->value('role'));
        $this->assertNull(DB::table('users')->where('id', $e['user']->id)->value('fuel_station_scope'));
    }
}
