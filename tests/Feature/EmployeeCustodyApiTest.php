<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class EmployeeCustodyApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function owner_can_create_and_view_a_draft_custody_while_staff_cannot_manage_it(): void
    {
        $auth = $this->registerTenant('custody-api', 'owner-custody@example.test');
        $employee = $this->withToken($auth['token'])->postJson('/api/employees', [
            'name' => 'موظف العهدة',
            'basic_salary' => 0,
            'is_active' => true,
        ])->assertCreated()['data'];

        $custody = $this->withToken($auth['token'])->postJson('/api/employee-custodies', [
            'employee_id' => $employee['id'],
            'method' => 'cash',
            'custody_date' => '2026-08-19',
            'amount' => 50000,
            'notes' => 'عهدة تشغيلية',
        ])->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.amount', '500.00')['data'];

        $this->withToken($auth['token'])
            ->getJson("/api/employee-custodies/{$custody['id']}")
            ->assertOk()
            ->assertJsonPath('data.employee_id', $employee['id']);

        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff-custody@example.test');
        $this->withToken($staff)
            ->getJson('/api/employee-custodies')
            ->assertOk()
            ->assertJsonCount(1, 'data');
        $this->withToken($staff)
            ->postJson("/api/employee-custodies/{$custody['id']}/post")
            ->assertForbidden();
    }

    /** التسوية تظهر في سجل العهدة، تُنقص الرصيد، وتحمي نوع التسوية المستخدم من الحذف. */
    /** @test */
    public function owner_can_settle_a_posted_custody_with_an_active_type_and_a_postable_debit_account(): void
    {
        $auth = $this->registerTenant('custody-settlement-api', 'owner-custody-settlement@example.test');
        $employee = $this->withToken($auth['token'])->postJson('/api/employees', [
            'name' => 'موظف التسوية',
            'basic_salary' => 0,
            'is_active' => true,
        ])->assertCreated()['data'];
        $type = $this->withToken($auth['token'])->postJson('/api/settlement-types', [
            'name' => 'مصروفات عهدة',
            'is_active' => true,
        ])->assertCreated()['data'];
        $account = collect($this->withToken($auth['token'])->getJson('/api/accounts')
            ->assertOk()['data'])->firstWhere('code', '5150');
        $this->assertNotNull($account);

        $custody = $this->withToken($auth['token'])->postJson('/api/employee-custodies', [
            'employee_id' => $employee['id'],
            'method' => 'cash',
            'custody_date' => '2026-08-20',
            'amount' => 50000,
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])
            ->postJson("/api/employee-custodies/{$custody['id']}/post")
            ->assertOk();

        $settlement = $this->withToken($auth['token'])
            ->postJson("/api/employee-custodies/{$custody['id']}/settlements", [
                'settlement_type_id' => $type['id'],
                'debit_account_id' => $account['id'],
                'settlement_date' => '2026-08-20',
                'amount' => 20000,
                'notes' => 'تسوية وقود',
            ])
            ->assertCreated()
            ->assertJsonPath('data.amount', '200.00')['data'];

        $this->assertStringStartsWith('CSTL-2026-', $settlement['number']);
        $this->withToken($auth['token'])
            ->getJson("/api/employee-custodies/{$custody['id']}")
            ->assertOk()
            ->assertJsonPath('data.remaining_amount', '300.00')
            ->assertJsonPath('data.settlements_count', 1)
            ->assertJsonCount(1, 'data.settlements');
        $this->withToken($auth['token'])
            ->getJson("/api/employee-custodies/{$custody['id']}/settlements")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $settlement['id']);
        $this->withToken($auth['token'])
            ->deleteJson("/api/settlement-types/{$type['id']}")
            ->assertStatus(422);
    }

    /** @test */
    public function a_posted_custody_is_rejected_by_the_delete_endpoint(): void
    {
        $auth = $this->registerTenant('custody-delete', 'owner-delete@example.test');
        $employee = $this->withToken($auth['token'])->postJson('/api/employees', [
            'name' => 'موظف العهدة',
            'basic_salary' => 0,
            'is_active' => true,
        ])->assertCreated()['data'];

        $custody = $this->withToken($auth['token'])->postJson('/api/employee-custodies', [
            'employee_id' => $employee['id'],
            'method' => 'cash',
            'custody_date' => '2026-08-19',
            'amount' => 50000,
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])
            ->postJson("/api/employee-custodies/{$custody['id']}/post")
            ->assertOk()
            ->assertJsonPath('data.status', 'posted');
        $this->withToken($auth['token'])
            ->deleteJson("/api/employee-custodies/{$custody['id']}")
            ->assertStatus(422);
    }
}
