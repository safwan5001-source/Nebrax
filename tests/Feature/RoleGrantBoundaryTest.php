<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AC-UX-00A — سقف المنح في إدارة الأدوار
 * ═══════════════════════════════════════════════════════════════
 *  `roles.manage` لا يرفع صاحبه فوق ما مُنح: فاعلٌ بلا `*` لا يُنشئ ولا يعدّل
 *  دوراً بصلاحياتٍ خارج صلاحياته (ومنها دوره هو)، ولا يعدّل دوراً قائماً يتجاوز
 *  سقفه (كـ`admin` أو `accountant`). وأثره مباشر: الدور يُقرأ في كل طلب.
 *
 *  والمقابل: owner/admin (`*`) يبقيان يُنشئان ويعدّلان أي دور مخصَّص كما كانا.
 *
 *  تشغيل: php artisan test --filter=RoleGrantBoundaryTest
 */
class RoleGrantBoundaryTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const ROLE_ADMIN = ['roles.view', 'roles.manage', 'products.view'];

    private function tenant(string $slug = 'acme', string $email = 'owner@acme.test'): array
    {
        $auth = $this->registerTenant($slug, $email);
        app(TenantContext::class)->set($auth['tenant_id']);
        Tenant::find($auth['tenant_id'])->update(['plan_limits' => ['users' => 50]]);

        return $auth;
    }

    /** @return array{0: string, 1: string, 2: string} [role id, role slug, actor token] */
    private function roleManager(array $auth, array $permissions = self::ROLE_ADMIN, string $email = 'rm@acme.test'): array
    {
        $role = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'مدير أدوار ' . $email, 'permissions' => $permissions,
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => $email, 'email' => $email, 'password' => 'password123', 'role' => $role['slug'],
        ])->assertCreated();

        $token = $this->postJson('/api/login', ['email' => $email, 'password' => 'password123'])->assertOk()['token'];

        return [$role['id'], $role['slug'], $token];
    }

    private function permsOf(string $roleId): array
    {
        $p = Role::findOrFail($roleId)->permissions;
        sort($p);

        return $p;
    }

    /** @test */
    public function a_role_manager_cannot_add_permissions_to_their_own_role(): void
    {
        $auth = $this->tenant();
        [$roleId, , $token] = $this->roleManager($auth);
        $before = $this->permsOf($roleId);

        // التصعيد الذاتي: إضافة users.manage أو أي مفتاح لم يُمنح.
        $this->withToken($token)->putJson("/api/roles/{$roleId}", [
            'name' => 'x', 'permissions' => [...self::ROLE_ADMIN, 'users.manage'],
        ])->assertForbidden();
        $this->withToken($token)->putJson("/api/roles/{$roleId}", [
            'name' => 'x', 'permissions' => Rbac::PERMISSIONS,
        ])->assertForbidden();

        $this->assertSame($before, $this->permsOf($roleId));
    }

    /** @test */
    public function a_role_manager_cannot_create_a_role_beyond_their_own_permissions(): void
    {
        $auth = $this->tenant();
        [, , $token] = $this->roleManager($auth);

        $this->withToken($token)->postJson('/api/roles', [
            'name' => 'أوسع', 'permissions' => ['products.view', 'payments.manage'],
        ])->assertForbidden();
        $this->assertNull(Role::where('name', 'أوسع')->first());

        // `*` يبقى مرفوضاً بالتحقق نفسه، لا يعبر السقف بطريق آخر.
        $this->withToken($token)->postJson('/api/roles', ['name' => 'نجمة', 'permissions' => ['*']])->assertStatus(422);

        // المشروع: ⊆ صلاحياته.
        $this->withToken($token)->postJson('/api/roles', [
            'name' => 'أضيق', 'permissions' => ['products.view'],
        ])->assertCreated();
    }

    /** @test */
    public function a_role_manager_can_still_narrow_their_own_role_and_edit_a_narrower_role(): void
    {
        $auth = $this->tenant();
        [$roleId, , $token] = $this->roleManager($auth);

        $narrow = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'ضيق', 'permissions' => ['products.view'],
        ])->assertCreated()['data']['id'];
        $this->withToken($token)->putJson("/api/roles/{$narrow}", [
            'name' => 'ضيق معدّل', 'permissions' => ['products.view', 'roles.view'],
        ])->assertOk();

        $this->withToken($token)->putJson("/api/roles/{$roleId}", [
            'name' => 'مُضيَّق', 'permissions' => ['roles.view', 'roles.manage'],
        ])->assertOk();
        $this->assertSame(['roles.manage', 'roles.view'], $this->permsOf($roleId));
    }

    /** @test */
    public function a_role_manager_cannot_edit_a_role_that_exceeds_their_ceiling(): void
    {
        $auth = $this->tenant();
        [, , $token] = $this->roleManager($auth);
        $accountant = Role::where('slug', 'accountant')->value('id');
        $admin = Role::where('slug', 'admin')->value('id');
        $before = [$this->permsOf($accountant), $this->permsOf($admin)];

        // حتى بقائمة ضمن سقفه: الدور القائم أوسع منه فلا يُمسّ (لا تجريد admin من `*`).
        foreach ([$accountant, $admin] as $id) {
            $this->withToken($token)->putJson("/api/roles/{$id}", [
                'name' => 'مخترَق', 'permissions' => ['products.view'],
            ])->assertForbidden();
        }
        $this->assertSame($before, [$this->permsOf($accountant), $this->permsOf($admin)]);
    }

    /** @test */
    public function a_role_manager_cannot_delete_an_unused_role_beyond_their_ceiling(): void
    {
        $auth = $this->tenant();
        [, , $token] = $this->roleManager($auth);
        $wide = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'واسع غير مستخدم', 'permissions' => ['products.view', 'payments.manage'],
        ])->assertCreated()['data']['id'];
        $narrow = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'ضيق غير مستخدم', 'permissions' => ['products.view'],
        ])->assertCreated()['data']['id'];

        $this->withToken($token)->deleteJson("/api/roles/{$wide}")->assertForbidden();
        $this->assertNotNull(Role::find($wide));

        // ضمن سقفه يُحذف كما كان، والمالك يحذف أيّاً منهما.
        $this->withToken($token)->deleteJson("/api/roles/{$narrow}")->assertOk();
        $this->withToken($auth['token'])->deleteJson("/api/roles/{$wide}")->assertOk();
    }

    /** @test */
    public function a_restricted_user_manager_cannot_chain_role_edit_into_scope_unrestriction(): void
    {
        $auth = $this->tenant();
        $main = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $role = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'مدير', 'permissions' => ['roles.view', 'roles.manage', 'users.view', 'products.view'],
        ])->assertCreated()['data'];
        $id = $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'm', 'email' => 'chain@acme.test', 'password' => 'password123',
            'role' => $role['slug'], 'branch_ids' => [$main],
        ])->assertCreated()['data']['id'];
        $token = $this->postJson('/api/login', ['email' => 'chain@acme.test', 'password' => 'password123'])->assertOk()['token'];

        // الخطوة 1: منح الدور users.manage — مرفوضة، فلا تصل إلى الخطوة 2.
        $this->withToken($token)->putJson("/api/roles/{$role['id']}", [
            'name' => 'مدير', 'permissions' => [...$role['permissions'], 'users.manage'],
        ])->assertForbidden();
        // الخطوة 2 مغلقة بصلاحية المسار نفسها.
        $this->withToken($token)->putJson("/api/users/{$id}", ['branch_ids' => []])->assertForbidden();
        $this->assertSame([$main], User::find($id)->allowedBranchIds());
    }

    /** @test */
    public function a_scope_restricted_role_manager_cannot_edit_a_role_held_by_broader_scoped_users(): void
    {
        $auth = $this->tenant();
        $main = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $perms = ['roles.view', 'roles.manage', 'products.view', 'payments.manage'];
        $manager = $this->withToken($auth['token'])->postJson('/api/roles', ['name' => 'مدير فرع', 'permissions' => $perms])->assertCreated()['data'];
        $shared = $this->withToken($auth['token'])->postJson('/api/roles', ['name' => 'مشترك', 'permissions' => ['products.view']])->assertCreated()['data'];
        $mine = $this->withToken($auth['token'])->postJson('/api/roles', ['name' => 'خاص بفرعي', 'permissions' => ['products.view']])->assertCreated()['data'];

        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'm', 'email' => 'bm@acme.test', 'password' => 'password123', 'role' => $manager['slug'], 'branch_ids' => [$main],
        ])->assertCreated();
        // `shared` مُسنَد لمستخدمٍ غير مقيَّد؛ و`mine` لمستخدمٍ ضمن فرع المدير.
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'open', 'email' => 'open@acme.test', 'password' => 'password123', 'role' => $shared['slug'],
        ])->assertCreated();
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'in', 'email' => 'in@acme.test', 'password' => 'password123', 'role' => $mine['slug'], 'branch_ids' => [$main],
        ])->assertCreated();
        $token = $this->postJson('/api/login', ['email' => 'bm@acme.test', 'password' => 'password123'])->assertOk()['token'];

        // إضافة payments.manage (يملكها) لدورٍ يحمله مستخدمٌ غير مقيَّد: ممنوع.
        $this->withToken($token)->putJson("/api/roles/{$shared['id']}", [
            'name' => 'مشترك', 'permissions' => ['products.view', 'payments.manage'],
        ])->assertForbidden();
        $this->assertSame(['products.view'], $this->permsOf($shared['id']));

        // دورٌ كل حامليه ضمن نطاقه: مشروع.
        $this->withToken($token)->putJson("/api/roles/{$mine['id']}", [
            'name' => 'خاص بفرعي', 'permissions' => ['products.view', 'payments.manage'],
        ])->assertOk();

        // وإنشاء دور جديد (بلا حاملين) مشروع.
        $this->withToken($token)->postJson('/api/roles', ['name' => 'جديد', 'permissions' => ['products.view']])->assertCreated();
    }

    /** @test */
    public function owner_and_admin_keep_full_role_management(): void
    {
        $auth = $this->tenant();

        $custom = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'مخصص واسع', 'permissions' => Rbac::PERMISSIONS,
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->putJson("/api/roles/{$custom['id']}", [
            'name' => 'مخصص', 'permissions' => ['products.view', 'payments.manage'],
        ])->assertOk();

        // admin (`*`) يعدّل المحاسب ويُنشئ بأي صلاحيات.
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'adm', 'email' => 'adm@acme.test', 'password' => 'password123', 'role' => 'admin',
        ])->assertCreated();
        $adminToken = $this->postJson('/api/login', ['email' => 'adm@acme.test', 'password' => 'password123'])->assertOk()['token'];
        $accountant = Role::where('slug', 'accountant')->value('id');
        $this->withToken($adminToken)->putJson("/api/roles/{$accountant}", [
            'name' => 'محاسب', 'permissions' => ['invoices.view', 'invoices.manage'],
        ])->assertOk();
        $this->withToken($adminToken)->postJson('/api/roles', [
            'name' => 'إداري', 'permissions' => Rbac::PERMISSIONS,
        ])->assertCreated();

        // حارس المالك القائم يبقى.
        $owner = Role::where('slug', 'owner')->value('id');
        $this->withToken($adminToken)->putJson("/api/roles/{$owner}", [
            'name' => 'x', 'permissions' => ['products.view'],
        ])->assertStatus(422);
    }

    /** @test */
    public function role_mutation_across_tenants_is_not_possible(): void
    {
        $a = $this->tenant('acme', 'owner@acme.test');
        $b = $this->tenant('beta', 'owner@beta.test');
        $foreign = $this->withToken($b['token'])->postJson('/api/roles', [
            'name' => 'دور بيتا', 'permissions' => ['products.view'],
        ])->assertCreated()['data']['id'];
        [, , $token] = $this->roleManager($a);

        foreach ([$a['token'], $token] as $t) {
            $this->withToken($t)->putJson("/api/roles/{$foreign}", ['name' => 'x', 'permissions' => ['products.view']])->assertNotFound();
            $this->withToken($t)->deleteJson("/api/roles/{$foreign}")->assertNotFound();
        }
        $this->assertSame(['products.view'], $this->permsOf($foreign));
    }
}
