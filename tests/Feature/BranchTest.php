<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\JournalEntry;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات الفروع (بيانات رئيسية + إعدادات المشاركة). بنية تنظيمية داخل
 * المستأجر — لا تولّد أي قيد محاسبي، والعزل يبقى بالمستأجر.
 * تشغيل: php artisan test --filter=BranchTest
 */
class BranchTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function registration_creates_a_default_main_branch(): void
    {
        $auth = $this->registerTenant();

        $res = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk();
        $this->assertCount(1, $res['data']);
        $this->assertSame('00001', $res['data'][0]['code']);
        $this->assertSame('الفرع الرئيسي', $res['data'][0]['name']);

        // ويُضبط كفرع رئيسي في الإعدادات
        $this->assertSame($res['data'][0]['id'], $res['main_branch_id']);
    }

    /** @test */
    public function it_creates_a_branch_with_an_auto_sequential_code(): void
    {
        $auth = $this->registerTenant();

        $res = $this->withToken($auth['token'])->postJson('/api/branches', [
            'name'      => 'فرع الخبر',
            'phone'     => '0138000000',
            'city'      => 'الخبر',
            'region'    => 'المنطقة الشرقية',
            'country'   => 'Saudi Arabia',
            'latitude'  => 26.2794,
            'longitude' => 50.2083,
        ])->assertCreated();

        $this->assertSame('00002', $res['data']['code']); // بعد الفرع الرئيسي 00001
        $this->assertSame('فرع الخبر', $res['data']['name']);
        $this->assertSame(26.2794, $res['data']['latitude']);
        $this->assertTrue($res['data']['is_active']);

        // لا قيد محاسبي من إنشاء فرع
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, JournalEntry::where('source_type', Branch::class)->count());
    }

    /** @test */
    public function it_rejects_a_duplicate_code_and_updates_a_branch(): void
    {
        $auth = $this->registerTenant();

        $id = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الدمام'])['data']['id'];

        // كود مستخدم مسبقاً (00001 للفرع الرئيسي)
        $this->withToken($auth['token'])->putJson("/api/branches/{$id}", [
            'name' => 'فرع الدمام', 'code' => '00001',
        ])->assertStatus(422);

        $this->withToken($auth['token'])->putJson("/api/branches/{$id}", [
            'name' => 'فرع الدمام الرئيسي', 'city' => 'الدمام',
        ])->assertOk()->assertJsonPath('data.name', 'فرع الدمام الرئيسي');
    }

    /** @test */
    public function the_main_branch_cannot_be_deleted(): void
    {
        $auth = $this->registerTenant();
        $main = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];

        $this->withToken($auth['token'])->deleteJson("/api/branches/{$main}")->assertStatus(422);

        // فرع عادي يُحذف بلا مانع
        $other = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع مؤقّت'])['data']['id'];
        $this->withToken($auth['token'])->deleteJson("/api/branches/{$other}")->assertOk();
    }

    /** @test */
    public function settings_default_to_sharing_enabled_and_persist_toggles(): void
    {
        $auth = $this->registerTenant();

        // الافتراضات تحافظ على السلوك الحالي: مشاركة مفعّلة، تخصيص الحسابات معطّل
        $res = $this->withToken($auth['token'])->getJson('/api/branch-settings')->assertOk();
        $this->assertTrue($res['data']['share_customers']);
        $this->assertTrue($res['data']['share_products']);
        $this->assertTrue($res['data']['share_suppliers']);
        $this->assertTrue($res['data']['share_cost_centers']);
        $this->assertFalse($res['data']['account_branch_scoping']);

        $this->withToken($auth['token'])->putJson('/api/branch-settings', [
            'share_customers'        => false,
            'account_branch_scoping' => true,
        ])->assertOk();

        $after = $this->withToken($auth['token'])->getJson('/api/branch-settings')['data'];
        $this->assertFalse($after['share_customers']);
        $this->assertTrue($after['account_branch_scoping']);
        $this->assertTrue($after['share_products']); // البقية دون مساس
    }

    /** @test */
    public function main_branch_must_belong_to_the_tenant(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $b = $this->registerTenant('globex', 'owner@globex.test');
        $branchB = $this->withToken($b['token'])->getJson('/api/branches')['data'][0]['id'];

        // المستأجر A لا يستطيع تعيين فرع المستأجر B رئيسياً
        $this->withToken($a['token'])->putJson('/api/branch-settings', ['main_branch_id' => $branchB])
            ->assertStatus(422);
    }

    /** @test */
    public function branches_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $this->withToken($a['token'])->postJson('/api/branches', ['name' => 'فرع آكمي'])->assertCreated();

        $b = $this->registerTenant('globex', 'owner@globex.test');
        // كلٌّ يرى فرعه الرئيسي فقط (لا فروع الآخر)
        $this->withToken($b['token'])->getJson('/api/branches')->assertOk()->assertJsonCount(1, 'data');
    }

    /** @test */
    public function staff_can_view_but_not_manage_branches(): void
    {
        ['tenant_id' => $tid] = $this->registerTenant();
        $staff = $this->tokenForRole($tid, 'staff', 'staff@nibras.test');

        $this->withToken($staff)->getJson('/api/branches')->assertOk();
        $this->withToken($staff)->postJson('/api/branches', ['name' => 'فرع'])->assertForbidden();
        $this->withToken($staff)->putJson('/api/branch-settings', ['share_customers' => false])->assertForbidden();
    }

    /**
     * انحدار P1: إضافة فرع لاحق **لا تسرق** صفة الفرع الرئيسي — العَرَض المُبلَّغ.
     * @test
     */
    public function adding_more_branches_never_changes_the_main_branch(): void
    {
        $auth = $this->registerTenant();
        $main = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];

        foreach (['فرع الخبر', 'فرع الجبيل', 'فرع الأحساء'] as $name) {
            $created = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => $name])
                ->assertCreated();
            $this->assertFalse($created['data']['is_main'], "الفرع الجديد {$name} يجب ألّا يكون رئيسياً");

            // والرئيسي يبقى الأصلي بعد كل إضافة
            $this->assertSame($main, $this->withToken($auth['token'])->getJson('/api/branches')['main_branch_id']);
        }

        // فرع رئيسي واحد فقط في نهاية المطاف
        $mains = collect($this->withToken($auth['token'])->getJson('/api/branches')['data'])
            ->where('is_main', true);
        $this->assertCount(1, $mains);
        $this->assertSame($main, $mains->first()['id']);
    }

    /** @test */
    public function is_main_cannot_be_forced_through_the_branch_form(): void
    {
        $auth = $this->registerTenant();
        $main = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];

        // محاولة فرض is_main عند الإنشاء تُتجاهَل
        $new = $this->withToken($auth['token'])
            ->postJson('/api/branches', ['name' => 'فرع متطفّل', 'is_main' => true])->assertCreated();
        $this->assertFalse($new['data']['is_main']);

        // وكذلك عند التعديل
        $this->withToken($auth['token'])
            ->putJson("/api/branches/{$new['data']['id']}", ['name' => 'فرع متطفّل', 'is_main' => true])->assertOk();
        $this->assertSame($main, $this->withToken($auth['token'])->getJson('/api/branches')['main_branch_id']);
    }

    /** @test */
    public function the_main_branch_changes_only_through_branch_settings(): void
    {
        $auth = $this->registerTenant();
        $old  = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $new  = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])['data']['id'];

        // الإجراء الصريح الوحيد المسموح
        $this->withToken($auth['token'])->putJson('/api/branch-settings', ['main_branch_id' => $new])->assertOk();

        $list = $this->withToken($auth['token'])->getJson('/api/branches');
        $this->assertSame($new, $list['main_branch_id']);
        // والقديم فقد الصفة — واحد فقط دائماً
        $this->assertCount(1, collect($list['data'])->where('is_main', true));
        $this->assertFalse(collect($list['data'])->firstWhere('id', $old)['is_main']);
    }
}
