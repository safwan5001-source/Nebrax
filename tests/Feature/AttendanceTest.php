<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * الحضور والانصراف — تمام الوحدة الثانية من معمار الموارد البشرية.
 * تشغيل:  php artisan test --filter=AttendanceTest
 */
class AttendanceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function makeEmployee(string $token, string $name = 'موظف'): string
    {
        return $this->withToken($token)->postJson('/api/employees', [
            'name' => $name, 'basic_salary' => 500000,
        ])->assertCreated()['data']['id'];
    }

    private function payload(string $employeeId, array $over = []): array
    {
        return array_merge([
            'employee_id' => $employeeId,
            'attendance_date' => '2026-08-15',
            'check_in' => '08:00',
            'check_out' => '16:30',
            'status' => 'present',
        ], $over);
    }

    /** @test */
    public function it_records_attendance_and_derives_worked_minutes(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token'], 'ريم');

        $res = $this->withToken($auth['token'])->postJson('/api/attendances', $this->payload($emp))
            ->assertCreated();

        $res->assertJsonPath('data.status', 'present');
        $res->assertJsonPath('data.employee.name', 'ريم');
        $res->assertJsonPath('data.check_in', '08:00');
        // 08:00 → 16:30 = 8 ساعات ونصف = 510 دقيقة
        $res->assertJsonPath('data.worked_minutes', 510);

        $this->withToken($auth['token'])->getJson('/api/attendances')->assertOk()->assertJsonCount(1, 'data');
    }

    /** @test */
    public function an_overnight_checkout_computes_worked_minutes_over_24h(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token']);

        // 22:00 → 06:00 = 8 ساعات = 480 دقيقة
        $this->withToken($auth['token'])->postJson('/api/attendances', $this->payload($emp, [
            'check_in' => '22:00', 'check_out' => '06:00',
        ]))->assertCreated()->assertJsonPath('data.worked_minutes', 480);
    }

    /** @test */
    public function a_record_without_times_has_zero_worked_minutes(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/attendances', $this->payload($emp, [
            'check_in' => null, 'check_out' => null, 'status' => 'absent',
        ]))->assertCreated()->assertJsonPath('data.worked_minutes', 0);
    }

    /** @test */
    public function an_attendance_can_link_to_a_shift_of_the_tenant(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token']);
        $shift = $this->withToken($auth['token'])->postJson('/api/shifts', [
            'name' => 'صباحية', 'start_time' => '08:00', 'end_time' => '16:00', 'work_days' => [0, 1, 2, 3, 4],
        ])->assertCreated()['data']['id'];

        $this->withToken($auth['token'])->postJson('/api/attendances', $this->payload($emp, [
            'shift_id' => $shift,
        ]))->assertCreated()->assertJsonPath('data.shift.name', 'صباحية');
    }

    /** @test */
    public function an_invalid_status_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/attendances', $this->payload($emp, [
            'status' => 'holiday',
        ]))->assertStatus(422)->assertJsonValidationErrors('status');
    }

    /** @test */
    public function a_duplicate_day_for_the_same_employee_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/attendances', $this->payload($emp))->assertCreated();
        $this->withToken($auth['token'])->postJson('/api/attendances', $this->payload($emp))
            ->assertStatus(422); // سجلٌّ آخر لنفس اليوم
    }

    /** @test */
    public function an_employee_of_another_tenant_cannot_be_recorded(): void
    {
        $other = $this->registerTenant('other', 'owner@other.test');
        $otherEmp = $this->makeEmployee($other['token']);

        $auth = $this->registerTenant('acme', 'owner@acme.test');
        $this->withToken($auth['token'])->postJson('/api/attendances', $this->payload($otherEmp))
            ->assertStatus(422);
    }

    /** @test */
    public function it_can_update_and_delete_and_filter_by_date(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token']);
        $id = $this->withToken($auth['token'])->postJson('/api/attendances', $this->payload($emp))['data']['id'];

        $this->withToken($auth['token'])->putJson("/api/attendances/{$id}", $this->payload($emp, [
            'status' => 'late', 'check_in' => '09:15',
        ]))->assertOk()->assertJsonPath('data.status', 'late');

        // تصفية بتاريخٍ آخر لا تُرجع شيئاً
        $this->withToken($auth['token'])->getJson('/api/attendances?date=2026-01-01')
            ->assertOk()->assertJsonCount(0, 'data');

        $this->withToken($auth['token'])->deleteJson("/api/attendances/{$id}")->assertOk();
        $this->withToken($auth['token'])->getJson('/api/attendances')->assertJsonCount(0, 'data');
    }

    /** @test */
    public function attendance_is_isolated_by_active_branch(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token']);
        $main   = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $khobar = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])['data']['id'];

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson('/api/attendances', $this->payload($emp))->assertCreated();

        // الفرع الرئيسي لا يرى حضور فرع الخبر (BranchScoped).
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/attendances')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->getJson('/api/attendances')->assertOk()->assertJsonCount(1, 'data');
    }
}
