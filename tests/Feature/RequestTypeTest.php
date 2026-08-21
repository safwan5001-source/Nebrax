<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * أنواع الطلبات — كيانٌ مُدار لكل مؤسسة (design-system/foundations/
 * hr-users-architecture.md «إدارة الطلبات» — نطاق البناء الأول).
 * تشغيل: php artisan test --filter=RequestTypeTest
 */
class RequestTypeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_can_be_created_listed_and_updated(): void
    {
        $auth = $this->registerTenant();

        $created = $this->withToken($auth['token'])->postJson('/api/request-types', [
            'name' => 'سلفة', 'requires_approval' => true,
        ])->assertCreated()['data'];
        $this->assertSame('سلفة', $created['name']);
        $this->assertTrue($created['requires_approval']);
        $this->assertTrue($created['is_active']);

        $this->withToken($auth['token'])->getJson('/api/request-types')
            ->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.employee_requests_count', 0);

        $updated = $this->withToken($auth['token'])->putJson("/api/request-types/{$created['id']}", [
            'name' => 'سلفة معدّلة', 'is_active' => false,
        ])->assertOk()['data'];
        $this->assertSame('سلفة معدّلة', $updated['name']);
        $this->assertFalse($updated['is_active']);
    }

    /** @test */
    public function a_duplicate_name_within_the_same_tenant_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/request-types', ['name' => 'استئذان'])->assertCreated();
        $this->withToken($auth['token'])->postJson('/api/request-types', ['name' => 'استئذان'])->assertStatus(422);
    }

    /** @test */
    public function it_cannot_be_deleted_while_a_request_references_it(): void
    {
        $auth = $this->registerTenant();

        $type = $this->withToken($auth['token'])->postJson('/api/request-types', ['name' => 'شكوى'])
            ->assertCreated()['data'];
        $emp = $this->withToken($auth['token'])->postJson('/api/employees', ['name' => 'موظف'])
            ->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp}/requests", [
            'request_type_id' => $type['id'], 'title' => 'شكوى من زميل',
        ])->assertCreated();

        $this->withToken($auth['token'])->deleteJson("/api/request-types/{$type['id']}")->assertStatus(422);
    }

    /** @test */
    public function it_can_be_deleted_when_unreferenced(): void
    {
        $auth = $this->registerTenant();

        $type = $this->withToken($auth['token'])->postJson('/api/request-types', ['name' => 'طلب معدات'])
            ->assertCreated()['data'];

        $this->withToken($auth['token'])->deleteJson("/api/request-types/{$type['id']}")->assertOk();
        $this->withToken($auth['token'])->getJson('/api/request-types')->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function request_types_are_isolated_per_tenant(): void
    {
        $a = $this->registerTenant('alpha-rt', 'a@alpha-rt.test');
        $b = $this->registerTenant('beta-rt', 'b@beta-rt.test');

        $this->withToken($a['token'])->postJson('/api/request-types', ['name' => 'خاص بألفا'])->assertCreated();

        $this->withToken($b['token'])->getJson('/api/request-types')->assertOk()->assertJsonCount(0, 'data');
    }
}
