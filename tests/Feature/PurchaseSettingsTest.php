<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\Purchase;
use App\Support\Settings;
use App\Services\Accounting\ProcurementService;
use App\Services\Accounting\PurchaseService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  إعدادات المشتريات — **تُقرأ فعلاً**، لا تُحفظ وحسب
 * ═══════════════════════════════════════════════════════════════
 *  إعدادٌ محفوظ لا يقرؤه أحد شاشةٌ تَعِد ولا تفعل — وهو أسوأ من غياب
 *  الشاشة. لذلك كل اختبار هنا يضبط الإعداد ثم يتحقّق من **أثره في المُخرَج**،
 *  لا من عودته في استجابة الحفظ.
 *
 *  تشغيل: php artisan test --filter=PurchaseSettingsTest
 */
class PurchaseSettingsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function supplier(string $token): array
    {
        return $this->withToken($token)
            ->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])
            ->assertCreated()['data'];
    }

    private function bill(string $token, string $supplierId, array $extra = []): array
    {
        return $this->withToken($token)->postJson('/api/purchases', array_merge([
            'partner_id' => $supplierId,
            'items'      => [['description' => 'إسمنت', 'quantity' => 1, 'unit_price' => 100000]],
        ], $extra))->assertCreated()['data'];
    }

    /** @test */
    public function it_returns_the_defaults_before_anything_is_saved(): void
    {
        $auth = $this->registerTenant();

        $data = $this->withToken($auth['token'])->getJson('/api/purchase-settings')->assertOk()['data'];

        $this->assertSame(15, $data['default_tax_rate']);
        $this->assertSame('credit', $data['default_payment_type']);
        $this->assertFalse($data['default_tax_inclusive']);
        $this->assertSame('BILL', $data['purchase_prefix']);
    }

    /** المفاتيح غير المرسلة تبقى كما هي — الحفظ دمجٌ لا استبدال. */
    /** @test */
    public function saving_one_key_leaves_the_others_untouched(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->putJson('/api/purchase-settings', ['default_tax_rate' => 5])->assertOk();
        $data = $this->withToken($auth['token'])->putJson('/api/purchase-settings', ['purchase_prefix' => 'PO'])
            ->assertOk()['data'];

        $this->assertSame(5, $data['default_tax_rate']);
        $this->assertSame('PO', $data['purchase_prefix']);
    }

    /**
     * **الأثر الحقيقي #1:** البادئة تدخل رقم الفاتورة المولَّد.
     *
     * @test
     */
    public function the_prefix_changes_the_generated_bill_number(): void
    {
        $auth     = $this->registerTenant();
        $supplier = $this->supplier($auth['token']);

        $this->assertStringStartsWith('BILL-', $this->bill($auth['token'], $supplier['id'])['number']);

        $this->withToken($auth['token'])->putJson('/api/purchase-settings', ['purchase_prefix' => 'FTR'])->assertOk();

        $this->assertStringStartsWith('FTR-', $this->bill($auth['token'], $supplier['id'])['number']);
    }

    /**
     * **الأثر الحقيقي #2:** النسبة الافتراضية تُطبَّق على سطر بلا نسبة.
     *
     * @test
     */
    public function the_default_tax_rate_applies_to_a_line_without_one(): void
    {
        $auth     = $this->registerTenant();
        $supplier = $this->supplier($auth['token']);

        $this->assertSame('1150.00', $this->bill($auth['token'], $supplier['id'])['total']);

        $this->withToken($auth['token'])->putJson('/api/purchase-settings', ['default_tax_rate' => 0])->assertOk();

        $this->assertSame('1000.00', $this->bill($auth['token'], $supplier['id'])['total']);
    }

    /**
     * **الأثر الحقيقي #3:** نوع السداد الافتراضي يسري على الفاتورة الجديدة
     * وعلى المولَّدة من أمر شراء — والقيمة المرسلة تسبقه دائماً.
     *
     * @test
     */
    public function the_default_payment_type_applies_and_is_overridable(): void
    {
        $auth     = $this->registerTenant();
        $supplier = $this->supplier($auth['token']);

        $this->withToken($auth['token'])->putJson('/api/purchase-settings', ['default_payment_type' => 'cash'])->assertOk();

        $this->assertSame('cash', $this->bill($auth['token'], $supplier['id'])['payment_type']);
        // المرسل يسبق التفضيل
        $this->assertSame('credit', $this->bill($auth['token'], $supplier['id'], ['payment_type' => 'credit'])['payment_type']);
    }

    /**
     * **الأثر الحقيقي #4:** وضع الضريبة الافتراضي يسري على مستند الشراء
     * والفاتورة — فيُستخرَج المبلغ من السعر بدل أن يُضاف فوقه.
     *
     * @test
     */
    public function the_default_tax_mode_applies_to_new_documents(): void
    {
        $auth     = $this->registerTenant();
        $supplier = $this->supplier($auth['token']);

        $this->withToken($auth['token'])->putJson('/api/purchase-settings', ['default_tax_inclusive' => true])->assertOk();

        // 1000 شاملة 15% ⇒ الإجمالي يبقى 1000 والضريبة مستخرَجة منه لا مضافة فوقه
        $bill = $this->bill($auth['token'], $supplier['id']);
        $this->assertSame('1000.00', $bill['total']);
        $this->assertTrue(Purchase::findOrFail($bill['id'])->tax_inclusive);
    }

    /** البادئة مُعرّف يُطبع ويُبحث به — لا نصّ حرّ. */
    /** @test */
    public function an_invalid_prefix_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/purchase-settings', ['purchase_prefix' => 'فاتورة شراء!'])
            ->assertStatus(422)->assertJsonValidationErrors('purchase_prefix');
    }

    /** مفتاح غير معرَّف في العقد يُهمَل بدل أن يتسلّل إلى التخزين. */
    /** @test */
    public function an_unknown_key_is_ignored(): void
    {
        $auth = $this->registerTenant();

        $data = $this->withToken($auth['token'])
            ->putJson('/api/purchase-settings', ['smuggled' => 'x', 'default_tax_rate' => 7])
            ->assertOk()['data'];

        $this->assertArrayNotHasKey('smuggled', $data);
        $this->assertSame(7, $data['default_tax_rate']);
    }

    /** الإعدادات معزولة بالمستأجر — تفضيل شركةٍ لا يسري على أخرى. */
    /** @test */
    public function settings_are_isolated_per_tenant(): void
    {
        $a = $this->registerTenant();
        $b = $this->registerTenant('other', 'other@nibras.test');

        $this->withToken($a['token'])->putJson('/api/purchase-settings', ['purchase_prefix' => 'AAA'])->assertOk();

        $this->assertSame('BILL', $this->withToken($b['token'])
            ->getJson('/api/purchase-settings')['data']['purchase_prefix']);
    }

    /** خارج سياق مستأجر (أوامر artisan) تُعاد الافتراضات بلا انهيار. */
    /** @test */
    public function reading_settings_without_a_tenant_returns_defaults(): void
    {
        $this->assertSame('BILL', Settings::get('purchases', 'purchase_prefix'));
        $this->assertSame(15, Settings::get('purchases', 'default_tax_rate'));
    }

    /** الخدمتان تقرآن من نفس المصدر — فلا يتناقض المستند مع فاتورته. */
    /** @test */
    public function the_procurement_service_reads_the_same_defaults(): void
    {
        $auth = $this->registerTenant();
        app(\App\Tenancy\TenantContext::class)->set($auth['tenant_id']);

        Settings::put('purchases', ['default_tax_rate' => 5]);

        $supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $doc = app(ProcurementService::class)->create(
            ['type' => 'order', 'partner_id' => $supplier->id],
            [['description' => 'إسمنت', 'quantity' => 1, 'unit_price' => 100000]]
        );

        $this->assertSame(5000, $doc->tax_amount);
        $this->assertSame(5, $doc->lines->first()->tax_rate);

        // وفاتورة المشتريات المولَّدة منه تحمل نفس التفضيل
        $purchase = app(PurchaseService::class)->create(
            ['partner_id' => $supplier->id],
            [['description' => 'إسمنت', 'quantity' => 1, 'unit_price' => 100000]]
        );
        $this->assertSame(5000, $purchase->tax_amount);
    }
}
