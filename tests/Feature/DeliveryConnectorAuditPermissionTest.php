<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\Tenant;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  INT-UX-6 / PR-6a — تسجيل صلاحية تدقيق التكامل المستقلة (أساس خامل)
 * ═══════════════════════════════════════════════════════════════
 *  `delivery_connector.audit.view` معروفة لـRBAC ومحرر الأدوار **فقط**: لا مسار ولا قارئ ولا
 *  منح تلقائي. owner/admin عبر `*`؛ لا تُضاف إلى `MATRIX` ولا إلى أي دور مخزَّن (لا هجرة ولا seeder).
 *  لا وراثة بينها وبين `view`/`manage`/`reassign` في أي اتجاه، ولا تفتح أي مسار قائم.
 *
 *  كل الاختبارات تمرّ بالتحقق الحقيقي (RBAC + HTTP + قاعدة البيانات) — بلا mocks.
 *  تشغيل: php artisan test --filter=DeliveryConnectorAuditPermissionTest
 */
class DeliveryConnectorAuditPermissionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const AUDIT = 'delivery_connector.audit.view';

    private const SIBLINGS = ['delivery_connector.view', 'delivery_connector.manage', 'delivery_connector.reassign'];

    private function tenant(string $slug = 'acme', string $email = 'owner@acme.test'): array
    {
        $auth = $this->registerTenant($slug, $email);
        app(TenantContext::class)->set($auth['tenant_id']);
        Tenant::find($auth['tenant_id'])->update(['plan_limits' => ['users' => 50]]);

        return $auth;
    }

    /** @return array{0: string, 1: string, 2: string} [role id, slug, token] دور مخصَّص حقيقي عبر الـAPI + مستخدم بتوكن. */
    private function customRole(array $auth, array $permissions, string $email): array
    {
        $role = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'دور '.$email, 'permissions' => $permissions,
        ])->assertCreated()['data'];

        return [$role['id'], $role['slug'], $this->tokenForRole($auth['tenant_id'], $role['slug'], $email)];
    }

    private function permsOf(string $roleId): array
    {
        $p = Role::query()->findOrFail($roleId)->permissions;
        sort($p);

        return $p;
    }

    // ─────────────────────────── السجل ───────────────────────────

    /** @test */
    public function the_key_is_registered_exactly_once_next_to_its_delivery_connector_siblings(): void
    {
        $this->assertSame(1, array_count_values(Rbac::PERMISSIONS)[self::AUDIT] ?? 0);

        $positions = array_map(fn (string $k) => array_search($k, Rbac::PERMISSIONS, true), [...self::SIBLINGS, self::AUDIT]);
        $this->assertNotContains(false, $positions, 'a delivery_connector key is missing from the registry');
        $this->assertSame(range($positions[0], $positions[0] + 3), $positions, 'the four delivery_connector keys must stay adjacent and ordered');

        // لا مفتاح مكرَّر في السجل كله، وكل ما في المصفوفة الثابتة معروف للسجل.
        $this->assertSame(count(Rbac::PERMISSIONS), count(array_unique(Rbac::PERMISSIONS)));
        foreach (Rbac::MATRIX as $role => $perms) {
            foreach ($perms as $perm) {
                if ($perm !== '*') {
                    $this->assertContains($perm, Rbac::PERMISSIONS, "{$role}: {$perm}");
                }
            }
        }
    }

    /** @test */
    public function the_pre_existing_delivery_connector_keys_are_unchanged(): void
    {
        foreach (self::SIBLINGS as $key) {
            $this->assertSame(1, array_count_values(Rbac::PERMISSIONS)[$key] ?? 0, $key);
        }
        // لا مفتاح تدقيق بديل أو مرادف تسلّل إلى السجل.
        $this->assertSame([self::AUDIT], array_values(array_filter(Rbac::PERMISSIONS, fn ($k) => str_contains($k, 'delivery_connector') && str_contains($k, 'audit'))));
    }

    // ─────────────────────── الأدوار النظامية ───────────────────────

    /** @test */
    public function owner_and_admin_hold_it_through_the_wildcard_and_nobody_else_by_default(): void
    {
        $auth = $this->tenant();

        $this->assertSame(['*'], Rbac::MATRIX['owner']);
        $this->assertSame(['*'], Rbac::MATRIX['admin']);
        $this->assertTrue(Rbac::allows('owner', self::AUDIT));
        $this->assertTrue(Rbac::allows('admin', self::AUDIT));

        // والمخزَّن (مصدر الحقيقة بعد التسجيل) يطابق المصفوفة حرفياً: لا مفتاح صريح أُضيف لأي دور.
        $this->assertSame(['*'], Role::where('slug', 'owner')->value('permissions'));
        $this->assertSame(['*'], Role::where('slug', 'admin')->value('permissions'));

        foreach (['accountant', 'staff', 'self_service'] as $slug) {
            $this->assertNotContains(self::AUDIT, Rbac::MATRIX[$slug], "MATRIX[{$slug}]");
            $this->assertNotContains('*', Rbac::MATRIX[$slug], "MATRIX[{$slug}] must not be a wildcard");
            $this->assertNotContains(self::AUDIT, Role::where('slug', $slug)->value('permissions'), "stored {$slug}");
            $this->assertFalse(Rbac::allows($slug, self::AUDIT), $slug);
        }
        $this->assertNotNull($auth['tenant_id']);
    }

    /** @test */
    public function no_migration_seeder_or_backfill_grants_the_key(): void
    {
        $offenders = [];
        foreach ([base_path('database/migrations'), base_path('database/seeders')] as $dir) {
            if (! is_dir($dir)) {
                continue;
            }
            foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS)) as $file) {
                if ($file->isFile() && str_ends_with($file->getFilename(), '.php')
                    && str_contains((string) file_get_contents($file->getPathname()), 'delivery_connector.audit')) {
                    $offenders[] = $file->getFilename();
                }
            }
        }
        $this->assertSame([], $offenders, 'the audit permission must never be seeded or backfilled into stored roles');
    }

    // ─────────────────── الأدوار المخصصة القديمة ───────────────────

    /** @test */
    public function an_existing_custom_role_never_acquires_the_key_implicitly(): void
    {
        $auth = $this->tenant();

        // «دور قديم»: أوسع ما يمكن عدا المفتاح الجديد (كل مفاتيح السجل الأخرى، بما فيها الشقيقات الثلاث).
        $everythingElse = array_values(array_diff(Rbac::PERMISSIONS, [self::AUDIT]));
        [$roleId, , $token] = $this->customRole($auth, $everythingElse, 'legacy@acme.test');
        $before = $this->permsOf($roleId);

        $this->assertNotContains(self::AUDIT, $before);
        $this->assertFalse(Rbac::allows(Role::findOrFail($roleId)->slug, self::AUDIT));

        // ولا يكتسبه بإعادة قراءة الدور ولا بتعديل لا يذكره.
        $this->withToken($auth['token'])->putJson("/api/roles/{$roleId}", [
            'name' => 'قديم معدَّل', 'permissions' => array_slice($everythingElse, 0, 20),
        ])->assertOk();
        $this->assertNotContains(self::AUDIT, $this->permsOf($roleId));
        $this->assertFalse(Rbac::allows(Role::findOrFail($roleId)->slug, self::AUDIT));
        $this->assertNotEmpty($token);
    }

    /** @test */
    public function a_custom_role_holding_all_three_siblings_still_lacks_the_audit_key(): void
    {
        $auth = $this->tenant();
        [$roleId] = $this->customRole($auth, self::SIBLINGS, 'siblings@acme.test');
        $slug = Role::findOrFail($roleId)->slug;

        foreach (self::SIBLINGS as $key) {
            $this->assertTrue(Rbac::allows($slug, $key), $key);
        }
        $this->assertFalse(Rbac::allows($slug, self::AUDIT), 'view+manage+reassign must not imply audit.view');
    }

    /** @test */
    public function the_audit_key_alone_grants_no_sibling_and_opens_no_existing_endpoint(): void
    {
        $auth = $this->tenant();
        [$roleId, $slug, $token] = $this->customRole($auth, [self::AUDIT], 'auditor@acme.test');

        $this->assertTrue(Rbac::allows($slug, self::AUDIT));
        foreach (self::SIBLINGS as $key) {
            $this->assertFalse(Rbac::allows($slug, $key), "audit.view must not grant {$key}");
        }

        // مرجع المقارنة: المالك يصل إلى القراءة نفسها (فالرفض أدناه سببه الصلاحية لا غياب بيانات).
        $this->withToken($auth['token'])->getJson('/api/delivery-connectors')->assertOk();

        $id = (string) Str::uuid();
        $this->withToken($token)->getJson('/api/delivery-connectors')->assertForbidden();
        $this->withToken($token)->getJson("/api/delivery-connectors/{$id}")->assertForbidden();
        $this->withToken($token)->postJson('/api/delivery-connectors', [])->assertForbidden();
        $this->withToken($token)->postJson("/api/delivery-connectors/{$id}/rotate-secret")->assertForbidden();
        $this->withToken($token)->postJson("/api/delivery-connectors/{$id}/disable")->assertForbidden();
        $this->withToken($token)->postJson("/api/delivery-connectors/{$id}/reassign", ['user_id' => (string) Str::uuid()])->assertForbidden();
        $this->withToken($token)->getJson('/api/users')->assertForbidden();
        $this->assertSame([self::AUDIT], $this->permsOf($roleId));
    }

    /** @test */
    public function the_sibling_keys_do_not_grant_audit_view_over_http_roles_either(): void
    {
        $auth = $this->tenant();
        foreach (self::SIBLINGS as $i => $key) {
            [, $slug] = $this->customRole($auth, [$key], "sib{$i}@acme.test");
            $this->assertTrue(Rbac::allows($slug, $key), $key);
            $this->assertFalse(Rbac::allows($slug, self::AUDIT), "{$key} must not grant audit.view");
        }
    }

    /** @test */
    public function the_key_is_inert_no_route_references_it_and_no_audit_read_route_exists(): void
    {
        $audit = [];
        foreach (Route::getRoutes() as $route) {
            $joined = implode('|', array_map(fn ($m) => is_string($m) ? $m : '', $route->gatherMiddleware()));
            if (str_contains($joined, self::AUDIT)) {
                $audit[] = $route->uri();
            }
            if (str_contains($route->uri(), 'delivery-connectors') && str_contains($route->uri(), 'audit')) {
                $audit[] = $route->uri();
            }
        }
        $this->assertSame([], $audit, 'PR-6a is an inert foundation: no route may use the audit permission yet');
    }

    // ───────────────── محرر الأدوار: القبول والسقف ─────────────────

    /** @test */
    public function the_role_catalog_lists_it_once_and_role_create_and_update_accept_it_under_current_rules(): void
    {
        $auth = $this->tenant();

        $catalog = $this->withToken($auth['token'])->getJson('/api/roles')->assertOk()['meta']['permissions'];
        $this->assertSame(1, array_count_values($catalog)[self::AUDIT] ?? 0);

        $created = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'مدقق تكامل', 'permissions' => [self::AUDIT],
        ])->assertCreated()['data'];
        $this->assertSame([self::AUDIT], $this->permsOf($created['id']));

        $this->withToken($auth['token'])->putJson("/api/roles/{$created['id']}", [
            'name' => 'مدقق تكامل', 'permissions' => [self::AUDIT, 'delivery_connector.view'],
        ])->assertOk();
        $this->assertSame(['delivery_connector.audit.view', 'delivery_connector.view'], $this->permsOf($created['id']));

        // قواعد التحقق الحالية لم تتغيّر: مفتاح قريب الاسم مرفوض، والنجمة مرفوضة.
        foreach (['delivery_connector.audit.manage', 'delivery_connector.audit', 'Delivery_Connector.audit.view', 'audit.view'] as $bad) {
            $this->withToken($auth['token'])->postJson('/api/roles', ['name' => 'سيئ', 'permissions' => [$bad]])->assertStatus(422);
        }
        $this->withToken($auth['token'])->postJson('/api/roles', ['name' => 'نجمة', 'permissions' => ['*']])->assertStatus(422);
    }

    /** @test */
    public function the_grant_ceiling_blocks_granting_a_key_the_actor_does_not_hold(): void
    {
        $auth = $this->tenant();
        // مدير أدوار بلا مفتاح التدقيق.
        [$managerRole, , $managerToken] = $this->customRole($auth, ['roles.view', 'roles.manage', 'products.view'], 'rm@acme.test');

        $this->withToken($managerToken)->postJson('/api/roles', [
            'name' => 'تصعيد', 'permissions' => [self::AUDIT],
        ])->assertForbidden();
        $this->assertNull(Role::where('name', 'تصعيد')->first());

        // ولا يضيفه إلى دوره هو ولا إلى دور أضيق قائم.
        $this->withToken($managerToken)->putJson("/api/roles/{$managerRole}", [
            'name' => 'x', 'permissions' => ['roles.view', 'roles.manage', 'products.view', self::AUDIT],
        ])->assertForbidden();
        $narrow = $this->withToken($auth['token'])->postJson('/api/roles', ['name' => 'ضيق', 'permissions' => ['products.view']])->assertCreated()['data']['id'];
        $this->withToken($managerToken)->putJson("/api/roles/{$narrow}", [
            'name' => 'ضيق', 'permissions' => ['products.view', self::AUDIT],
        ])->assertForbidden();
        $this->assertSame(['products.view'], $this->permsOf($narrow));
    }

    /** @test */
    public function an_actor_who_holds_the_key_can_grant_exactly_it_but_not_the_siblings(): void
    {
        $auth = $this->tenant();
        [, , $token] = $this->customRole($auth, ['roles.view', 'roles.manage', self::AUDIT], 'holder@acme.test');

        $this->withToken($token)->postJson('/api/roles', ['name' => 'يمنح التدقيق', 'permissions' => [self::AUDIT]])->assertCreated();

        // لا تسلسل هرمي: امتلاك التدقيق لا يتيح منح view/manage/reassign (يخرج عن سقفه).
        foreach (self::SIBLINGS as $key) {
            $this->withToken($token)->postJson('/api/roles', ['name' => 'شقيق '.$key, 'permissions' => [$key]])->assertForbidden();
        }
    }

    /** @test */
    public function covers_is_directional_and_exact_for_the_new_key(): void
    {
        $this->assertTrue(Rbac::covers(['*'], [self::AUDIT]));
        $this->assertTrue(Rbac::covers([self::AUDIT], [self::AUDIT]));
        $this->assertFalse(Rbac::covers(self::SIBLINGS, [self::AUDIT]));
        foreach (self::SIBLINGS as $key) {
            $this->assertFalse(Rbac::covers([self::AUDIT], [$key]), $key);
        }
    }
}
