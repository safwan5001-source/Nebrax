<?php

namespace Tests\Feature;

use App\Models\AccessChangeEvent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * FUEL-B4 — واجهتا القراءة الجديدتان لشاشة إدارة الموظفين: `GET staff/candidates` و`GET staff/audit`.
 * قراءة فقط، بنطاق الفاعل، بلا أسرار، وبترقيم على الخادم.
 */
class FuelStaffAdminReadTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations';

    private function assign(string $userId, array $body, ?string $token = null): void
    {
        $this->withToken($token ?? $this->fx['owner'])->putJson(self::BASE . '/staff/' . $userId, $body)->assertOk();
    }

    /** @test */
    public function candidates_lists_only_unmanaged_active_employees_the_actor_may_manage(): void
    {
        $this->buildFixture();
        $s1 = $this->fx['s1'];
        $plain = $this->makeUser('plain', 'staff');
        $managed = $this->makeUser('managed', 'staff');
        $accountant = $this->makeUser('acct', 'accountant');
        $inactive = $this->makeUser('inactive', 'staff');
        $inactive['user']->forceFill(['is_active' => false])->save();
        $this->assign($managed['user']->id, ['template' => 'seller', 'station_ids' => [$s1->id]]);

        $rows = collect($this->withToken($this->fx['owner'])->getJson(self::BASE . '/staff/candidates')->assertOk()->json('data'));
        $ids = $rows->pluck('id')->all();

        $this->assertContains($plain['user']->id, $ids);
        $this->assertNotContains($managed['user']->id, $ids);     // مُدار أصلاً (يظهر في القائمة)
        $this->assertNotContains($accountant['user']->id, $ids);  // صلاحيات خارج مجال الوقود
        $this->assertNotContains($inactive['user']->id, $ids);
        $this->assertEqualsCanonicalizing(['id', 'name', 'email', 'is_active'], array_keys($rows->firstWhere('id', $plain['user']->id)));

        // بعد الإسناد يخرج من المرشحين ويدخل القائمة؛ لا يتغير شيء بمجرد القراءة.
        $this->assertNull($plain['user']->fresh()->fuel_station_scope);
        $this->assign($plain['user']->id, ['template' => 'supervisor', 'station_ids' => [$s1->id]]);
        $after = collect($this->withToken($this->fx['owner'])->getJson(self::BASE . '/staff/candidates')->json('data'))->pluck('id')->all();
        $this->assertNotContains($plain['user']->id, $after);
    }

    /** @test */
    public function candidates_and_audit_are_forbidden_without_the_staff_permission(): void
    {
        $this->buildFixture();
        $seller = $this->makeUser('seller', 'staff');
        $supervisor = $this->makeUser('supervisor', 'staff');
        $manager = $this->makeUser('manager', 'staff');
        $s1 = $this->fx['s1'];
        $this->assign($seller['user']->id, ['template' => 'seller', 'station_ids' => [$s1->id]]);
        $this->assign($supervisor['user']->id, ['template' => 'supervisor', 'station_ids' => [$s1->id]]);
        $this->assign($manager['user']->id, ['template' => 'station_manager', 'station_ids' => [$s1->id]]);

        foreach ([$seller, $supervisor, $manager] as $who) { // حتى مدير المحطة: القالب لا يمنح fuel.staff.manage
            $this->withToken($who['token'])->getJson(self::BASE . '/staff/candidates')->assertForbidden();
            $this->withToken($who['token'])->getJson(self::BASE . '/staff/audit')->assertForbidden();
        }
        $this->flushHeaders();
        $this->getJson(self::BASE . '/staff/audit')->assertUnauthorized();
    }

    /** @test */
    public function candidates_respect_the_actors_branch_scope(): void
    {
        $this->buildFixture();
        $inB = $this->makeUser('inb', 'staff', null, null, [$this->fx['branchB']->id]);
        $inA = $this->makeUser('ina', 'staff', null, null, [$this->fx['branchA']->id]);
        $delegate = $this->makeUser('delegate', 'fuel-b4-delegate', $this->managerPermissions(), null, [$this->fx['branchA']->id]);

        $ids = collect($this->withToken($delegate['token'])->getJson(self::BASE . '/staff/candidates')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertContains($inA['user']->id, $ids);
        $this->assertNotContains($inB['user']->id, $ids);     // خارج فرع الفاعل
        $this->assertNotContains($delegate['user']->id, $ids); // ليس نفسه
    }

    /** @test */
    public function the_audit_log_is_paginated_scoped_and_free_of_secrets_and_raw_snapshots(): void
    {
        $this->buildFixture();
        $s1 = $this->fx['s1'];
        $a = $this->makeUser('emp-a', 'staff');
        $b = $this->makeUser('emp-b', 'staff');
        $this->assign($a['user']->id, ['template' => 'seller', 'station_ids' => [$s1->id]]);
        $this->assign($a['user']->id, ['add_permissions' => ['fuel.reading.view']]);
        $this->assign($b['user']->id, ['template' => 'supervisor', 'station_ids' => [$s1->id]]);
        // محاولة مرفوضة مدقّقة (مدير لا يملك fuel.governance.manage يحاول منحها).
        $delegate = $this->makeUser('delegate', 'fuel-b4-delegate', $this->managerPermissions());
        $this->withToken($delegate['token'])->putJson(self::BASE . '/staff/' . $a['user']->id, ['add_permissions' => ['fuel.governance.manage']])->assertForbidden();

        $page = $this->withToken($this->fx['owner'])->getJson(self::BASE . '/staff/audit?per_page=2')->assertOk()->json();
        $this->assertCount(2, $page['data']);
        $this->assertSame(2, $page['meta']['per_page']);
        $this->assertGreaterThanOrEqual(4, $page['meta']['total']);
        $this->assertGreaterThan(1, $page['meta']['last_page']);

        $all = collect($this->withToken($this->fx['owner'])->getJson(self::BASE . '/staff/audit?per_page=100')->json('data'));
        $denied = $all->firstWhere('outcome', 'denied');
        $this->assertNotNull($denied);
        $this->assertSame('fuel_staff.updated', $denied['action']);
        $this->assertSame($delegate['user']->id, $denied['actor']['id']);
        $this->assertSame('emp-a', $denied['target']['name']);
        $this->assertStringContainsString('403', (string) $denied['denial_reason']);

        // التعديل الفعلي: الملخص يعرض ما أُضيف فقط، لا اللقطات الخام.
        $applied = $all->where('outcome', 'applied')->first(fn ($e) => collect($e['changes'])->contains(fn ($c) => ($c['added'] ?? []) === ['fuel.reading.view']));
        $this->assertNotNull($applied);
        foreach ($all as $event) {
            $this->assertArrayNotHasKey('before', $event);
            $this->assertArrayNotHasKey('after', $event);
        }
        $this->assertStringNotContainsString('password', strtolower((string) json_encode($all->all())));
        $this->assertStringNotContainsString('@fuel-b3.test', (string) json_encode($all->all())); // لا بريد

        // التصفية بالنتيجة والموظف.
        $this->assertSame(1, $this->withToken($this->fx['owner'])->getJson(self::BASE . '/staff/audit?outcome=denied')->json('meta.total'));
        $this->withToken($this->fx['owner'])->getJson(self::BASE . '/staff/audit?outcome=bogus')->assertStatus(422);
        $this->withToken($this->fx['owner'])->getJson(self::BASE . '/staff/audit?per_page=1000')->assertStatus(422);
    }

    /** @test */
    public function a_non_top_manager_sees_only_fuel_staff_events_inside_their_scope_and_never_role_or_user_events(): void
    {
        $this->buildFixture();
        $s1 = $this->fx['s1'];
        $inA = $this->makeUser('ina', 'staff', null, null, [$this->fx['branchA']->id]);
        $inB = $this->makeUser('inb', 'staff', null, null, [$this->fx['branchB']->id]);
        $this->assign($inA['user']->id, ['template' => 'seller', 'station_ids' => [$s1->id]]);
        $this->assign($inB['user']->id, ['template' => 'seller', 'station_ids' => [$this->fx['s3']->id]]);
        $delegate = $this->makeUser('delegate', 'fuel-b4-delegate', $this->managerPermissions(), null, [$this->fx['branchA']->id]);

        // حدث دور عام + حدث مستخدم عام يجب ألا يظهرا.
        $this->withToken($this->fx['owner'])->postJson('/api/roles', ['name' => 'دور اختبار', 'permissions' => ['fuel.shift.view']])->assertCreated();
        $this->assertGreaterThan(0, AccessChangeEvent::where('subject_type', 'role')->count());

        $rows = collect($this->withToken($delegate['token'])->getJson(self::BASE . '/staff/audit?per_page=100')->assertOk()->json('data'));
        $this->assertTrue($rows->every(fn ($e) => $e['subject_type'] === 'fuel_staff'));
        $targets = $rows->pluck('target.id')->filter()->unique()->all();
        $this->assertContains($inA['user']->id, $targets);
        $this->assertNotContains($inB['user']->id, $targets); // خارج فرعه

        // المالك يرى الدور أيضاً.
        $ownerRows = collect($this->withToken($this->fx['owner'])->getJson(self::BASE . '/staff/audit?per_page=100')->json('data'));
        $this->assertTrue($ownerRows->contains(fn ($e) => $e['subject_type'] === 'role'));
    }

    /** @test */
    public function the_read_endpoints_cannot_modify_or_delete_anything_and_a_non_uuid_id_is_a_clean_404(): void
    {
        $this->buildFixture();
        $emp = $this->makeUser('emp', 'staff');
        $this->assign($emp['user']->id, ['template' => 'seller', 'station_ids' => [$this->fx['s1']->id]]);
        $before = DB::table('access_change_events')->count();

        foreach (['post', 'put', 'patch', 'delete'] as $verb) {
            $status = $this->withToken($this->fx['owner'])->{$verb . 'Json'}(self::BASE . '/staff/audit', ['outcome' => 'applied'])->status();
            $this->assertContains($status, [404, 405], "{$verb} must not reach any handler");
        }
        $this->withToken($this->fx['owner'])->deleteJson(self::BASE . '/staff/candidates')->assertStatus(405);
        $this->assertSame($before, DB::table('access_change_events')->count());
        $this->withToken($this->fx['owner'])->getJson(self::BASE . '/staff/not-a-uuid')->assertNotFound();

        $event = AccessChangeEvent::query()->first();
        $this->expectException(\LogicException::class);
        $event->update(['action' => 'x']);
    }
}
