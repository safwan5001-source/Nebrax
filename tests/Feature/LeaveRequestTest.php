<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * طلبات الإجازة — إنشاء/موافقة/رفض/إلغاء، عزل التقاطع، والرصيد المباشر
 * (design-system/foundations/hr-users-architecture.md «الإجازات»).
 * تشغيل: php artisan test --filter=LeaveRequestTest
 */
class LeaveRequestTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function employee(string $token): string
    {
        return $this->withToken($token)->postJson('/api/employees', ['name' => 'موظف'])
            ->assertCreated()['data']['id'];
    }

    private function leaveType(string $token, array $over = []): array
    {
        return $this->withToken($token)->postJson('/api/leave-types', array_merge([
            'name' => 'سنوية', 'is_paid' => true, 'annual_days' => 21, 'requires_approval' => true,
        ], $over))->assertCreated()['data'];
    }

    /** @test */
    public function a_leave_request_starts_pending_when_its_type_requires_approval(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->leaveType($auth['token']);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-03-01', 'end_date' => '2026-03-05',
            'reason' => 'سفر',
        ])->assertCreated()['data'];

        $this->assertSame('pending', $created['status']);
        $this->assertSame(5, $created['days_count']); // شامل الطرفين
        $this->assertNull($created['approved_by']);
    }

    /** @test */
    public function a_leave_request_is_auto_approved_when_its_type_does_not_require_approval(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->leaveType($auth['token'], ['requires_approval' => false]);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-03-01', 'end_date' => '2026-03-01',
        ])->assertCreated()['data'];

        $this->assertSame('approved', $created['status']);
        $this->assertSame(1, $created['days_count']);
        $this->assertNotNull($created['approved_at']);
    }

    /** @test */
    public function overlapping_pending_or_approved_requests_are_rejected(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->leaveType($auth['token']);

        $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-03-01', 'end_date' => '2026-03-10',
        ])->assertCreated();

        $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-03-05', 'end_date' => '2026-03-15',
        ])->assertStatus(422);
    }

    /** @test */
    public function a_rejected_request_does_not_block_a_new_overlapping_one(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->leaveType($auth['token']);

        $first = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-03-01', 'end_date' => '2026-03-10',
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->postJson("/api/leave-requests/{$first['id']}/reject", [
            'rejection_reason' => 'ضغط عمل',
        ])->assertOk()->assertJsonPath('data.status', 'rejected');

        $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-03-05', 'end_date' => '2026-03-15',
        ])->assertCreated();
    }

    /** @test */
    public function approving_a_pending_request_records_the_approver(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->leaveType($auth['token']);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-03-01', 'end_date' => '2026-03-03',
        ])->assertCreated()['data'];

        $approved = $this->withToken($auth['token'])->postJson("/api/leave-requests/{$created['id']}/approve")
            ->assertOk()['data'];

        $this->assertSame('approved', $approved['status']);
        $this->assertNotNull($approved['approved_by']);
        $this->assertNotNull($approved['approved_at']);
    }

    /** @test */
    public function a_non_pending_request_cannot_be_approved_rejected_or_cancelled_again(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->leaveType($auth['token']);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-03-01', 'end_date' => '2026-03-03',
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->postJson("/api/leave-requests/{$created['id']}/approve")->assertOk();

        $this->withToken($auth['token'])->postJson("/api/leave-requests/{$created['id']}/approve")->assertStatus(422);
        $this->withToken($auth['token'])->postJson("/api/leave-requests/{$created['id']}/reject")->assertStatus(422);
        $this->withToken($auth['token'])->deleteJson("/api/leave-requests/{$created['id']}")->assertStatus(422);
    }

    /** @test */
    public function a_pending_request_can_be_cancelled(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->leaveType($auth['token']);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-03-01', 'end_date' => '2026-03-03',
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->deleteJson("/api/leave-requests/{$created['id']}")->assertOk();
        $this->withToken($auth['token'])->getJson("/api/employees/{$emp}/leave-requests")
            ->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function the_global_queue_filters_by_status_and_employee(): void
    {
        $auth = $this->registerTenant();
        $emp1 = $this->employee($auth['token']);
        $emp2 = $this->employee($auth['token']);
        $type = $this->leaveType($auth['token']);

        $req1 = $this->withToken($auth['token'])->postJson("/api/employees/{$emp1}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-03-01', 'end_date' => '2026-03-03',
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp2}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-04-01', 'end_date' => '2026-04-02',
        ])->assertCreated();
        $this->withToken($auth['token'])->postJson("/api/leave-requests/{$req1['id']}/approve")->assertOk();

        $this->withToken($auth['token'])->getJson('/api/leave-requests?status=pending')
            ->assertOk()->assertJsonCount(1, 'data');
        $this->withToken($auth['token'])->getJson("/api/leave-requests?employee_id={$emp1}")
            ->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.status', 'approved');
    }

    /** @test */
    public function balance_only_counts_approved_requests_within_the_year(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->leaveType($auth['token'], ['annual_days' => 21]);

        // معتمد ضمن السنة (٥ أيام) — يُحتسب.
        $approved = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-03-01', 'end_date' => '2026-03-05',
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/leave-requests/{$approved['id']}/approve")->assertOk();

        // قيد الانتظار — لا يُحتسب.
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-07-01', 'end_date' => '2026-07-02',
        ])->assertCreated();

        $balances = $this->withToken($auth['token'])->getJson("/api/employees/{$emp}/leave-balances")
            ->assertOk()['data'];

        $this->assertCount(1, $balances);
        $this->assertSame(21, $balances[0]['entitled']);
        $this->assertSame(5, $balances[0]['used']);
        $this->assertSame(16, $balances[0]['remaining']);
    }

    /** @test */
    public function an_employee_cannot_reference_another_tenants_leave_type(): void
    {
        $a = $this->registerTenant('gamma-lr', 'a@gamma-lr.test');
        $b = $this->registerTenant('delta-lr', 'b@delta-lr.test');
        $empA = $this->employee($a['token']);
        $typeB = $this->leaveType($b['token']);

        $this->withToken($a['token'])->postJson("/api/employees/{$empA}/leave-requests", [
            'leave_type_id' => $typeB['id'], 'start_date' => '2026-03-01', 'end_date' => '2026-03-03',
        ])->assertStatus(422);
    }

    /** @test */
    public function leave_requests_are_isolated_per_tenant(): void
    {
        $a = $this->registerTenant('alpha-lr', 'a@alpha-lr.test');
        $b = $this->registerTenant('beta-lr', 'b@beta-lr.test');
        $empB = $this->employee($b['token']);
        $typeB = $this->leaveType($b['token']);

        $this->withToken($a['token'])->getJson("/api/employees/{$empB}/leave-requests")->assertStatus(404);
        $this->withToken($a['token'])->postJson("/api/employees/{$empB}/leave-requests", [
            'leave_type_id' => $typeB['id'], 'start_date' => '2026-03-01', 'end_date' => '2026-03-03',
        ])->assertStatus(404);
    }
}
