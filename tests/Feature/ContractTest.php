<?php

namespace Tests\Feature;

use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * عقود الموظفين — مصدر الراتب الفعلي (design-system/foundations/
 * hr-users-architecture.md «القرار النهائي — الراتب يتبع العقد»).
 * تشغيل: php artisan test --filter=ContractTest
 */
class ContractTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function employee(string $token): string
    {
        return $this->withToken($token)->postJson('/api/employees', ['name' => 'موظف'])
            ->assertCreated()['data']['id'];
    }

    /** @test */
    public function a_contract_can_be_created_listed_and_updated(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/contracts", [
            'type' => 'permanent', 'start_date' => '2026-01-01',
            'basic_salary' => 500000, 'allowances' => 100000, 'gosi' => 58500, 'other_deductions' => 0,
        ])->assertCreated()['data'];

        $this->assertSame('permanent', $created['type']);
        $this->assertSame('active', $created['status']);
        $this->assertSame('5000.00', $created['basic_salary']);
        $this->assertSame('6000.00', $created['gross']);
        $this->assertSame('5415.00', $created['net']);

        $this->withToken($auth['token'])->getJson("/api/employees/{$emp}/contracts")
            ->assertOk()->assertJsonCount(1, 'data');

        $updated = $this->withToken($auth['token'])->putJson("/api/employees/{$emp}/contracts/{$created['id']}", [
            'basic_salary' => 600000,
        ])->assertOk()['data'];
        $this->assertSame('6000.00', $updated['basic_salary']);
    }

    /** @test */
    public function an_overlapping_active_contract_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);

        $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/contracts", [
            'type' => 'permanent', 'start_date' => '2026-01-01', 'basic_salary' => 500000,
        ])->assertCreated();

        $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/contracts", [
            'type' => 'permanent', 'start_date' => '2026-06-01', 'basic_salary' => 600000,
        ])->assertStatus(422);
    }

    /** @test */
    public function a_terminated_contract_does_not_block_a_new_overlapping_one(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);

        $old = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/contracts", [
            'type' => 'permanent', 'start_date' => '2026-01-01', 'basic_salary' => 500000,
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->putJson("/api/employees/{$emp}/contracts/{$old['id']}", [
            'status' => 'terminated', 'end_date' => '2026-05-31',
        ])->assertOk();

        $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/contracts", [
            'type' => 'permanent', 'start_date' => '2026-06-01', 'basic_salary' => 700000,
        ])->assertCreated();
    }

    /** @test */
    public function a_contract_can_be_deleted(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/contracts", [
            'type' => 'permanent', 'start_date' => '2026-01-01', 'basic_salary' => 500000,
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->deleteJson("/api/employees/{$emp}/contracts/{$created['id']}")->assertOk();
        $this->withToken($auth['token'])->getJson("/api/employees/{$emp}/contracts")
            ->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function contracts_are_isolated_per_tenant(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');
        $empB = $this->employee($b['token']);

        $this->withToken($a['token'])->getJson("/api/employees/{$empB}/contracts")->assertStatus(404);
        $this->withToken($a['token'])->postJson("/api/employees/{$empB}/contracts", [
            'type' => 'permanent', 'start_date' => '2026-01-01', 'basic_salary' => 500000,
        ])->assertStatus(404);
    }

    /** @test */
    public function the_employee_resource_exposes_its_active_contract_salary_not_the_legacy_columns(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);

        // بلا عقد بعد — الأرقام صفر رغم أن basic_salary لم تُرسَل أصلاً عند الإنشاء.
        $noContract = $this->withToken($auth['token'])->getJson("/api/employees/{$emp}")->assertOk()['data'];
        $this->assertNull($noContract['active_contract_id']);
        $this->assertSame('0.00', $noContract['basic_salary']);

        $contract = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/contracts", [
            'type' => 'permanent', 'start_date' => '2026-01-01', 'basic_salary' => 500000, 'allowances' => 100000,
        ])->assertCreated()['data'];

        $withContract = $this->withToken($auth['token'])->getJson("/api/employees/{$emp}")->assertOk()['data'];
        $this->assertSame($contract['id'], $withContract['active_contract_id']);
        $this->assertSame('5000.00', $withContract['basic_salary']);
        $this->assertSame('6000.00', $withContract['gross']);
    }

    /** @test */
    public function an_employee_with_no_active_contract_is_silently_excluded_from_the_payroll_run(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $withContract = $this->employee($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/employees/{$withContract}/contracts", [
            'type' => 'permanent', 'start_date' => '2020-01-01', 'basic_salary' => 500000,
        ])->assertCreated();

        $withoutContract = $this->employee($auth['token']); // بلا عقد إطلاقاً

        $run = $this->withToken($auth['token'])->postJson('/api/payroll-runs', ['period' => '2026-01'])
            ->assertCreated()['data'];

        $this->assertCount(1, $run['items']);
        $this->assertSame($withContract, $run['items'][0]['employee_id']);
        $this->assertNotSame($withoutContract, $run['items'][0]['employee_id']);
    }

    /** @test */
    public function a_payroll_run_uses_the_contract_active_at_the_period_start_not_todays_contract(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $emp = $this->employee($auth['token']);

        // عقدٌ قديمٌ حتى نهاية يناير، ثم عقدٌ جديد من فبراير — نُنشئ مسيّراً عن يناير.
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/contracts", [
            'type' => 'permanent', 'start_date' => '2026-01-01', 'end_date' => '2026-01-31', 'basic_salary' => 400000,
        ])->assertCreated();

        $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/contracts", [
            'type' => 'permanent', 'start_date' => '2026-02-01', 'basic_salary' => 900000,
        ])->assertCreated();

        $run = $this->withToken($auth['token'])->postJson('/api/payroll-runs', ['period' => '2026-01'])
            ->assertCreated()['data'];

        $this->assertSame('4000.00', $run['total_gross']);
    }
}
