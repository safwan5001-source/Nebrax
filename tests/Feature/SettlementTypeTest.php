<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;

/**
 * أنواع التسوية إعدادات مؤسسة لا تولد قيوداً. الاستخدام المالي الفعلي يُختبر
 * مع دورة تسويات العُهَد عند بنائها، لا بتصنيع حركة مالية هنا.
 */
class SettlementTypeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function createType(string $token, string $name = 'مصروفات', array $extra = []): array
    {
        return $this->withToken($token)->postJson('/api/settlement-types', array_merge([
            'name' => $name,
            'description' => 'تسوية مصاريف العهدة',
        ], $extra))->assertCreated()['data'];
    }

    /** الاسم والوصف والحالة هي عقد نوع التسوية، والاسم لا يتكرر داخل المؤسسة. */
    /** @test */
    public function settlement_types_are_managed_by_unique_name_description_and_state(): void
    {
        $auth = $this->registerTenant('settlement-types', 'owner-settlement@example.test');
        $type = $this->createType($auth['token']);

        $this->assertSame('مصروفات', $type['name']);
        $this->assertSame('تسوية مصاريف العهدة', $type['description']);
        $this->assertTrue($type['is_active']);
        $this->assertSame(0, $type['settlements_count']);

        $this->withToken($auth['token'])
            ->postJson('/api/settlement-types', ['name' => 'مصروفات'])
            ->assertStatus(422);
    }

    /** التعطيل يحفظ النوع للتاريخ ويظهر حالته بدلاً من حذف تعريف عمله المستخدم. */
    /** @test */
    public function a_settlement_type_can_be_deactivated_and_reactivated(): void
    {
        $auth = $this->registerTenant('settlement-toggle', 'owner-toggle@example.test');
        $type = $this->createType($auth['token']);

        $this->withToken($auth['token'])
            ->putJson("/api/settlement-types/{$type['id']}", [
                'name' => 'مصروفات',
                'is_active' => false,
            ])
            ->assertOk()
            ->assertJsonPath('data.is_active', false);

        $this->withToken($auth['token'])
            ->putJson("/api/settlement-types/{$type['id']}", [
                'name' => 'مصروفات',
                'is_active' => true,
            ])
            ->assertOk()
            ->assertJsonPath('data.is_active', true);
    }

    /** لا يوجد استخدام تسويات في هذا الإصدار، لذلك حذف نوع غير مرتبط يزيله ويحرر اسمه. */
    /** @test */
    public function an_unused_settlement_type_can_be_deleted_and_its_name_reused(): void
    {
        $auth = $this->registerTenant('settlement-delete', 'owner-delete-settlement@example.test');
        $type = $this->createType($auth['token'], 'مخالصة');

        $this->withToken($auth['token'])
            ->deleteJson("/api/settlement-types/{$type['id']}")
            ->assertOk();

        $this->createType($auth['token'], 'مخالصة');
    }

    /** تعريفات مؤسسة لا تتسرب إلى مستأجر آخر ولا يقبل تعديل معرف أجنبي. */
    /** @test */
    public function settlement_types_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('settlement-acme', 'owner-settlement-acme@example.test');
        $theirs = $this->createType($a['token'], 'خاص بهم');
        $b = $this->registerTenant('settlement-globex', 'owner-settlement-globex@example.test');

        $this->withToken($b['token'])
            ->getJson('/api/settlement-types')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->withToken($b['token'])
            ->putJson("/api/settlement-types/{$theirs['id']}", ['name' => 'تسريب'])
            ->assertNotFound();
    }

    /** دور القراءة يطالع إعدادات المؤسسة لكنه لا ينشئ أو يغيّر أو يحذف تعريفاً مالياً. */
    /** @test */
    public function a_read_only_staff_member_can_view_but_cannot_manage_settlement_types(): void
    {
        $auth = $this->registerTenant('settlement-rbac', 'owner-settlement-rbac@example.test');
        $type = $this->createType($auth['token']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff-settlement@example.test');

        $this->withToken($staff)->getJson('/api/settlement-types')->assertOk();
        $this->withToken($staff)->postJson('/api/settlement-types', ['name' => 'ممنوع'])->assertForbidden();
        $this->withToken($staff)->putJson("/api/settlement-types/{$type['id']}", ['name' => 'ممنوع'])->assertForbidden();
        $this->withToken($staff)->deleteJson("/api/settlement-types/{$type['id']}")->assertForbidden();
    }
}
