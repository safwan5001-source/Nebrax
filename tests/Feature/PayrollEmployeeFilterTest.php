<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * تصفية `GET /payroll-runs?employee_id=` — لعرض سجلّ راتب موظفٍ واحد في صفحة
 * ملفّه دون جلب كل سطور المسيّر (بقية الموظفين).
 *
 * تشغيل: php artisan test --filter=PayrollEmployeeFilterTest
 */
class PayrollEmployeeFilterTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function filtering_by_employee_id_returns_only_that_employees_item_per_run(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];

        $emp1 = $this->withToken($token)->postJson('/api/employees', ['name' => 'موظف أول', 'basic_salary' => 500000])
            ->assertCreated()['data']['id'];
        $emp2 = $this->withToken($token)->postJson('/api/employees', ['name' => 'موظف ثانٍ', 'basic_salary' => 600000])
            ->assertCreated()['data']['id'];

        $run = $this->withToken($token)->postJson('/api/payroll-runs', ['period' => '2026-01'])
            ->assertCreated()['data'];

        $res = $this->withToken($token)->getJson("/api/payroll-runs?employee_id={$emp1}")->assertOk();

        $res->assertJsonCount(1, 'data');
        $items = $res['data'][0]['items'];
        $this->assertCount(1, $items);
        $this->assertSame($emp1, $items[0]['employee_id']);
        $this->assertNotSame($emp2, $items[0]['employee_id']);
    }

    /** @test */
    public function employees_with_no_payroll_history_get_an_empty_list(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];

        $emp = $this->withToken($token)->postJson('/api/employees', ['name' => 'موظف جديد', 'basic_salary' => 500000])
            ->assertCreated()['data']['id'];

        // مسيّرٌ يشمل الموظف تلقائياً لكنه لم يُبنَ بعد — لا مسيّرات أصلاً هنا.
        $this->withToken($token)->getJson("/api/payroll-runs?employee_id={$emp}")
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }
}
