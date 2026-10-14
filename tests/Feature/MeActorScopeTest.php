<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AC-UX-11 — نطاق المستخدم الخاص على `GET /api/me` (قرار المالك O-1)
 * ═══════════════════════════════════════════════════════════════
 *  حقلان إضافيان فقط داخل `user`: `branch_ids` و`warehouse_ids`.
 *   - **الدلالة مطابقة لـ`GET /users`:** الفراغ = «غير مقيَّد» لا «لا شيء».
 *   - **نطاق المستخدم المصادَق وحده** — لا نطاق غيره، ولا يتطلب `users.view`.
 *   - **لا قرار تخويل يُبنى عليه**، ولا أثر على حدود المنح (AC-UX-00A) ولا الصلاحيات ولا عزل المستأجر.
 *   - **توافق رجعي:** كل مفاتيح الاستجابة القديمة كما هي بقيمها، و`/login` لم يتغيّر.
 *
 *  تُشغَّل هذه الفئة ضمن فرع PostgreSQL في CI أيضاً (يشغّل الحزمة كاملةً على pgsql).
 *
 *  تشغيل: php artisan test --filter=MeActorScopeTest
 */
class MeActorScopeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const MANAGER_PERMS = [...Rbac::MATRIX['staff'], 'users.view', 'users.manage'];

    /** @return array{0: array, 1: string, 2: string, 3: string, 4: string} [auth, فرع A, فرع B, مخزن 1, مخزن 2] */
    private function tenant(string $slug = 'acme', string $email = 'owner@acme.test'): array
    {
        $auth = $this->registerTenant($slug, $email);
        app(TenantContext::class)->set($auth['tenant_id']);
        Tenant::find($auth['tenant_id'])->update(['plan_limits' => ['users' => 50]]);

        $a  = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $b  = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع ب'])->assertCreated()['data']['id'];
        $w1 = $this->withToken($auth['token'])->getJson('/api/warehouses')['data'][0]['id'];
        $w2 = $this->withToken($auth['token'])->postJson('/api/warehouses', ['name' => 'مخزن ثانٍ'])->assertCreated()['data']['id'];

        return [$auth, $a, $b, $w1, $w2];
    }

    private function role(array $auth, array $permissions, string $name = 'دور'): string
    {
        return $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => $name, 'permissions' => $permissions,
        ])->assertCreated()['data']['slug'];
    }

    /** ينشئ مستخدماً بيد المالك ويعيد [id, token]. */
    private function userWith(array $auth, string $role, string $email, array $scope = []): array
    {
        $id = $this->withToken($auth['token'])->postJson('/api/users', array_merge([
            'name' => $email, 'email' => $email, 'password' => 'password123', 'role' => $role,
        ], $scope))->assertCreated()['data']['id'];

        $token = $this->postJson('/api/login', ['email' => $email, 'password' => 'password123'])->assertOk()['token'];

        return [$id, $token];
    }

    private function me(string $token): array
    {
        return $this->withToken($token)->getJson('/api/me')->assertOk()->json('user');
    }

    // ═══════════════════════════════════════════════════════════
    //  أشكال النطاق
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_unrestricted_actor_gets_empty_arrays_meaning_unrestricted(): void
    {
        [$auth] = $this->tenant();

        $user = $this->me($auth['token']);

        // الفراغ يبقى «غير مقيَّد» — مصفوفة دائماً (لا null ولا غياب) فلا يُلتبس بـ«غير معروف».
        $this->assertSame([], $user['branch_ids']);
        $this->assertSame([], $user['warehouse_ids']);
    }

    /** @test */
    public function a_branch_restricted_actor_gets_exactly_their_branches(): void
    {
        [$auth, $a, $b] = $this->tenant();
        [, $token] = $this->userWith($auth, 'staff', 's@acme.test', ['branch_ids' => [$a, $b]]);

        $user = $this->me($token);

        $this->assertEqualsCanonicalizing([$a, $b], $user['branch_ids']);
        $this->assertSame([], $user['warehouse_ids']);

        // المرتّب ثابتٌ عبر المحرّكات.
        $sorted = $user['branch_ids'];
        sort($sorted);
        $this->assertSame($sorted, $user['branch_ids']);
    }

    /** @test */
    public function a_warehouse_restricted_actor_gets_exactly_their_warehouses(): void
    {
        [$auth, , , $w1] = $this->tenant();
        [, $token] = $this->userWith($auth, 'staff', 's@acme.test', ['warehouse_ids' => [$w1]]);

        $user = $this->me($token);

        $this->assertSame([], $user['branch_ids']);
        $this->assertSame([$w1], $user['warehouse_ids']);
    }

    /** @test */
    public function an_actor_restricted_in_both_dimensions_gets_both(): void
    {
        [$auth, $a, , $w1, $w2] = $this->tenant();
        [, $token] = $this->userWith($auth, 'staff', 's@acme.test', ['branch_ids' => [$a], 'warehouse_ids' => [$w1, $w2]]);

        $user = $this->me($token);

        $this->assertSame([$a], $user['branch_ids']);
        $this->assertEqualsCanonicalizing([$w1, $w2], $user['warehouse_ids']);
    }

    /** @test */
    public function ids_are_plain_uuid_strings_on_every_driver(): void
    {
        [$auth, $a, , $w1] = $this->tenant();
        [, $token] = $this->userWith($auth, 'staff', 's@acme.test', ['branch_ids' => [$a], 'warehouse_ids' => [$w1]]);

        $user = $this->me($token);

        foreach ([...$user['branch_ids'], ...$user['warehouse_ids']] as $id) {
            $this->assertIsString($id);
            $this->assertMatchesRegularExpression('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id);
        }
        $this->assertTrue(array_is_list($user['branch_ids']));
        $this->assertTrue(array_is_list($user['warehouse_ids']));
    }

    // ═══════════════════════════════════════════════════════════
    //  الصلاحيات: لا اعتماد على `users.view`، ولا كشف لغير المشاهد
    // ═══════════════════════════════════════════════════════════

    /**
     * جوهر القرار O-1: مقيَّدٌ بلا `users.view` كان لا يعرف نطاقه (مصدره صفّه في `GET /users` المحجوب عنه).
     *
     * @test
     */
    public function an_actor_without_users_view_still_learns_their_own_scope(): void
    {
        [$auth, $a, , $w1] = $this->tenant();
        $role = $this->role($auth, ['hr.view', 'hr.manage', 'users.manage']); // لا users.view
        [, $token] = $this->userWith($auth, $role, 'h@acme.test', ['branch_ids' => [$a], 'warehouse_ids' => [$w1]]);

        // المصدر القديم محجوب عنه فعلاً…
        $this->withToken($token)->getJson('/api/users')->assertForbidden();
        // …و`/me` يعطيه نطاقه.
        $user = $this->me($token);
        $this->assertSame([$a], $user['branch_ids']);
        $this->assertSame([$w1], $user['warehouse_ids']);
        $this->assertNotContains('users.view', $user['permissions']);
    }

    /** @test */
    public function managers_with_users_manage_or_hr_manage_get_only_their_own_scope(): void
    {
        [$auth, $a, $b, $w1, $w2] = $this->tenant();
        $managerRole = $this->role($auth, self::MANAGER_PERMS, 'مدير مستخدمين');
        $hrRole      = $this->role($auth, ['hr.view', 'hr.manage'], 'موارد بشرية');

        [, $managerToken] = $this->userWith($auth, $managerRole, 'm@acme.test', ['branch_ids' => [$a]]);
        [, $hrToken]      = $this->userWith($auth, $hrRole, 'hr@acme.test', ['warehouse_ids' => [$w1]]);
        // مستخدمٌ آخر بنطاقٍ مختلف لا يجوز أن يظهر لأيٍّ منهما.
        $this->userWith($auth, 'staff', 'other@acme.test', ['branch_ids' => [$b], 'warehouse_ids' => [$w2]]);

        $manager = $this->me($managerToken);
        $this->assertSame([$a], $manager['branch_ids']);
        $this->assertSame([], $manager['warehouse_ids']);
        $this->assertStringNotContainsString($b, json_encode($manager));
        $this->assertStringNotContainsString($w2, json_encode($manager));

        $hr = $this->me($hrToken);
        $this->assertSame([], $hr['branch_ids']);
        $this->assertSame([$w1], $hr['warehouse_ids']);
        $this->assertStringNotContainsString($b, json_encode($hr));
        $this->assertStringNotContainsString($w2, json_encode($hr));
    }

    /** @test */
    public function an_unrestricted_owner_never_sees_other_users_scope_on_me(): void
    {
        [$auth, $a, $b, $w1] = $this->tenant();
        $this->userWith($auth, 'staff', 's@acme.test', ['branch_ids' => [$a, $b], 'warehouse_ids' => [$w1]]);

        $owner = $this->me($auth['token']);

        $this->assertSame([], $owner['branch_ids']);
        $this->assertSame([], $owner['warehouse_ids']);
    }

    /** @test */
    public function the_scope_on_me_equals_the_actors_own_row_in_the_users_list(): void
    {
        [$auth, $a, , $w1] = $this->tenant();
        $role = $this->role($auth, self::MANAGER_PERMS);
        [$id, $token] = $this->userWith($auth, $role, 'm@acme.test', ['branch_ids' => [$a], 'warehouse_ids' => [$w1]]);

        $row = collect($this->withToken($token)->getJson('/api/users')->assertOk()['data'])->firstWhere('id', $id);
        $user = $this->me($token);

        $this->assertEqualsCanonicalizing($row['branch_ids'], $user['branch_ids']);
        $this->assertEqualsCanonicalizing($row['warehouse_ids'], $user['warehouse_ids']);
    }

    // ═══════════════════════════════════════════════════════════
    //  عزل المستأجر
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function scope_never_leaks_across_tenants(): void
    {
        [$authA, $aA, , $w1A] = $this->tenant('acme', 'owner@acme.test');
        [, $tokenA] = $this->userWith($authA, 'staff', 'a@acme.test', ['branch_ids' => [$aA], 'warehouse_ids' => [$w1A]]);

        [$authB, $aB, , $w1B] = $this->tenant('globex', 'owner@globex.test');
        [, $tokenB] = $this->userWith($authB, 'staff', 'b@globex.test', ['branch_ids' => [$aB], 'warehouse_ids' => [$w1B]]);

        $a = $this->me($tokenA);
        $b = $this->me($tokenB);

        $this->assertSame([$aA], $a['branch_ids']);
        $this->assertSame([$w1A], $a['warehouse_ids']);
        $this->assertSame([$aB], $b['branch_ids']);
        $this->assertSame([$w1B], $b['warehouse_ids']);
        $this->assertStringNotContainsString($aB, json_encode($a));
        $this->assertStringNotContainsString($aA, json_encode($b));
    }

    /**
     * صفٌّ في الجدول الوسيط يشير إلى فرع/مخزن **مستأجرٍ آخر** (تلفٌ في البيانات) لا يُعاد أبداً —
     * العلاقة تمرّ بنطاق المستأجر الشامل.
     *
     * @test
     */
    public function a_pivot_row_pointing_at_another_tenants_branch_or_warehouse_is_never_returned(): void
    {
        [$authA, $aA] = $this->tenant('acme', 'owner@acme.test');
        [$idA, $tokenA] = $this->userWith($authA, 'staff', 'a@acme.test', ['branch_ids' => [$aA]]);

        [$authB, $aB, , $w1B] = $this->tenant('globex', 'owner@globex.test');

        // تلفٌ مصطنع: ربط مستخدم المستأجر A بفرع ومخزن المستأجر B مباشرةً في الجدول الوسيط.
        $now = now();
        DB::table('branch_user')->insert(['user_id' => $idA, 'branch_id' => $aB, 'created_at' => $now, 'updated_at' => $now]);
        DB::table('user_warehouse')->insert(['user_id' => $idA, 'warehouse_id' => $w1B, 'created_at' => $now, 'updated_at' => $now]);

        $user = $this->me($tokenA);

        $this->assertSame([$aA], $user['branch_ids']);
        $this->assertSame([], $user['warehouse_ids']);
        $this->assertStringNotContainsString($aB, json_encode($user));
        $this->assertStringNotContainsString($w1B, json_encode($user));
    }

    // ═══════════════════════════════════════════════════════════
    //  التوافق الرجعي وعدم تغيّر قرارات التخويل
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function the_existing_me_response_is_backward_compatible(): void
    {
        [$auth] = $this->tenant();
        $login = $this->postJson('/api/login', ['email' => 'owner@acme.test', 'password' => 'password123'])->assertOk();

        $res = $this->withToken($auth['token'])->getJson('/api/me')->assertOk();

        // كل مفاتيح `user` القديمة (كما يعيدها `/login`) حاضرة بقيمها نفسها…
        foreach ($login['user'] as $key => $value) {
            $this->assertSame($value, $res['user'][$key], "user.{$key} changed");
        }
        // …والمفتاحان الجديدان وحدهما إضافة؛ و`company` سالمة.
        $this->assertSame(
            ['branch_ids', 'warehouse_ids'],
            collect(array_keys($res['user']))->diff(array_keys($login['user']))->sort()->values()->all(),
        );
        $this->assertSame(['company', 'user'], collect(array_keys($res->json()))->sort()->values()->all());
        $this->assertNotNull($res['company']);
    }

    /** @test */
    public function login_response_is_unchanged_and_carries_no_scope_fields(): void
    {
        $this->tenant();

        $login = $this->postJson('/api/login', ['email' => 'owner@acme.test', 'password' => 'password123'])->assertOk();

        $this->assertArrayNotHasKey('branch_ids', $login['user']);
        $this->assertArrayNotHasKey('warehouse_ids', $login['user']);
    }

    /**
     * الحقلان للعرض فقط: لا يغيّران أي قرار — مقيَّد ما زال يُرفض حين يفكّ قيده أو يتجاوز نطاقه (AC-UX-00A)،
     * وقراءة `/me` لا تُغيّر المخزَّن.
     *
     * @test
     */
    public function exposing_scope_changes_no_authorization_decision_and_writes_nothing(): void
    {
        [$auth, $a, $b] = $this->tenant();
        $role = $this->role($auth, self::MANAGER_PERMS);
        [$id, $token] = $this->userWith($auth, $role, 'm@acme.test', ['branch_ids' => [$a]]);

        $this->me($token);
        $this->me($token);

        $this->withToken($token)->putJson("/api/users/{$id}", ['branch_ids' => []])->assertForbidden();
        $this->withToken($token)->putJson("/api/users/{$id}", ['branch_ids' => [$a, $b]])->assertForbidden();
        $this->assertSame([$a], User::find($id)->allowedBranchIds());
        $this->assertNull(User::find($id)->allowedWarehouseIds());
    }

    /** @test */
    public function unauthenticated_requests_still_get_401(): void
    {
        $this->getJson('/api/me')->assertUnauthorized();
    }
}
