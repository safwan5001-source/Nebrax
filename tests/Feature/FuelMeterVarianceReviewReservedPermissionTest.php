<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Support\FuelStaffTemplates;
use App\Support\Rbac;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * TANKER-PR8-S — `fuel.shift.meter_variance_review` محجوزة خارج المنح التلقائي، **دون سحب أي منحة فردية قائمة**.
 *
 * `RESERVED` يُقرأ في ثلاثة مواضع فقط (منع الفاعل غير الأعلى من إضافتها، واستبعادها من «كل صلاحيات الوقود»، واستبعادها من قائمة المفوَّض)؛ الأدوار المخزَّنة لا تُقرأ ولا تُعدَّل.
 */
class FuelMeterVarianceReviewReservedPermissionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations/staff';
    private const KEY = 'fuel.shift.meter_variance_review';

    /** @test */
    public function the_permission_is_reserved_and_never_part_of_any_builtin_role_or_template(): void
    {
        $this->assertContains(self::KEY, Rbac::PERMISSIONS);
        $this->assertContains(self::KEY, FuelStaffTemplates::RESERVED);
        foreach (Rbac::MATRIX as $role => $permissions) {
            $this->assertNotContains(self::KEY, $permissions, "{$role} must not receive it implicitly");
        }
        foreach (FuelStaffTemplates::all() as $key => $template) {
            $this->assertNotContains(self::KEY, $template['permissions'], "template {$key}");
        }
        foreach (['accountant', 'staff', 'self_service'] as $role) {
            $this->assertFalse(Rbac::allows($role, self::KEY), $role);
        }
        $this->assertTrue(Rbac::allows('owner', self::KEY));
        $this->assertTrue(Rbac::allows('admin', self::KEY));
        $this->assertNotContains(self::KEY, FuelStaffTemplates::grantableAll(['*']), '«كل صلاحيات الوقود» لا يمنحها');
    }

    /** @test */
    public function grant_all_fuel_does_not_hand_it_out_but_the_owner_can_grant_it_explicitly(): void
    {
        $this->buildFixture();
        $e = $this->makeUser('emp-all', 'staff');
        $all = $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $e['user']->id, ['grant_all_fuel' => true])->assertOk()->json('data.fuel_permissions');
        $this->assertNotContains(self::KEY, $all);

        $granted = $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $e['user']->id, ['add_permissions' => [self::KEY]])->assertOk()->json('data.fuel_permissions');
        $this->assertContains(self::KEY, $granted);
        $this->assertTrue(Rbac::allows($e['user']->fresh()->role, self::KEY));
    }

    /** @test */
    public function a_delegated_manager_cannot_grant_it_even_when_they_hold_it_themselves(): void
    {
        $this->buildFixture();
        $mgr = $this->makeUser('mgr-holder', 'fuel-b3-mgr-holder', [...$this->managerPermissions(), self::KEY]);
        $e = $this->makeUser('emp-target', 'staff');

        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $e['user']->id, ['add_permissions' => [self::KEY]])->assertForbidden();
        $this->assertFalse(Rbac::allows($e['user']->fresh()->role, self::KEY));

        $templates = $this->withToken($mgr['token'])->getJson(self::BASE . '/templates')->assertOk()->json('data');
        $this->assertNotContains(self::KEY, $templates['delegable'], 'قائمة المفوَّض لغير الأعلى لا تشمله');
        $this->assertContains(self::KEY, $templates['reserved']);
        $owner = $this->withToken($this->fx['owner'])->getJson(self::BASE . '/templates')->json('data');
        $this->assertContains(self::KEY, $owner['delegable'], 'المالك/المسؤول الأعلى يمنحها صراحةً');
    }

    /** @test */
    public function an_existing_explicit_grant_survives_the_reservation_and_later_updates_that_do_not_replace_the_set(): void
    {
        $this->buildFixture();
        $e = $this->makeUser('emp-keep', 'staff');
        // منحة فردية قائمة (كما لو مُنحت قبل الحجز): تُخزَّن في دور الموظف الشخصي بأي مسار؛ نحاكيها بمنحٍ صريحٍ من المالك ثم نتحقق من أن كل تحديث لاحق لا يسحبها.
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $e['user']->id, ['add_permissions' => [self::KEY, 'fuel.shift.view']])->assertOk();
        $role = fn () => Role::where('slug', $e['user']->fresh()->role)->firstOrFail()->permissions;
        $this->assertContains(self::KEY, $role());

        // تحديث بلا قالب: نطاق المحطات.
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $e['user']->id, ['station_ids' => [$this->fx['s1']->id]])->assertOk();
        $this->assertContains(self::KEY, $role());
        // «كل صلاحيات الوقود» فوق الحالي: تُضاف الأخرى وتبقى المحجوزة الممنوحة.
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $e['user']->id, ['grant_all_fuel' => true])->assertOk();
        $this->assertContains(self::KEY, $role());
        // إضافة صلاحية أخرى بلا قالب.
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $e['user']->id, ['add_permissions' => ['fuel.sale.view']])->assertOk();
        $this->assertContains(self::KEY, $role());
        // السحب الصريح وحده يزيلها.
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $e['user']->id, ['remove_permissions' => [self::KEY]])->assertOk();
        $this->assertNotContains(self::KEY, $role());
    }

    /** @test */
    public function a_delegated_manager_who_holds_it_can_still_adjust_the_scope_of_an_existing_holder_without_stripping_it(): void
    {
        $this->buildFixture();
        $e = $this->makeUser('emp-scope', 'staff');
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/' . $e['user']->id, ['add_permissions' => [self::KEY, 'fuel.shift.view']])->assertOk();
        $mgr = $this->makeUser('mgr-scope', 'fuel-b3-mgr-scope', [...$this->managerPermissions(), self::KEY]);

        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $e['user']->id, ['station_ids' => [$this->fx['s1']->id]])->assertOk()->assertJsonPath('data.station_ids', [$this->fx['s1']->id]);
        $this->assertContains(self::KEY, Role::where('slug', $e['user']->fresh()->role)->firstOrFail()->permissions);
        // لكنه لا يضيفها لغيره.
        $other = $this->makeUser('emp-other', 'staff');
        $this->withToken($mgr['token'])->putJson(self::BASE . '/' . $other['user']->id, ['add_permissions' => [self::KEY]])->assertForbidden();
    }

    /** @test */
    public function reserving_the_permission_does_not_rewrite_any_stored_role(): void
    {
        $this->buildFixture();
        $holder = $this->makeUser('emp-stored', 'fuel-stored-meter-reviewer', ['fuel.shift.view', self::KEY]);
        $before = Role::where('slug', 'fuel-stored-meter-reviewer')->firstOrFail()->permissions;

        $this->assertTrue(Rbac::allows('fuel-stored-meter-reviewer', self::KEY), 'منحة مخزَّنة قائمة تبقى سارية بعد الحجز');
        $this->assertSame($before, Role::where('slug', 'fuel-stored-meter-reviewer')->firstOrFail()->permissions);
        $this->assertInstanceOf(User::class, $holder['user']);
    }
}
