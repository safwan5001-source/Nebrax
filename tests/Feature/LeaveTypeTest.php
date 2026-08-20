<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * أنواع الإجازات — كيانٌ مُدار لكل مؤسسة (design-system/foundations/
 * hr-users-architecture.md «الإجازات» — نطاق البناء الأول).
 * تشغيل: php artisan test --filter=LeaveTypeTest
 */
class LeaveTypeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_can_be_created_listed_and_updated(): void
    {
        $auth = $this->registerTenant();

        $created = $this->withToken($auth['token'])->postJson('/api/leave-types', [
            'name' => 'سنوية', 'is_paid' => true, 'annual_days' => 21, 'requires_approval' => true,
        ])->assertCreated()['data'];
        $this->assertSame('سنوية', $created['name']);
        $this->assertTrue($created['is_paid']);
        $this->assertSame(21, $created['annual_days']);
        $this->assertTrue($created['is_active']);

        $this->withToken($auth['token'])->getJson('/api/leave-types')
            ->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.leave_requests_count', 0);

        $updated = $this->withToken($auth['token'])->putJson("/api/leave-types/{$created['id']}", [
            'name' => 'سنوية معدّلة', 'annual_days' => 25, 'is_active' => false,
        ])->assertOk()['data'];
        $this->assertSame('سنوية معدّلة', $updated['name']);
        $this->assertSame(25, $updated['annual_days']);
        $this->assertFalse($updated['is_active']);
    }

    /** @test */
    public function a_duplicate_name_within_the_same_tenant_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/leave-types', ['name' => 'مرضية', 'annual_days' => 30])
            ->assertCreated();
        $this->withToken($auth['token'])->postJson('/api/leave-types', ['name' => 'مرضية', 'annual_days' => 10])
            ->assertStatus(422);
    }

    /** @test */
    public function it_cannot_be_deleted_while_a_leave_request_references_it(): void
    {
        $auth = $this->registerTenant();

        $type = $this->withToken($auth['token'])->postJson('/api/leave-types', ['name' => 'سنوية', 'annual_days' => 21])
            ->assertCreated()['data'];
        $emp = $this->withToken($auth['token'])->postJson('/api/employees', ['name' => 'موظف'])
            ->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/leave-requests", [
            'leave_type_id' => $type['id'], 'start_date' => '2026-03-01', 'end_date' => '2026-03-03',
        ])->assertCreated();

        $this->withToken($auth['token'])->deleteJson("/api/leave-types/{$type['id']}")->assertStatus(422);
    }

    /** @test */
    public function it_can_be_deleted_when_unreferenced(): void
    {
        $auth = $this->registerTenant();

        $type = $this->withToken($auth['token'])->postJson('/api/leave-types', ['name' => 'بلا راتب', 'annual_days' => 0])
            ->assertCreated()['data'];

        $this->withToken($auth['token'])->deleteJson("/api/leave-types/{$type['id']}")->assertOk();
        $this->withToken($auth['token'])->getJson('/api/leave-types')->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function leave_types_are_isolated_per_tenant(): void
    {
        $a = $this->registerTenant('alpha-lt', 'a@alpha-lt.test');
        $b = $this->registerTenant('beta-lt', 'b@beta-lt.test');

        $this->withToken($a['token'])->postJson('/api/leave-types', ['name' => 'خاص بألفا', 'annual_days' => 21])
            ->assertCreated();

        $this->withToken($b['token'])->getJson('/api/leave-types')->assertOk()->assertJsonCount(0, 'data');
    }
}
