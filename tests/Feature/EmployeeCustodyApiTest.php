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
