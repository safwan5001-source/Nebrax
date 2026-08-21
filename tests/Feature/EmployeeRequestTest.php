<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * الطلبات العامة (سلفة/استئذان/شكوى...) — إنشاء/موافقة/رفض/إلغاء بحقولٍ
 * موحّدة عبر كل الأنواع (design-system/foundations/hr-users-architecture.md
 * «إدارة الطلبات» — نطاق البناء الأول)، منفصلة عمداً عن طلبات الإجازة.
 * تشغيل: php artisan test --filter=EmployeeRequestTest
 */
class EmployeeRequestTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function employee(string $token): string
    {
        return $this->withToken($token)->postJson('/api/employees', ['name' => 'موظف'])
            ->assertCreated()['data']['id'];
    }

    private function requestType(string $token, array $over = []): array
    {
        return $this->withToken($token)->postJson('/api/request-types', array_merge([
            'name' => 'سلفة', 'requires_approval' => true,
        ], $over))->assertCreated()['data'];
    }

    /** @test */
    public function a_request_starts_pending_when_its_type_requires_approval(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->requestType($auth['token']);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/requests", [
            'request_type_id' => $type['id'], 'title' => 'سلفة شهر رمضان',
            'description' => 'سلفة براتب شهر', 'requested_date' => '2026-03-01',
        ])->assertCreated()['data'];

        $this->assertSame('pending', $created['status']);
        $this->assertSame('سلفة شهر رمضان', $created['title']);
        $this->assertNull($created['approved_by']);
    }

    /** @test */
    public function a_request_is_auto_approved_when_its_type_does_not_require_approval(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->requestType($auth['token'], ['requires_approval' => false]);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/requests", [
            'request_type_id' => $type['id'], 'title' => 'استئذان ساعة',
        ])->assertCreated()['data'];

        $this->assertSame('approved', $created['status']);
        $this->assertNotNull($created['approved_at']);
    }

    /** @test */
    public function approving_a_pending_request_records_the_approver(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->requestType($auth['token']);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/requests", [
            'request_type_id' => $type['id'], 'title' => 'طلب',
        ])->assertCreated()['data'];

        $approved = $this->withToken($auth['token'])->postJson("/api/requests/{$created['id']}/approve")
            ->assertOk()['data'];

        $this->assertSame('approved', $approved['status']);
        $this->assertNotNull($approved['approved_by']);
    }

    /** @test */
    public function rejecting_a_pending_request_records_the_reason(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->requestType($auth['token']);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/requests", [
            'request_type_id' => $type['id'], 'title' => 'طلب',
        ])->assertCreated()['data'];

        $rejected = $this->withToken($auth['token'])->postJson("/api/requests/{$created['id']}/reject", [
            'rejection_reason' => 'لا رصيد كافٍ',
        ])->assertOk()['data'];

        $this->assertSame('rejected', $rejected['status']);
        $this->assertSame('لا رصيد كافٍ', $rejected['rejection_reason']);
    }

    /** @test */
    public function a_non_pending_request_cannot_be_approved_rejected_or_cancelled_again(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->requestType($auth['token']);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/requests", [
            'request_type_id' => $type['id'], 'title' => 'طلب',
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->postJson("/api/requests/{$created['id']}/approve")->assertOk();

        $this->withToken($auth['token'])->postJson("/api/requests/{$created['id']}/approve")->assertStatus(422);
        $this->withToken($auth['token'])->postJson("/api/requests/{$created['id']}/reject")->assertStatus(422);
        $this->withToken($auth['token'])->deleteJson("/api/requests/{$created['id']}")->assertStatus(422);
    }

    /** @test */
    public function a_pending_request_can_be_cancelled(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $type = $this->requestType($auth['token']);

        $created = $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/requests", [
            'request_type_id' => $type['id'], 'title' => 'طلب',
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->deleteJson("/api/requests/{$created['id']}")->assertOk();
        $this->withToken($auth['token'])->getJson("/api/employees/{$emp}/requests")
            ->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function the_global_queue_filters_by_status_and_employee(): void
    {
        $auth = $this->registerTenant();
        $emp1 = $this->employee($auth['token']);
        $emp2 = $this->employee($auth['token']);
        $type = $this->requestType($auth['token']);

        $req1 = $this->withToken($auth['token'])->postJson("/api/employees/{$emp1}/requests", [
            'request_type_id' => $type['id'], 'title' => 'طلب ١',
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp2}/requests", [
            'request_type_id' => $type['id'], 'title' => 'طلب ٢',
        ])->assertCreated();
        $this->withToken($auth['token'])->postJson("/api/requests/{$req1['id']}/approve")->assertOk();

        $this->withToken($auth['token'])->getJson('/api/requests?status=pending')
            ->assertOk()->assertJsonCount(1, 'data');
        $this->withToken($auth['token'])->getJson("/api/requests?employee_id={$emp1}")
            ->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.status', 'approved');
    }

    /** @test */
    public function an_employee_cannot_reference_another_tenants_request_type(): void
    {
        $a = $this->registerTenant('gamma-er', 'a@gamma-er.test');
        $b = $this->registerTenant('delta-er', 'b@delta-er.test');
        $empA = $this->employee($a['token']);
        $typeB = $this->requestType($b['token']);

        $this->withToken($a['token'])->postJson("/api/employees/{$empA}/requests", [
            'request_type_id' => $typeB['id'], 'title' => 'طلب',
        ])->assertStatus(422);
    }

    /** @test */
    public function requests_are_isolated_per_tenant(): void
    {
        $a = $this->registerTenant('epsilon-er', 'a@epsilon-er.test');
        $b = $this->registerTenant('zeta-er', 'b@zeta-er.test');
        $empB = $this->employee($b['token']);
        $typeB = $this->requestType($b['token']);

        $this->withToken($a['token'])->getJson("/api/employees/{$empB}/requests")->assertStatus(404);
        $this->withToken($a['token'])->postJson("/api/employees/{$empB}/requests", [
            'request_type_id' => $typeB['id'], 'title' => 'طلب',
        ])->assertStatus(404);
    }
}
