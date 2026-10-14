<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AC-UX-00A — حدود المنح في إدارة المستخدمين
 * ═══════════════════════════════════════════════════════════════
 *  `users.manage` لا يمنح سلطةً تتجاوز سلطة صاحبها:
 *   1. نطاق: فاعلٌ مقيَّد بفروع/مستودعات لا يفكّ قيده ولا يُسند خارج نطاقه ولا
 *      يُنشئ مستخدماً بلا نطاق (`[]` = غير مقيَّد).
 *   2. دور: لا يمنح (لنفسه أو لغيره) دوراً صلاحياته ليست ⊆ صلاحياته، ولا أي دور `*`.
 *   3. هدف: لا يعدّل ولا يحذف مستخدماً دوره الحالي فوق سقفه.
 *
 *  والثابت المقابل: الفراغ المخزَّن = غير مقيَّد، وسلوك owner/admin المشروع،
 *  وعزل المستأجر — كلها كما كانت.
 *
 *  تشغيل: php artisan test --filter=UserGrantBoundaryTest
 */
class UserGrantBoundaryTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /**
     * مدير مستخدمين مخصَّص: صلاحيات دور `staff` كاملةً + إدارة المستخدمين، فيقع
     * `staff` داخل سقفه ويقع `accountant`/`admin` خارجه.
     */
    private const MANAGER_PERMS = [...Rbac::MATRIX['staff'], 'users.view', 'users.manage'];

    /** @return array{0: array, 1: string, 2: string} [auth, الفرع الرئيسي A, فرع ثانٍ B] */
    private function tenant(string $slug = 'acme', string $email = 'owner@acme.test'): array
    {
        $auth = $this->registerTenant($slug, $email);
        app(TenantContext::class)->set($auth['tenant_id']);
        Tenant::find($auth['tenant_id'])->update(['plan_limits' => ['users' => 50]]);

        $a = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $b = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع ب'])->assertCreated()['data']['id'];

        return [$auth, $a, $b];
    }

    /** ينشئ دوراً مخصَّصاً ويعيد slug. */
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

        $token = $this->postJson('/api/login', ['email' => $email, 'password' => 'password123'])
            ->assertOk()['token'];

        return [$id, $token];
    }

    private function branchesOf(string $userId): ?array
    {
        $ids = User::find($userId)->allowedBranchIds();

        return $ids === null ? null : collect($ids)->sort()->values()->all();
    }

    // ═══════════════════════════════════════════════════════════
    //  1) النطاق
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_restricted_actor_cannot_clear_their_own_branch_scope(): void
    {
        [$auth, $a] = $this->tenant();
        $role = $this->role($auth, self::MANAGER_PERMS);
        [$me, $token] = $this->userWith($auth, $role, 'm@acme.test', ['branch_ids' => [$a]]);

        $this->withToken($token)->putJson("/api/users/{$me}", ['branch_ids' => []])->assertForbidden();
        $this->assertSame([$a], $this->branchesOf($me));

        // `null` يُقرأ كفراغ أيضاً — لا مدخل بديل لفكّ القيد.
        $this->withToken($token)->putJson("/api/users/{$me}", ['branch_ids' => null])->assertForbidden();
        $this->assertSame([$a], $this->branchesOf($me));
    }

    /** @test */
    public function a_restricted_actor_cannot_widen_their_own_scope_to_an_out_of_scope_branch(): void
    {
        [$auth, $a, $b] = $this->tenant();
        $role = $this->role($auth, self::MANAGER_PERMS);
        [$me, $token] = $this->userWith($auth, $role, 'm@acme.test', ['branch_ids' => [$a]]);

        $this->withToken($token)->putJson("/api/users/{$me}", ['branch_ids' => [$a, $b]])->assertForbidden();
        $this->withToken($token)->putJson("/api/users/{$me}", ['branch_ids' => [$b]])->assertForbidden();
        $this->assertSame([$a], $this->branchesOf($me));
    }

    /** @test */
    public function a_restricted_actor_cannot_give_another_user_out_of_scope_or_unrestricted_access(): void
    {
        [$auth, $a, $b] = $this->tenant();
        $role = $this->role($auth, self::MANAGER_PERMS);
        [, $token] = $this->userWith($auth, $role, 'm@acme.test', ['branch_ids' => [$a]]);
        [$staff] = $this->userWith($auth, 'staff', 's@acme.test', ['branch_ids' => [$a]]);

        $this->withToken($token)->putJson("/api/users/{$staff}", ['branch_ids' => [$a, $b]])->assertForbidden();
        $this->withToken($token)->putJson("/api/users/{$staff}", ['branch_ids' => []])->assertForbidden();
        $this->assertSame([$a], $this->branchesOf($staff));
    }

    /** @test */
    public function a_restricted_actor_cannot_create_a_user_without_scope_or_outside_scope(): void
    {
        [$auth, $a, $b] = $this->tenant();
        $role = $this->role($auth, self::MANAGER_PERMS);
        [, $token] = $this->userWith($auth, $role, 'm@acme.test', ['branch_ids' => [$a]]);
        $base = ['name' => 'جديد', 'password' => 'password123', 'role' => 'staff'];

        // غياب المفتاح كان يُنتج مستخدماً غير مقيَّد.
        $this->withToken($token)->postJson('/api/users', $base + ['email' => 'n1@acme.test'])->assertForbidden();
        $this->withToken($token)->postJson('/api/users', $base + ['email' => 'n2@acme.test', 'branch_ids' => []])->assertForbidden();
        $this->withToken($token)->postJson('/api/users', $base + ['email' => 'n3@acme.test', 'branch_ids' => [$b]])->assertForbidden();
        $this->assertNull(User::where('email', 'like', 'n_@acme.test')->first());

        // المشروع: ضمن نطاقه.
        $id = $this->withToken($token)->postJson('/api/users', $base + ['email' => 'n4@acme.test', 'branch_ids' => [$a]])
            ->assertCreated()['data']['id'];
        $this->assertSame([$a], $this->branchesOf($id));
    }

    /** @test */
    public function a_restricted_actor_can_still_manage_scope_within_their_own_scope(): void
    {
        [$auth, $a, $b] = $this->tenant();
        $role = $this->role($auth, self::MANAGER_PERMS);
        [$me, $token] = $this->userWith($auth, $role, 'm@acme.test', ['branch_ids' => [$a, $b]]);
        [$staff] = $this->userWith($auth, 'staff', 's@acme.test', ['branch_ids' => [$a, $b]]);

        $this->withToken($token)->putJson("/api/users/{$staff}", ['branch_ids' => [$b]])->assertOk();
        $this->assertSame([$b], $this->branchesOf($staff));

        // تضييق نفسه ضمن نطاقه مشروع.
        $this->withToken($token)->putJson("/api/users/{$me}", ['branch_ids' => [$a]])->assertOk();
        $this->assertSame([$a], $this->branchesOf($me));

        // غياب المفتاح = بلا تغيير (العقد القائم).
        $this->withToken($token)->putJson("/api/users/{$staff}", ['name' => 'اسم جديد'])->assertOk();
        $this->assertSame([$b], $this->branchesOf($staff));
    }

    /** @test */
    public function warehouse_scope_follows_the_same_boundary(): void
    {
        [$auth] = $this->tenant();
        $mine = $this->withToken($auth['token'])->getJson('/api/warehouses')['data'][0]['id'];
        $other = $this->withToken($auth['token'])->postJson('/api/warehouses', ['name' => 'مخزن ثانٍ'])->assertCreated()['data']['id'];
        $role = $this->role($auth, self::MANAGER_PERMS);
        [$me, $token] = $this->userWith($auth, $role, 'm@acme.test', ['warehouse_ids' => [$mine]]);

        $this->withToken($token)->putJson("/api/users/{$me}", ['warehouse_ids' => []])->assertForbidden();
        $this->withToken($token)->putJson("/api/users/{$me}", ['warehouse_ids' => [$mine, $other]])->assertForbidden();
        $this->assertSame([$mine], User::find($me)->allowedWarehouseIds());

        // مقيَّد بالمستودعات فقط: بُعد الفروع غير مقيَّد عنده فلا يُفرض عليه.
        $this->withToken($token)->putJson("/api/users/{$me}", ['warehouse_ids' => [$mine]])->assertOk();
    }

    // ═══════════════════════════════════════════════════════════
    //  2) سقف منح الدور
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_non_wildcard_actor_cannot_promote_themselves_to_admin_or_owner(): void
    {
        [$auth] = $this->tenant();
        $role = $this->role($auth, self::MANAGER_PERMS);
        [$me, $token] = $this->userWith($auth, $role, 'm@acme.test');

        $this->withToken($token)->putJson("/api/users/{$me}", ['role' => 'admin'])->assertForbidden();
        $this->withToken($token)->putJson("/api/users/{$me}", ['role' => 'owner'])->assertForbidden();
        $this->assertSame($role, User::find($me)->role);

        // لا يرقّي غيره إلى admin كذلك، ولا يُنشئ admin.
        [$staff] = $this->userWith($auth, 'staff', 's@acme.test');
        $this->withToken($token)->putJson("/api/users/{$staff}", ['role' => 'admin'])->assertForbidden();
        $this->withToken($token)->postJson('/api/users', [
            'name' => 'x', 'email' => 'x@acme.test', 'password' => 'password123', 'role' => 'admin',
        ])->assertForbidden();
        $this->assertSame('staff', User::find($staff)->role);
    }

    /** @test */
    public function a_non_wildcard_actor_cannot_grant_a_role_with_permissions_beyond_their_own(): void
    {
        [$auth] = $this->tenant();
        $actorRole = $this->role($auth, self::MANAGER_PERMS, 'مدير مستخدمين');
        $widerRole = $this->role($auth, [...self::MANAGER_PERMS, 'payments.manage'], 'أوسع');
        $subsetRole = $this->role($auth, ['products.view'], 'أضيق');
        [$me, $token] = $this->userWith($auth, $actorRole, 'm@acme.test');

        $this->withToken($token)->putJson("/api/users/{$me}", ['role' => $widerRole])->assertForbidden();
        $this->assertSame($actorRole, User::find($me)->role);

        // الدور الأضيق (⊆ صلاحياته) مشروع.
        $id = $this->withToken($token)->postJson('/api/users', [
            'name' => 'ض', 'email' => 'n@acme.test', 'password' => 'password123', 'role' => $subsetRole,
        ])->assertCreated()['data']['id'];
        $this->assertSame($subsetRole, User::find($id)->role);

        // وإرسال الدور نفسه دون تغيير (نموذج التعديل يرسله دائماً) لا يُرفض.
        $this->withToken($token)->putJson("/api/users/{$me}", ['role' => $actorRole, 'name' => 'اسم'])->assertOk();
    }

    // ═══════════════════════════════════════════════════════════
    //  3) سقف الهدف
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_non_wildcard_actor_cannot_modify_or_delete_a_more_privileged_user(): void
    {
        [$auth] = $this->tenant();
        $role = $this->role($auth, self::MANAGER_PERMS);
        [, $token] = $this->userWith($auth, $role, 'm@acme.test');
        [$admin] = $this->userWith($auth, 'admin', 'adm@acme.test');

        // إعادة تعيين كلمة مرور admin = استيلاء على حسابه.
        $this->withToken($token)->putJson("/api/users/{$admin}", ['password' => 'hijacked-pass'])->assertForbidden();
        $this->withToken($token)->putJson("/api/users/{$admin}", ['is_active' => false])->assertForbidden();
        $this->withToken($token)->deleteJson("/api/users/{$admin}")->assertForbidden();

        $this->assertTrue((bool) User::find($admin)->is_active);
        $this->postJson('/api/login', ['email' => 'adm@acme.test', 'password' => 'password123'])->assertOk();
        $this->postJson('/api/login', ['email' => 'adm@acme.test', 'password' => 'hijacked-pass'])->assertStatus(422);

        // ومستخدمٌ أدنى منه يديره بلا مشكلة.
        [$staff] = $this->userWith($auth, 'staff', 's@acme.test');
        $this->withToken($token)->putJson("/api/users/{$staff}", ['name' => 'أدنى'])->assertOk();
    }

    // ═══════════════════════════════════════════════════════════
    //  4) عزل المستأجر
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function cross_tenant_user_mutation_is_not_possible(): void
    {
        [$authA, $a1] = $this->tenant('acme', 'owner@acme.test');
        [$authB] = $this->tenant('beta', 'owner@beta.test');
        [$victim] = $this->userWith($authB, 'staff', 'victim@beta.test');
        $roleA = $this->role($authA, self::MANAGER_PERMS);
        [, $tokenA] = $this->userWith($authA, $roleA, 'm@acme.test', ['branch_ids' => [$a1]]);

        // مالك مستأجر آخر وفاعل مقيَّد: كلاهما 404 ولا أثر.
        foreach ([$authA['token'], $tokenA] as $token) {
            $this->withToken($token)->putJson("/api/users/{$victim}", ['name' => 'مخترَق'])->assertNotFound();
            $this->withToken($token)->putJson("/api/users/{$victim}", ['role' => 'admin'])->assertNotFound();
            $this->withToken($token)->deleteJson("/api/users/{$victim}")->assertNotFound();
        }
        $this->assertNull(User::find($victim)->deleted_at);
        $this->assertSame('staff', User::find($victim)->role);

        // فرع مستأجر آخر لا يُسنَد: مرفوض للمقيَّد، ويُتجاهل لغير المقيَّد.
        $foreignBranch = $this->withToken($authB['token'])->getJson('/api/branches')['data'][0]['id'];
        [$mine] = $this->userWith($authA, 'staff', 'mine@acme.test', ['branch_ids' => [$a1]]);
        $this->withToken($tokenA)->putJson("/api/users/{$mine}", ['branch_ids' => [$foreignBranch]])->assertForbidden();
        $this->withToken($authA['token'])->putJson("/api/users/{$mine}", ['branch_ids' => [$foreignBranch]])->assertOk();
        $this->assertNull($this->branchesOf($mine));
    }

    // ═══════════════════════════════════════════════════════════
    //  5) المشروع لا ينكسر
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function owner_and_unrestricted_admin_keep_full_legitimate_control(): void
    {
        [$auth, $a, $b] = $this->tenant();
        [$adminId, $adminToken] = $this->userWith($auth, 'admin', 'adm@acme.test');
        $custom = $this->role($auth, ['products.view', 'payments.manage'], 'مخصص');

        // المالك يمنح admin وأي دور، ويسند ويفكّ النطاق.
        [$u] = $this->userWith($auth, 'staff', 'u@acme.test', ['branch_ids' => [$a]]);
        $this->withToken($auth['token'])->putJson("/api/users/{$u}", ['role' => 'admin', 'branch_ids' => []])->assertOk();
        $this->assertSame('admin', User::find($u)->role);
        $this->assertNull($this->branchesOf($u));

        // admin غير المقيَّد (`*`): يمنح الأدوار ويسند ويمسح التقييد كما كان.
        $this->withToken($adminToken)->putJson("/api/users/{$u}", ['role' => $custom, 'branch_ids' => [$a, $b]])->assertOk();
        $this->assertSame([$a, $b], $this->branchesOf($u));
        $this->withToken($adminToken)->putJson("/api/users/{$u}", ['branch_ids' => []])->assertOk();
        $this->assertNull($this->branchesOf($u));
        $this->withToken($adminToken)->postJson('/api/users', [
            'name' => 'a2', 'email' => 'a2@acme.test', 'password' => 'password123', 'role' => 'admin',
        ])->assertCreated();

        // حارس المالك القائم يبقى: admin لا يمنح owner ولا يمسّ مالكاً.
        $ownerId = User::where('email', 'owner@acme.test')->value('id');
        $this->withToken($adminToken)->putJson("/api/users/{$u}", ['role' => 'owner'])->assertForbidden();
        $this->withToken($adminToken)->putJson("/api/users/{$ownerId}", ['name' => 'x'])->assertForbidden();
    }

    /** @test */
    public function a_restricted_admin_keeps_the_wildcard_but_is_still_bound_by_their_scope(): void
    {
        [$auth, $a, $b] = $this->tenant();
        [$adminId, $adminToken] = $this->userWith($auth, 'admin', 'adm@acme.test', ['branch_ids' => [$a]]);

        // دورٌ بـ`*` يبقى قابلاً للمنح (الدور سليم) لكن النطاق مقيِّد.
        $this->withToken($adminToken)->putJson("/api/users/{$adminId}", ['branch_ids' => []])->assertForbidden();
        $this->withToken($adminToken)->putJson("/api/users/{$adminId}", ['branch_ids' => [$a, $b]])->assertForbidden();
        $id = $this->withToken($adminToken)->postJson('/api/users', [
            'name' => 'ن', 'email' => 'n@acme.test', 'password' => 'password123', 'role' => 'accountant', 'branch_ids' => [$a],
        ])->assertCreated()['data']['id'];
        $this->assertSame([$a], $this->branchesOf($id));
    }

    /** @test */
    public function an_unrestricted_stored_scope_keeps_its_legacy_meaning(): void
    {
        [$auth] = $this->tenant();
        $role = $this->role($auth, self::MANAGER_PERMS);
        [$me, $token] = $this->userWith($auth, $role, 'm@acme.test'); // بلا إسناد = غير مقيَّد

        $this->assertNull($this->branchesOf($me));
        $this->withToken($token)->postJson('/api/users', [
            'name' => 'ن', 'email' => 'n@acme.test', 'password' => 'password123', 'role' => 'staff',
        ])->assertCreated();                                            // غير المقيَّد يُنشئ بلا نطاق كما كان
        $this->withToken($token)->putJson("/api/users/{$me}", ['branch_ids' => []])->assertOk(); // وإلغاء القيد عنده لا يغيّر شيئاً
        $this->assertNull($this->branchesOf($me));
    }
}
