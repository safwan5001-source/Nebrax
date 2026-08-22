<?php

namespace Tests\Feature;

use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * بوابة الخدمة الذاتية للموظف (`/me/*`) — دورٌ مقيَّد ضمن RBAC القائم
 * (`self_service.access`)، لا مسار دخولٍ منفصل. الضمان المختبَر هنا هو
 * البنيويّ: لا تسريب بين بيانات موظفين، ولا صلاحية hr.* واسعة.
 * تشغيل: php artisan test --filter=SelfServiceTest
 */
class SelfServiceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** ينشئ موظفاً بعقد نشط، ثم مستخدم دخول بدور self_service مربوطاً به. */
    private function selfServiceEmployee(string $ownerToken, string $tenantId, string $name, int $basicSalary, string $email): array
    {
        $employeeId = $this->withToken($ownerToken)->postJson('/api/employees', ['name' => $name])
            ->assertCreated()['data']['id'];

        $this->withToken($ownerToken)->postJson("/api/employees/{$employeeId}/contracts", [
            'type' => 'permanent', 'start_date' => '2026-01-01',
            'items' => $this->basicSalaryItems($basicSalary),
        ])->assertCreated();

        app(TenantContext::class)->set($tenantId);
        $user = User::create([
            'tenant_id'   => $tenantId,
            'employee_id' => $employeeId,
            'name'        => $name,
            'email'       => $email,
            'password'    => 'password123',
            'role'        => 'self_service',
        ]);

        return ['employee_id' => $employeeId, 'token' => $user->createToken('api')->plainTextToken];
    }

    /** @test */
    public function the_self_service_role_is_seeded_and_assignable_via_the_users_api(): void
    {
        $auth = $this->registerTenant();

        $roles = $this->withToken($auth['token'])->getJson('/api/roles')->assertOk()['data'];
        $slugs = array_column($roles, 'slug');
        $this->assertContains('self_service', $slugs);
    }

    /** @test */
    public function a_self_service_user_sees_only_their_own_profile_contract_and_payroll(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];

        $me = $this->selfServiceEmployee($token, $auth['tenant_id'], 'سارة', 500000, 'sara@acme.test');
        $other = $this->selfServiceEmployee($token, $auth['tenant_id'], 'خالد', 900000, 'khalid@acme.test');

        // الملف الشخصي: بيانات سارة فقط، ولو حاولت عبر رابطٍ مباشر لا مسار لموظفٍ آخر أصلاً.
        $this->withToken($me['token'])->getJson('/api/me/profile')
            ->assertOk()->assertJsonPath('data.id', $me['employee_id'])
            ->assertJsonPath('data.name', 'سارة');

        // العقد: راتب سارة فقط، لا راتب خالد رغم فرق المبلغ الواضح.
        $this->withToken($me['token'])->getJson('/api/me/contract')
            ->assertOk()->assertJsonPath('data.basic_salary', '5000.00');

        // الرواتب المرحّلة فقط تظهر — لا مسوّدات.
        $this->withToken($token)->postJson('/api/payroll-runs', ['period' => '2026-02'])->assertCreated();
        $this->withToken($me['token'])->getJson('/api/me/payroll-items')
            ->assertOk()->assertJsonCount(0, 'data'); // لا يزال مسوّدة

        $run = $this->withToken($token)->getJson('/api/payroll-runs')['data'][0];
        $this->withToken($token)->postJson("/api/payroll-runs/{$run['id']}/post")->assertOk();

        $items = $this->withToken($me['token'])->getJson('/api/me/payroll-items')->assertOk()['data'];
        $this->assertCount(1, $items);
        $this->assertSame($me['employee_id'], $items[0]['employee_id']);
        $this->assertSame('5000.00', $items[0]['basic_salary']);
    }

    /** @test */
    public function a_self_service_user_cannot_see_the_broad_hr_endpoints(): void
    {
        $auth = $this->registerTenant();
        $me = $this->selfServiceEmployee($auth['token'], $auth['tenant_id'], 'سارة', 500000, 'sara@acme.test');

        $this->withToken($me['token'])->getJson('/api/employees')->assertForbidden();
        $this->withToken($me['token'])->getJson('/api/attendances')->assertForbidden();
        $this->withToken($me['token'])->getJson('/api/payroll-runs')->assertForbidden();
    }

    /** @test */
    public function a_self_service_user_can_check_in_and_check_out_their_own_attendance(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];
        $me = $this->selfServiceEmployee($token, $auth['tenant_id'], 'سارة', 500000, 'sara@acme.test');

        $checkIn = $this->withToken($me['token'])->postJson('/api/me/attendance/check-in')
            ->assertStatus(201)['data'];
        $this->assertNotNull($checkIn['check_in']);
        $this->assertNull($checkIn['check_out']);

        // حضورٌ مكرَّر في نفس اليوم مرفوض.
        $this->withToken($me['token'])->postJson('/api/me/attendance/check-in')->assertStatus(422);

        $checkOut = $this->withToken($me['token'])->postJson('/api/me/attendance/check-out')
            ->assertOk()['data'];
        $this->assertNotNull($checkOut['check_out']);

        // الحضور مرئيٌّ للموارد البشرية عبر المسار الاعتيادي أيضاً — نفس السجلّ.
        $this->withToken($token)->getJson('/api/attendances')->assertOk()->assertJsonCount(1, 'data');

        // انصرافٌ ثانٍ في نفس اليوم مرفوض.
        $this->withToken($me['token'])->postJson('/api/me/attendance/check-out')->assertStatus(422);

        $this->withToken($me['token'])->getJson('/api/me/attendances')->assertOk()->assertJsonCount(1, 'data');
    }

    /** @test */
    public function checking_out_without_checking_in_first_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $me = $this->selfServiceEmployee($auth['token'], $auth['tenant_id'], 'سارة', 500000, 'sara@acme.test');

        $this->withToken($me['token'])->postJson('/api/me/attendance/check-out')->assertStatus(422);
    }
}
