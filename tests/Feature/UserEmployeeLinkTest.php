<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * طبقة الربط `User ⊃ Employee` — المستخدم موظفٌ يدخل النظام.
 * (design-system/foundations/hr-users-architecture.md)
 * تشغيل:  php artisan test --filter=UserEmployeeLinkTest
 */
class UserEmployeeLinkTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** ينشئ موظفاً عبر الـ API ويعيد معرّفه. */
    private function makeEmployee(string $token, string $name = 'موظف'): string
    {
        return $this->withToken($token)->postJson('/api/employees', [
            'name' => $name, 'basic_salary' => 500000,
        ])->assertCreated()['data']['id'];
    }

    /**
     * يرفع حدّ المستخدمين لخطة المستأجر — لاختبار منطق الربط دون أن يحجبه
     * سقف خطة `free` (مستخدمان). بلا هذا كان اختبار التفرّد ينجح لسبب خاطئ.
     */
    private function liftUserCap(string $tenantId): void
    {
        Tenant::find($tenantId)->update(['plan_limits' => ['users' => null]]);
    }

    /** @test */
    public function a_user_can_be_created_linked_to_an_employee(): void
    {
        $auth = $this->registerTenant();
        $employeeId = $this->makeEmployee($auth['token'], 'ريم الناصر');

        $res = $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'ريم الناصر', 'email' => 'reem@acme.test',
            'password' => 'password123', 'role' => 'accountant',
            'employee_id' => $employeeId,
        ])->assertCreated();

        $res->assertJsonPath('data.employee_id', $employeeId);
        $res->assertJsonPath('data.employee.name', 'ريم الناصر');

        // العلاقتان تعملان في الاتجاهين.
        app(TenantContext::class)->set($auth['tenant_id']);
        $user = User::where('email', 'reem@acme.test')->firstOrFail();
        $this->assertSame($employeeId, $user->employee->id);
        $this->assertSame($user->id, $user->employee->user->id);
    }

    /** @test */
    public function a_user_without_an_employee_is_still_allowed(): void
    {
        $auth = $this->registerTenant(); // المالك نفسه بلا employee_id

        $this->withToken($auth['token'])->getJson('/api/users')
            ->assertOk()->assertJsonPath('data.0.employee_id', null);

        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'مستخدم حرّ', 'email' => 'free@acme.test',
            'password' => 'password123', 'role' => 'staff',
        ])->assertCreated()->assertJsonPath('data.employee_id', null);
    }

    /** @test */
    public function an_employee_cannot_be_linked_to_two_users(): void
    {
        $auth = $this->registerTenant();
        $this->liftUserCap($auth['tenant_id']); // نحتاج المالك + مستخدمَين
        $employeeId = $this->makeEmployee($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'الأول', 'email' => 'first@acme.test',
            'password' => 'password123', 'role' => 'staff', 'employee_id' => $employeeId,
        ])->assertCreated();

        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'الثاني', 'email' => 'second@acme.test',
            'password' => 'password123', 'role' => 'staff', 'employee_id' => $employeeId,
        ])->assertStatus(422);
    }

    /** @test */
    public function an_employee_of_another_tenant_cannot_be_linked(): void
    {
        $other = $this->registerTenant('other', 'owner@other.test');
        $otherEmployeeId = $this->makeEmployee($other['token']);

        $auth = $this->registerTenant('acme', 'owner@acme.test');

        // معرّف موظفٍ من مستأجرٍ آخر يُرفض (العزل يصدّه بـ«غير موجود»).
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'دخيل', 'email' => 'x@acme.test',
            'password' => 'password123', 'role' => 'staff', 'employee_id' => $otherEmployeeId,
        ])->assertStatus(422);
    }

    /** @test */
    public function updating_can_link_then_unlink_an_employee(): void
    {
        $auth = $this->registerTenant();
        $this->liftUserCap($auth['tenant_id']); // المالك + «م» + «بديل»
        $employeeId = $this->makeEmployee($auth['token']);

        $userId = $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'م', 'email' => 'm@acme.test', 'password' => 'password123', 'role' => 'staff',
        ])->assertCreated()['data']['id'];

        // ربط عبر التعديل
        $this->withToken($auth['token'])->putJson("/api/users/{$userId}", [
            'employee_id' => $employeeId,
        ])->assertOk()->assertJsonPath('data.employee_id', $employeeId);

        // فكّ الربط بإرسال null صريحة
        $this->withToken($auth['token'])->putJson("/api/users/{$userId}", [
            'employee_id' => null,
        ])->assertOk()->assertJsonPath('data.employee_id', null);

        // وبعد فكّه يصير الموظف متاحاً لمستخدم آخر
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'بديل', 'email' => 'alt@acme.test',
            'password' => 'password123', 'role' => 'staff', 'employee_id' => $employeeId,
        ])->assertCreated();
    }

    /** @test */
    public function deleting_an_employee_nulls_the_link_not_the_user(): void
    {
        $auth = $this->registerTenant();
        $employeeId = $this->makeEmployee($auth['token']);

        $userId = $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'م', 'email' => 'm@acme.test', 'password' => 'password123',
            'role' => 'staff', 'employee_id' => $employeeId,
        ])->assertCreated()['data']['id'];

        $this->withToken($auth['token'])->deleteJson("/api/employees/{$employeeId}")->assertOk();

        // المستخدم باقٍ، والربط انفكّ (nullOnDelete).
        app(TenantContext::class)->set($auth['tenant_id']);
        $user = User::findOrFail($userId);
        $this->assertNull($user->employee_id);
    }
}
