<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  المعرّفات المشوّهة — لا تُسقط الخادم
 * ═══════════════════════════════════════════════════════════════
 *  **عطل إنتاج حقيقي (أغسطس ٢٠٢٦):** متصفّح احتفظ بـ `nibras_active_branch`
 *  من وضع المعاينة (`br-1`, ليس UUID) بعد إنشاء حساب حقيقي، فصار يُرسَل في
 *  ترويسة `X-Branch-Id` مع **كل** طلب. و`SetBranch` كان يمرّره مباشرةً إلى
 *  استعلام على عمود `uuid`:
 *
 *      SQLSTATE[22P02]: invalid input syntax for type uuid: "br-1"
 *
 *  فتعطّل الحساب كلّه: كل إنشاء وكل قراءة ترجع 500.
 *
 *  **ولماذا لم يكشفه اختبار قبلها:** SQLite لا يتحقّق من نوع `uuid` — يعيد
 *  `false` بهدوء. العطل حصريّ على PostgreSQL. ولذلك **يجب أن يُشغَّل هذا
 *  الملف على القاعدتين** (وCI يفعل).
 *
 *  وهو أيضاً باب تعطيل خدمة: أي عميل يرسل ترويسة عشوائية كان يُسقط الـ API.
 *
 *  تشغيل: php artisan test --filter=MalformedIdentifierTest
 */
class MalformedIdentifierTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** قيم واقعية: معرّف المعاينة، ونصّ عشوائي، ومحاولة حقن. */
    public static function malformed(): array
    {
        return [
            'معرّف وضع المعاينة' => ['br-1'],
            'نصّ عشوائي'          => ['not-a-uuid'],
            'فارغ تقريباً'         => ['x'],
            'محاولة حقن'          => ["1' OR '1'='1"],
        ];
    }

    /**
     * **جوهر الانحدار.** ترويسة فرع مشوّهة تُتجاهَل بصمت — لا 500، والطلب يعمل.
     *
     * @test
     * @dataProvider malformed
     */
    public function a_malformed_branch_header_never_breaks_the_request(string $value): void
    {
        $auth = $this->registerTenant();

        // قراءة
        $this->withToken($auth['token'])->withHeader('X-Branch-Id', $value)
            ->getJson('/api/partners')->assertOk();

        // وإنشاء — وهو ما فشل في الإنتاج
        $this->withToken($auth['token'])->withHeader('X-Branch-Id', $value)
            ->postJson('/api/partners', ['name' => 'جلال', 'type' => 'customer'])
            ->assertCreated();
    }

    /**
     * الترويسة الصالحة ما زالت تعمل — الإصلاح لم يُعطّل تبديل الفرع.
     *
     * @test
     */
    public function a_valid_branch_header_still_selects_that_branch(): void
    {
        $auth = $this->registerTenant();

        $branch = $this->withToken($auth['token'])
            ->postJson('/api/branches', ['name' => 'فرع الجبيل', 'code' => 'BR-2'])
            ->assertCreated()['data'];

        $partner = $this->withToken($auth['token'])->withHeader('X-Branch-Id', $branch['id'])
            ->postJson('/api/partners', ['name' => 'عميل الجبيل', 'type' => 'customer'])
            ->assertCreated()['data'];

        $this->assertSame(
            $branch['id'],
            \App\Models\Partner::withoutGlobalScopes()->findOrFail($partner['id'])->branch_id,
            'الفرع الصالح يجب أن يوسم الطرف به.'
        );
    }

    /**
     * **معرّف مشوّه في المسار يعطي 404 لا 500.** «غير موجود» هو الجواب الصحيح
     * لمعرّف لا يمكن أن يوجد — وكان يعطي خطأ خادم على PostgreSQL.
     *
     * @test
     * @dataProvider malformedPaths
     */
    public function a_malformed_path_identifier_returns_not_found(string $path): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->getJson($path)->assertNotFound();
    }

    public static function malformedPaths(): array
    {
        return [
            'طرف'    => ['/api/partners/br-1'],
            'فاتورة' => ['/api/invoices/not-a-uuid'],
            'منتج'   => ['/api/products/xyz'],
            'حساب'   => ['/api/accounts/123'],
        ];
    }

    /** والحذف كذلك — لا 500 على معرّف مشوّه. */
    /** @test */
    public function deleting_with_a_malformed_identifier_returns_not_found(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->deleteJson('/api/products/xyz')->assertNotFound();
    }

    /** المسارات النصّية لم تتأثّر بقيد الـ UUID. */
    /** @test */
    public function text_route_parameters_still_work(): void
    {
        $auth = $this->registerTenant();

        // `{type}` في أعمار الديون نصّي لا معرّف
        $this->withToken($auth['token'])->getJson('/api/reports/aging/receivable')->assertOk();
        // و`{section}` في إعدادات المبيعات كذلك
        $this->withToken($auth['token'])->getJson('/api/sales-config/statuses')->assertOk();
    }
}
