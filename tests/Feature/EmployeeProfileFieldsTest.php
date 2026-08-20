<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * حقول ملف الموظف الإضافية (تجزئة الاسم، الجنسية/الإقامة، التواصل، العمل،
 * المدير المباشر، الوردية الافتراضية) — مقارنةً بنموذج دفترة.
 * انظر design-system/foundations/hr-users-architecture.md.
 * تشغيل: php artisan test --filter=EmployeeProfileFieldsTest
 */
class EmployeeProfileFieldsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function makeEmployee(string $token, array $over = []): array
    {
        return $this->withToken($token)->postJson('/api/employees', array_merge([
            'name' => 'موظف', 'basic_salary' => 500000,
        ], $over))->assertCreated()['data'];
    }

    /** @test */
    public function an_employee_can_be_created_with_the_new_profile_fields(): void
    {
        $auth = $this->registerTenant();

        $emp = $this->makeEmployee($auth['token'], [
            'name' => 'أكرم المهدي',
            'first_name' => 'أكرم', 'middle_name' => 'محمد', 'last_name' => 'المهدي',
            'nationality' => 'اليمن', 'residency_expiry_date' => '2027-01-15',
            'phone' => '0558477233', 'personal_email' => 'akram@example.com',
            'department' => 'قسم المبيعات', 'employment_type' => 'full_time',
        ]);

        $this->assertSame('أكرم', $emp['first_name']);
        $this->assertSame('محمد', $emp['middle_name']);
        $this->assertSame('المهدي', $emp['last_name']);
        $this->assertSame('اليمن', $emp['nationality']);
        $this->assertSame('2027-01-15', $emp['residency_expiry_date']);
        $this->assertSame('0558477233', $emp['phone']);
        $this->assertSame('akram@example.com', $emp['personal_email']);
        $this->assertSame('قسم المبيعات', $emp['department']);
        $this->assertSame('full_time', $emp['employment_type']);
    }

    /** @test */
    public function an_unknown_employment_type_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/employees', [
            'name' => 'موظف', 'basic_salary' => 500000, 'employment_type' => 'ceo',
        ])->assertStatus(422);
    }

    /** @test */
    public function an_employee_cannot_be_its_own_manager(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token']);

        $this->withToken($auth['token'])->putJson("/api/employees/{$emp['id']}", [
            'manager_id' => $emp['id'],
        ])->assertStatus(422);
    }

    /** @test */
    public function a_manager_can_be_assigned_and_is_exposed_on_the_resource(): void
    {
        $auth = $this->registerTenant();
        $boss = $this->makeEmployee($auth['token'], ['name' => 'المدير']);
        $emp = $this->makeEmployee($auth['token'], ['name' => 'مرؤوس']);

        $res = $this->withToken($auth['token'])->putJson("/api/employees/{$emp['id']}", [
            'manager_id' => $boss['id'],
        ])->assertOk();

        $res->assertJsonPath('data.manager_id', $boss['id']);
        $res->assertJsonPath('data.manager.name', 'المدير');
    }

    /** @test */
    public function a_manager_belonging_to_another_tenant_cannot_be_assigned(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');

        $bossB = $this->makeEmployee($b['token'], ['name' => 'مدير بيتا']);
        $empA = $this->makeEmployee($a['token']);

        $this->withToken($a['token'])->putJson("/api/employees/{$empA['id']}", [
            'manager_id' => $bossB['id'],
        ])->assertStatus(422);
    }

    /** @test */
    public function a_shift_from_a_different_branch_can_still_be_assigned_since_the_employee_is_company_wide(): void
    {
        $auth = $this->registerTenant();

        // الوردية تُنشأ تحت فرعٍ نشط محدَّد (الخبر)...
        $khobar = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])['data']['id'];
        $shift = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson('/api/shifts', [
                'name' => 'صباحية', 'start_time' => '08:00', 'end_time' => '16:00', 'work_days' => [0, 1, 2, 3, 4],
            ])->assertCreated()['data']['id'];

        // ...والموظف يُربط بها من سياقٍ بلا فرعٍ نشط (المؤسسة كلها) — يجب أن ينجح
        // لأن الموظف CompanyWide، لا BranchScope عادياً يرفض ورديةً من فرعٍ آخر.
        $emp = $this->makeEmployee($auth['token']);
        $this->withToken($auth['token'])->putJson("/api/employees/{$emp['id']}", [
            'shift_id' => $shift,
        ])->assertOk()->assertJsonPath('data.shift_id', $shift);
    }

    /** @test */
    public function a_shift_belonging_to_another_tenant_cannot_be_assigned(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');

        $shiftB = $this->withToken($b['token'])->postJson('/api/shifts', [
            'name' => 'صباحية', 'start_time' => '08:00', 'end_time' => '16:00', 'work_days' => [0, 1, 2],
        ])->assertCreated()['data']['id'];

        $empA = $this->makeEmployee($a['token']);
        $this->withToken($a['token'])->putJson("/api/employees/{$empA['id']}", [
            'shift_id' => $shiftB,
        ])->assertStatus(422);
    }
}
