<?php

namespace Tests\Feature;

use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  نطاق وصول المستخدم — فروعه ومستودعاته
 * ═══════════════════════════════════════════════════════════════
 *  الصلاحيات بالدور تحكم **ماذا** يفعل المستخدم؛ وهذا يحكم **أين**.
 *
 *  والقاعدة الحاكمة في كل اختبار هنا: **الفراغ يعني الكلّ**. مستخدمٌ بلا
 *  إسناد يصل إلى كل شيء كما كان قبل الميزة — فالترقية لا تُقيّد أحداً، ولا
 *  يحتاج مستأجرٌ قائم إلى أي إجراء.
 *
 *  تشغيل: php artisan test --filter=UserAccessScopeTest
 */
class UserAccessScopeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** ينشئ مستأجراً بفرعين ويعيد [التوكن، معرّف الفرع الرئيسي، معرّف الثاني]. */
    private function tenantWithTwoBranches(): array
    {
        $auth = $this->registerTenant();
        $main = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $other = $this->withToken($auth['token'])
            ->postJson('/api/branches', ['name' => 'فرع الخبر'])->assertCreated()['data']['id'];

        return [$auth, $main, $other];
    }

    /** ينشئ مستخدماً مقيَّداً بفروع/مستودعات ويعيد توكنه. */
    private function restrictedUser(array $auth, array $payload): string
    {
        $this->withToken($auth['token'])->postJson('/api/users', array_merge([
            'name' => 'موظف فرع', 'email' => 'br@acme.test',
            'password' => 'password123', 'role' => 'admin',
        ], $payload))->assertCreated();

        return $this->postJson('/api/login', [
            'email' => 'br@acme.test', 'password' => 'password123',
        ])->assertOk()['token'];
    }

    // ═══════════════════════════════════════════════════════════
    //  الافتراض: بلا إسناد = بلا قيد
    // ═══════════════════════════════════════════════════════════

    /**
     * مستخدمٌ بلا إسناد يبقى بلا قيد — وهذا ما يحمي كل مستأجر قائم من أن
     * تُقيّده الترقية بلا طلب.
     *
     * @test
     */
    public function a_user_without_assignments_is_not_restricted(): void
    {
        [$auth, $main, $other] = $this->tenantWithTwoBranches();

        app(TenantContext::class)->set($auth['tenant_id']);
        $owner = User::where('email', 'owner@acme.test')->firstOrFail();

        $this->assertNull($owner->allowedBranchIds());
        $this->assertNull($owner->allowedWarehouseIds());
        $this->assertTrue($owner->canAccessBranch($other));

        // ويرى الفرعين في القائمة.
        $this->withToken($auth['token'])->getJson('/api/branches')
            ->assertOk()->assertJsonCount(2, 'data');
    }

    // ═══════════════════════════════════════════════════════════
    //  تقييد العمل
    // ═══════════════════════════════════════════════════════════

    /** المقيَّد لا يرى في قائمة الفروع إلا فروعه. @test */
    public function a_restricted_user_only_lists_their_branches(): void
    {
        [$auth, $main, $other] = $this->tenantWithTwoBranches();
        $token = $this->restrictedUser($auth, ['branch_ids' => [$other]]);

        $res = $this->withToken($token)->getJson('/api/branches')->assertOk();

        $this->assertSame([$other], array_column($res['data'], 'id'));
    }

    /**
     * ترويسة `X-Branch-Id` طلبٌ لا إذن: فرعٌ خارج النطاق يُتجاهَل، ويُوضع
     * المستخدم في فرعه هو — لا في الفرع الرئيسي الذي لا يملكه.
     *
     * @test
     */
    public function requesting_a_branch_outside_the_scope_falls_back_to_an_owned_one(): void
    {
        [$auth, $main, $other] = $this->tenantWithTwoBranches();
        $token = $this->restrictedUser($auth, ['branch_ids' => [$other]]);

        $customer = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        // يطلب الفرع الرئيسي — وهو ليس من فروعه.
        $invoice = $this->withToken($token)->withHeaders(['X-Branch-Id' => $main])
            ->postJson('/api/invoices', [
                'partner_id' => $customer, 'payment_type' => 'cash',
                'items'      => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000]],
            ])->assertCreated()['data'];

        // فوُسم المستند بفرعه هو لا بالمطلوب.
        $this->assertDatabaseHas('invoices', ['id' => $invoice['id'], 'branch_id' => $other]);
    }

    // ═══════════════════════════════════════════════════════════
    //  تقييد القراءة
    // ═══════════════════════════════════════════════════════════

    /**
     * المقيَّد لا يرى مستندات فرعٍ ليس له — **ولا حتى بـ`?branch=all`**.
     * المعامل يوسّع داخل النطاق ولا يرفعه.
     *
     * @test
     */
    public function a_restricted_user_cannot_read_another_branch_documents(): void
    {
        [$auth, $main, $other] = $this->tenantWithTwoBranches();

        $customer = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        // فاتورة في الفرع الرئيسي (بحساب المالك غير المقيَّد)
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson('/api/invoices', [
                'partner_id' => $customer, 'payment_type' => 'cash',
                'items'      => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000]],
            ])->assertCreated();

        $token = $this->restrictedUser($auth, ['branch_ids' => [$other]]);

        $this->withToken($token)->getJson('/api/invoices')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($token)->getJson('/api/invoices?branch=all')->assertOk()->assertJsonCount(0, 'data');

        // والمالك غير المقيَّد يراها.
        $this->withToken($auth['token'])->getJson('/api/invoices?branch=all')
            ->assertOk()->assertJsonCount(1, 'data');
    }

    /**
     * التقرير المجمّع يكشف أرقام كل الفروع — فيُحدّ بنطاق المستخدم حتى لو
     * أغفل المرشّح تماماً.
     *
     * @test
     */
    public function reports_are_bounded_by_the_user_branches(): void
    {
        [$auth, $main, $other] = $this->tenantWithTwoBranches();

        $customer = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $invoice = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson('/api/invoices', [
                'partner_id' => $customer, 'payment_type' => 'cash',
                'items'      => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000]],
            ])->assertCreated()['data'];

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        $ownerRevenue = $this->withToken($auth['token'])
            ->getJson('/api/reports/income-statement')->assertOk()['total_revenue'];

        $token = $this->restrictedUser($auth, ['branch_ids' => [$other]]);

        $restrictedRevenue = $this->withToken($token)
            ->getJson('/api/reports/income-statement')->assertOk()['total_revenue'];

        // إيراد الفرع الرئيسي يظهر للمالك، ولا يظهر للمقيَّد بفرعٍ آخر.
        $this->assertSame('1000.00', $ownerRevenue);
        $this->assertSame('0.00', $restrictedRevenue);
    }

    // ═══════════════════════════════════════════════════════════
    //  المستودعات
    // ═══════════════════════════════════════════════════════════

    /**
     * إخفاء المستودع من القائمة لا يكفي — الطلب المباشر يُرفض أيضاً.
     *
     * @test
     */
    public function a_warehouse_outside_the_scope_is_hidden_and_refused(): void
    {
        $auth = $this->registerTenant();

        $mine   = $this->withToken($auth['token'])->getJson('/api/warehouses')['data'][0]['id'];
        $theirs = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن آخر',
        ])->assertCreated()['data']['id'];

        $token = $this->restrictedUser($auth, ['warehouse_ids' => [$mine]]);

        // القائمة تُخفيه
        $res = $this->withToken($token)->getJson('/api/warehouses')->assertOk();
        $this->assertSame([$mine], array_column($res['data'], 'id'));

        // والطلب المباشر يُرفض
        $this->withToken($token)->postJson('/api/stocktakes', [
            'warehouse_id' => $theirs, 'stocktake_date' => '2026-03-01',
        ])->assertStatus(422);
    }

    // ═══════════════════════════════════════════════════════════
    //  إدارة الإسناد
    // ═══════════════════════════════════════════════════════════

    /**
     * التحديث الجزئي لا يجرّد المستخدم من نطاقه بالسهو: المفتاح الغائب
     * يُترك، والمصفوفة الفارغة إلغاءٌ صريح للتقييد.
     *
     * @test
     */
    public function omitting_the_scope_keeps_it_and_an_empty_array_clears_it(): void
    {
        [$auth, $main, $other] = $this->tenantWithTwoBranches();
        $this->restrictedUser($auth, ['branch_ids' => [$other]]);

        app(TenantContext::class)->set($auth['tenant_id']);
        $user = User::where('email', 'br@acme.test')->firstOrFail();
        $this->assertSame([$other], $user->allowedBranchIds());

        // تحديث بلا `branch_ids` — يبقى الإسناد.
        $this->withToken($auth['token'])->putJson("/api/users/{$user->id}", ['name' => 'اسم جديد'])->assertOk();
        $this->assertSame([$other], $user->fresh()->allowedBranchIds());

        // مصفوفة فارغة — يُلغى التقييد فيعود بلا قيد.
        $this->withToken($auth['token'])->putJson("/api/users/{$user->id}", ['branch_ids' => []])->assertOk();
        $this->assertNull($user->fresh()->allowedBranchIds());
    }
}
