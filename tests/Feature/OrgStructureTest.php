<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * الهيكل التنظيمي: مسمى وظيفي/قسم/مستوى وظيفي/نوع وظيفة — أربعة كيانات
 * مُدارة متطابقة السلوك لكل مؤسسة (design-system/foundations/
 * hr-users-architecture.md — «الهيكل التنظيمي»)، تحلّ محل الحقول النصية
 * الحرة السابقة على Employee (job_title/department/employment_type) وتضيف
 * رابعاً جديداً كلياً (job_level).
 * تشغيل: php artisan test --filter=OrgStructureTest
 */
class OrgStructureTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    public static function entities(): array
    {
        return [
            'job-titles'       => ['job-titles', 'job_title_id'],
            'departments'      => ['departments', 'department_id'],
            'job-levels'       => ['job-levels', 'job_level_id'],
            'employment-types' => ['employment-types', 'employment_type_id'],
        ];
    }

    /**
     * @test
     * @dataProvider entities
     */
    public function it_can_be_created_listed_and_updated(string $endpoint): void
    {
        $auth = $this->registerTenant();

        $created = $this->withToken($auth['token'])->postJson("/api/{$endpoint}", ['name' => 'الأول'])
            ->assertCreated()['data'];
        $this->assertSame('الأول', $created['name']);
        $this->assertTrue($created['is_active']);

        $this->withToken($auth['token'])->getJson("/api/{$endpoint}")
            ->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.employees_count', 0);

        $updated = $this->withToken($auth['token'])->putJson("/api/{$endpoint}/{$created['id']}", [
            'name' => 'الأول المعدّل', 'is_active' => false,
        ])->assertOk()['data'];
        $this->assertSame('الأول المعدّل', $updated['name']);
        $this->assertFalse($updated['is_active']);
    }

    /**
     * @test
     * @dataProvider entities
     */
    public function a_duplicate_name_within_the_same_tenant_is_rejected(string $endpoint): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson("/api/{$endpoint}", ['name' => 'مكرر'])->assertCreated();
        $this->withToken($auth['token'])->postJson("/api/{$endpoint}", ['name' => 'مكرر'])->assertStatus(422);
    }

    /**
     * @test
     * @dataProvider entities
     */
    public function it_cannot_be_deleted_while_an_employee_references_it(string $endpoint, string $employeeField): void
    {
        $auth = $this->registerTenant();

        $entity = $this->withToken($auth['token'])->postJson("/api/{$endpoint}", ['name' => 'قيد الاستخدام'])
            ->assertCreated()['data'];

        $this->withToken($auth['token'])->postJson('/api/employees', [
            'name' => 'موظف', 'basic_salary' => 500000, $employeeField => $entity['id'],
        ])->assertCreated();

        $this->withToken($auth['token'])->deleteJson("/api/{$endpoint}/{$entity['id']}")->assertStatus(422);
        $this->withToken($auth['token'])->getJson("/api/{$endpoint}")
            ->assertJsonPath('data.0.employees_count', 1);
    }

    /**
     * @test
     * @dataProvider entities
     */
    public function it_can_be_deleted_when_unreferenced(string $endpoint): void
    {
        $auth = $this->registerTenant();

        $entity = $this->withToken($auth['token'])->postJson("/api/{$endpoint}", ['name' => 'بلا استخدام'])
            ->assertCreated()['data'];

        $this->withToken($auth['token'])->deleteJson("/api/{$endpoint}/{$entity['id']}")->assertOk();
        $this->withToken($auth['token'])->getJson("/api/{$endpoint}")->assertOk()->assertJsonCount(0, 'data');
    }

    /**
     * @test
     * @dataProvider entities
     */
    public function entities_are_isolated_per_tenant(string $endpoint): void
    {
        $a = $this->registerTenant('alpha-org', 'a@alpha-org.test');
        $b = $this->registerTenant('beta-org', 'b@beta-org.test');

        $this->withToken($a['token'])->postJson("/api/{$endpoint}", ['name' => 'خاص بألفا'])->assertCreated();

        $this->withToken($b['token'])->getJson("/api/{$endpoint}")->assertOk()->assertJsonCount(0, 'data');
    }

    /**
     * @test
     * @dataProvider entities
     */
    public function an_employee_cannot_reference_another_tenants_entity(string $endpoint, string $employeeField): void
    {
        $a = $this->registerTenant('gamma-org', 'a@gamma-org.test');
        $b = $this->registerTenant('delta-org', 'b@delta-org.test');

        $entityB = $this->withToken($b['token'])->postJson("/api/{$endpoint}", ['name' => 'خاص ببيتا'])
            ->assertCreated()['data'];

        $this->withToken($a['token'])->postJson('/api/employees', [
            'name' => 'موظف', 'basic_salary' => 500000, $employeeField => $entityB['id'],
        ])->assertStatus(422);
    }
}
