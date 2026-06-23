<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات إدارة مستخدمي المؤسسة (owner/admin) + حدّ الخطة + العزل.
 * تشغيل:  php artisan test --filter=UserManagementTest
 */
class UserManagementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function owner_can_list_and_create_users(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->getJson('/api/users')
            ->assertOk()->assertJsonCount(1, 'data'); // المالك

        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'محاسب', 'email' => 'acc@acme.test', 'password' => 'password123', 'role' => 'accountant',
        ])->assertCreated()->assertJsonPath('data.role', 'accountant');

        $this->withToken($auth['token'])->getJson('/api/users')->assertJsonCount(2, 'data');
    }

    /** @test */
    public function email_must_be_unique_within_tenant(): void
    {
        $auth = $this->registerTenant('nibras', 'owner@nibras.test');

        $payload = ['name' => 'م', 'email' => 'dup@nibras.test', 'password' => 'password123', 'role' => 'staff'];
        $this->withToken($auth['token'])->postJson('/api/users', $payload)->assertCreated();
        $this->withToken($auth['token'])->postJson('/api/users', $payload)->assertStatus(422);
    }

    /** @test */
    public function accountant_and_staff_cannot_manage_users(): void
    {
        $auth = $this->registerTenant();
        $acc = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@acme.test');

        $this->withToken($acc)->getJson('/api/users')->assertForbidden();
        $this->withToken($acc)->postJson('/api/users', [
            'name' => 'x', 'email' => 'x@acme.test', 'password' => 'password123', 'role' => 'staff',
        ])->assertForbidden();
    }

    /** @test */
    public function plan_limit_blocks_adding_users_beyond_cap(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        Tenant::find($auth['tenant_id'])->update(['plan_limits' => ['users' => 2]]);

        // المالك = 1، نضيف الثاني (مسموح) ثم الثالث (ممنوع)
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'ثانٍ', 'email' => 'u2@acme.test', 'password' => 'password123', 'role' => 'staff',
        ])->assertCreated();

        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'ثالث', 'email' => 'u3@acme.test', 'password' => 'password123', 'role' => 'staff',
        ])->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'حدّ خطتك'));
    }

    /** @test */
    public function a_user_cannot_delete_their_own_account(): void
    {
        $auth = $this->registerTenant();
        $me = $this->withToken($auth['token'])->getJson('/api/me')['user'];

        $this->withToken($auth['token'])->deleteJson("/api/users/{$me['id']}")
            ->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'حسابك'));
    }

    /** @test */
    public function a_tenant_cannot_see_or_edit_another_tenants_user(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');

        $userA = $this->withToken($a['token'])->postJson('/api/users', [
            'name' => 'موظف ألفا', 'email' => 'emp@alpha.test', 'password' => 'password123', 'role' => 'staff',
        ])['data']['id'];

        // B لا يرى مستخدم A، ولا يستطيع تعديله/حذفه بمعرّفه الصحيح
        $this->withToken($b['token'])->putJson("/api/users/{$userA}", ['role' => 'admin'])->assertNotFound();
        $this->withToken($b['token'])->deleteJson("/api/users/{$userA}")->assertNotFound();
        $this->assertCount(1, $this->withToken($b['token'])->getJson('/api/users')['data']); // المالك فقط
    }
}
