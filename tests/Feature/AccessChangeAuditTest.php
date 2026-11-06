<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * FUEL-B3 — سجل تدقيق تغييرات الأدوار والصلاحيات ونطاق الوصول (`access_change_events`):
 *  - يغطّي مسارات الأدوار والمستخدمين العامة (لوحة ERP) وإدارة موظفي الوقود، فلا يُتجاوز التدقيق من أي واجهة.
 *  - الفاعل والمستهدف والقبل/بعد والتاريخ، ومحاولات الرفض (403/422) برمز الرفض دون أسرار.
 *  - غير قابل للتعديل/الحذف في القاعدة (SQLite وPostgreSQL)، ويزول مع المستأجر وحده.
 */
class AccessChangeAuditTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private function events(?string $action = null)
    {
        $q = DB::table('access_change_events')->where('tenant_id', $this->tenantId)->orderBy('occurred_at')->orderBy('id');

        return ($action === null ? $q : $q->where('action', $action))->get();
    }

    /** @return array<string,mixed>|null */
    private function col(object $row, string $col): ?array
    {
        return $row->$col === null ? null : json_decode($row->$col, true);
    }

    // ───────────────────────── الأدوار ─────────────────────────

    /** @test */
    public function the_general_roles_screen_is_audited_for_create_update_and_delete_with_the_actor(): void
    {
        $this->buildFixture();
        $ownerId = User::where('tenant_id', $this->tenantId)->where('role', 'owner')->value('id');
        $o = $this->fx['owner'];

        $role = $this->withToken($o)->postJson('/api/roles', ['name' => 'دور تدقيق', 'permissions' => ['fuel_stations.view', 'fuel.shift.view']])->assertCreated()->json('data');
        $this->withToken($o)->putJson('/api/roles/' . $role['id'], ['name' => 'دور تدقيق', 'permissions' => ['fuel_stations.view', 'fuel.shift.view']])->assertOk(); // بلا تغيير ⇒ بلا حدث
        $this->withToken($o)->putJson('/api/roles/' . $role['id'], ['name' => 'دور معدّل', 'permissions' => ['fuel_stations.view', 'fuel.shift.open']])->assertOk();
        $this->withToken($o)->deleteJson('/api/roles/' . $role['id'])->assertOk();

        $rows = $this->events()->filter(fn ($r) => $r->subject_type === 'role' && $r->subject_id === $role['id'])->values();
        $this->assertSame(['role.created', 'role.updated', 'role.deleted'], $rows->pluck('action')->all(), 'التعديل بلا تغيير لا يُنتج حدثاً');
        foreach ($rows as $row) {
            $this->assertSame($ownerId, $row->actor_id);
            $this->assertSame('applied', $row->outcome);
            $this->assertNotNull($row->occurred_at);
        }
        $this->assertNull($this->col($rows[0], 'before'));
        $this->assertSame(['fuel.shift.view', 'fuel_stations.view'], $this->col($rows[0], 'after')['permissions']);
        $this->assertSame('دور تدقيق', $this->col($rows[1], 'before')['name']);
        $this->assertSame(['name' => 'دور معدّل', 'permissions' => ['fuel.shift.open', 'fuel_stations.view']], $this->col($rows[1], 'after'));
        $this->assertNull($this->col($rows[2], 'after'));
    }

    // ───────────────────────── المستخدمون ─────────────────────────

    /** @test */
    public function the_general_users_screen_is_audited_and_never_stores_a_password_or_an_email(): void
    {
        $this->buildFixture();
        $o = $this->fx['owner'];
        $secret = 'Sup3r-Secret-Value!';

        $created = $this->withToken($o)->postJson('/api/users', [
            'name' => 'موظف تدقيق', 'email' => 'audit-user@fuel-b3.test', 'password' => $secret, 'role' => 'staff', 'branch_ids' => [$this->fx['branchA']->id],
        ])->assertCreated()->json('data');
        $this->withToken($o)->putJson('/api/users/' . $created['id'], ['role' => 'accountant', 'is_active' => false, 'password' => $secret . '2'])->assertOk();
        $this->withToken($o)->deleteJson('/api/users/' . $created['id'])->assertOk();

        $rows = $this->events()->filter(fn ($r) => $r->subject_type === 'user' && $r->subject_id === $created['id'])->values();
        $this->assertSame(['user.created', 'user.updated', 'user.deleted'], $rows->pluck('action')->all());
        $this->assertSame('staff', $this->col($rows[0], 'after')['role']);
        $this->assertSame([$this->fx['branchA']->id], $this->col($rows[0], 'after')['branch_ids']);
        $this->assertSame('staff', $this->col($rows[1], 'before')['role']);
        $this->assertSame('accountant', $this->col($rows[1], 'after')['role']);
        $this->assertFalse($this->col($rows[1], 'before')['password_changed']);
        $this->assertTrue($this->col($rows[1], 'after')['password_changed']);
        $this->assertSame($created['id'], $rows[1]->target_user_id);

        $dump = json_encode(DB::table('access_change_events')->get());
        $this->assertStringNotContainsString($secret, $dump);
        $this->assertStringNotContainsString('audit-user@fuel-b3.test', $dump);
    }

    // ───────────────────────── المحاولات المرفوضة ─────────────────────────

    /** @test */
    public function rejected_role_and_user_changes_are_recorded_as_denied_with_the_attempt_and_no_secrets(): void
    {
        $this->buildFixture();
        // مدير أدوار ومستخدمين بصلاحيات محدودة: كل ما يتجاوز سقفه يُرفض ويُسجَّل.
        $m = $this->makeUser('rolemgr', 'fuel-b3-rolemgr', ['roles.view', 'roles.manage', 'users.view', 'users.manage', 'fuel_stations.view']);
        $target = $this->makeUser('victim', 'staff');
        $before = DB::table('access_change_events')->where('outcome', 'denied')->count();

        $this->withToken($m['token'])->postJson('/api/roles', ['name' => 'تصعيد', 'permissions' => ['fuel.governance.manage', 'fuel_stations.view']])->assertForbidden();
        $this->withToken($m['token'])->putJson('/api/users/' . $target['user']->id, ['role' => 'admin', 'password' => 'Hidden-Pass-123'])->assertForbidden();
        $this->withToken($m['token'])->deleteJson('/api/roles/' . Role::where('slug', 'accountant')->value('id'))->assertStatus(422); // دور نظامي

        $denied = DB::table('access_change_events')->where('outcome', 'denied')->orderBy('occurred_at')->orderBy('id')->get();
        $this->assertSame($before + 3, $denied->count());
        $byAction = $denied->keyBy('action');
        $this->assertSame($m['user']->id, $byAction['role.created']->actor_id);
        $this->assertSame(['fuel.governance.manage', 'fuel_stations.view'], $this->col($byAction['role.created'], 'after')['permissions']);
        $this->assertStringStartsWith('403:', $byAction['role.created']->denial_reason);
        $this->assertSame('admin', $this->col($byAction['user.updated'], 'after')['role']);
        $this->assertTrue($this->col($byAction['user.updated'], 'after')['password_changed']);
        $this->assertStringStartsWith('422:', $byAction['role.deleted']->denial_reason);
        $this->assertStringNotContainsString('Hidden-Pass-123', json_encode(DB::table('access_change_events')->get()));

        // لم يحدث أي تغيير فعلي.
        $this->assertSame('staff', $target['user']->fresh()->role);
        $this->assertSame(0, Role::where('name', 'تصعيد')->count());
        $this->assertSame(0, $this->events('role.created')->where('outcome', 'applied')->count());
    }

    /** @test */
    public function rejected_fuel_staff_attempts_are_recorded_including_self_escalation_and_top_accounts(): void
    {
        $this->buildFixture();
        $mgr = $this->makeUser('mgr', 'fuel-b3-mgr', $this->managerPermissions());
        $owner = User::where('tenant_id', $this->tenantId)->where('role', 'owner')->firstOrFail();
        $base = '/api/fuel-stations/staff/';

        $this->withToken($mgr['token'])->putJson($base . $mgr['user']->id, ['template' => 'station_manager', 'add_permissions' => ['fuel.governance.manage']])->assertForbidden();
        $this->withToken($mgr['token'])->putJson($base . $owner->id, ['template' => 'seller'])->assertForbidden();

        $denied = $this->events('fuel_staff.updated')->where('outcome', 'denied')->values();
        $this->assertCount(2, $denied);
        $this->assertSame($mgr['user']->id, $denied[0]->actor_id);
        $this->assertSame($mgr['user']->id, $denied[0]->target_user_id);
        $this->assertSame(['fuel.governance.manage'], $this->col($denied[0], 'after')['add_permissions']);
        $this->assertSame($owner->id, $denied[1]->target_user_id);
        $this->assertSame(0, $this->events('fuel_staff.updated')->where('outcome', 'applied')->count());
    }

    // ───────────────────────── إسناد الوقود ─────────────────────────

    /** @test */
    public function a_fuel_staff_change_is_audited_atomically_with_actor_target_before_after_and_reason(): void
    {
        $this->buildFixture();
        $e = $this->makeUser('emp1', 'staff');
        $ownerId = User::where('tenant_id', $this->tenantId)->where('role', 'owner')->value('id');
        $s1 = $this->fx['s1']->id;

        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/staff/' . $e['user']->id, ['template' => 'seller', 'station_ids' => [$s1], 'reason' => 'تعيين'])->assertOk();

        $applied = $this->events('fuel_staff.updated')->where('outcome', 'applied')->values();
        $this->assertCount(1, $applied);
        $row = $applied[0];
        $this->assertSame($ownerId, $row->actor_id);
        $this->assertSame($e['user']->id, $row->target_user_id);
        $this->assertSame('fuel_staff', $row->subject_type);
        $this->assertSame('تعيين', $row->reason);
        $before = $this->col($row, 'before');
        $after = $this->col($row, 'after');
        $this->assertSame('staff', $before['role']);
        $this->assertStringStartsWith('fuel-staff-', $after['role']);
        $this->assertSame('seller', $after['template']);
        $this->assertSame([$s1], $after['station_ids']);
        $this->assertSame('assigned', $after['fuel_station_scope']);

        // فشل (محطة غير موجودة) ⇒ لا دور شخصي جديد ولا تغيير ولا حدث «مطبَّق»، فقط رفض مسجَّل.
        $rolesBefore = Role::where('slug', 'like', 'fuel-staff-%')->count();
        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/staff/' . $e['user']->id, ['template' => 'station_manager', 'station_ids' => ['00000000-0000-4000-8000-000000000999']])->assertStatus(422);
        $this->assertSame($rolesBefore, Role::where('slug', 'like', 'fuel-staff-%')->count());
        $this->assertSame('seller', $this->withToken($this->fx['owner'])->getJson('/api/fuel-stations/staff/' . $e['user']->id)->json('data.template'));
        $this->assertCount(1, $this->events('fuel_staff.updated')->where('outcome', 'applied'));
        $this->assertCount(1, $this->events('fuel_staff.updated')->where('outcome', 'denied'));
    }

    // ───────────────────────── عدم القابلية للتعديل والعزل ─────────────────────────

    /** @test */
    public function audit_rows_cannot_be_updated_or_deleted_even_with_raw_sql(): void
    {
        $this->buildFixture();
        $this->withToken($this->fx['owner'])->postJson('/api/roles', ['name' => 'دور', 'permissions' => ['fuel_stations.view']])->assertCreated();
        $id = (string) DB::table('access_change_events')->where('tenant_id', $this->tenantId)->value('id');

        foreach ([
            fn () => DB::table('access_change_events')->where('id', $id)->update(['action' => 'tampered']),
            fn () => DB::table('access_change_events')->where('id', $id)->delete(),
            fn () => DB::table('access_change_events')->where('tenant_id', $this->tenantId)->delete(),
        ] as $attempt) {
            try {
                // نقطة حفظ لكل محاولة: على PostgreSQL يُفسد أي خطأ قاعدة معاملةَ الاختبار الغلافية (25P02) ما لم يُعزل.
                DB::transaction($attempt);
                $this->fail('audit row must be immutable');
            } catch (QueryException) {
                $this->addToAssertionCount(1);
            }
        }
        $this->assertSame('role.created', DB::table('access_change_events')->where('id', $id)->value('action'));
    }

    /** @test */
    public function the_model_is_append_only_and_events_are_isolated_per_tenant_and_cascade_with_the_tenant(): void
    {
        $this->buildFixture();
        $this->withToken($this->fx['owner'])->postJson('/api/roles', ['name' => 'دور', 'permissions' => ['fuel_stations.view']])->assertCreated();
        $event = \App\Models\AccessChangeEvent::query()->firstOrFail();
        try {
            $event->update(['action' => 'x']);
            $this->fail('model must reject update');
        } catch (\LogicException) {
            $this->addToAssertionCount(1);
        }
        try {
            $event->delete();
            $this->fail('model must reject delete');
        } catch (\LogicException) {
            $this->addToAssertionCount(1);
        }

        // مستأجر آخر: أحداثه له وحده، ولا يرى الأول (BaseModel) أحداثه.
        $other = $this->registerTenant('globex-audit', 'owner@globex-audit.test', autoEnableApplications: true);
        $this->withToken($other['token'])->postJson('/api/roles', ['name' => 'دور آخر', 'permissions' => ['fuel_stations.view']])->assertCreated();
        $this->assertSame(1, DB::table('access_change_events')->where('tenant_id', $other['tenant_id'])->count());
        $this->assertSame(1, DB::table('access_change_events')->where('tenant_id', $this->tenantId)->count());

        // حذف المستأجر يزيل أحداثه وحدها (المشغّل يمنع حذف الحدث ما دام المستأجر موجوداً فقط).
        DB::table('tenants')->where('id', $other['tenant_id'])->delete();
        $this->assertSame(0, DB::table('access_change_events')->where('tenant_id', $other['tenant_id'])->count());
        $this->assertSame(1, DB::table('access_change_events')->where('tenant_id', $this->tenantId)->count());
    }
}
