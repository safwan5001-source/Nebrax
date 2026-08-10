<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Support\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  إعدادات المبيعات — **تُقرأ فعلاً**، لا تُحفظ وحسب
 * ═══════════════════════════════════════════════════════════════
 *  كانت تُخزَّن في `tenants.settings['sales']` ولا يقرؤها أحد: البادئة مثبَّتة
 *  `INV-` في الخدمة والنسبة مثبَّتة 15. شاشةٌ تَعِد ولا تفعل — من عائلة
 *  «200 OK على عملية لم تحدث» (#150/#151).
 *
 *  كل اختبار هنا يضبط الإعداد ثم يتحقّق من **أثره في المُخرَج**، لا من عودته
 *  في استجابة الحفظ. والافتراضات هي العقد المنشور سابقاً حرفياً، فالتوصيل لا
 *  يغيّر سلوكاً حتى يغيّره المستخدم — والاختبارات الأصلية الخمسة محفوظة أسفله.
 *
 *  تشغيل: php artisan test --filter=SalesSettingsTest
 */
class SalesSettingsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function customer(string $token): array
    {
        return $this->withToken($token)
            ->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])
            ->assertCreated()['data'];
    }

    private function invoice(string $token, string $partnerId, array $extra = []): array
    {
        return $this->withToken($token)->postJson('/api/invoices', array_merge([
            'partner_id' => $partnerId,
            'items'      => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000]],
        ], $extra))->assertCreated()['data'];
    }

    /** الافتراضات هي العقد المنشور سابقاً حرفياً — التوصيل لم يغيّر منها شيئاً. */
    /** @test */
    public function the_defaults_are_unchanged_by_the_wiring(): void
    {
        $auth = $this->registerTenant();

        $data = $this->withToken($auth['token'])->getJson('/api/sales-settings')->assertOk()['data'];

        $this->assertSame(15, $data['default_tax_rate']);
        $this->assertSame('', $data['default_terms']);
        $this->assertSame('credit', $data['default_payment_type']);
        $this->assertSame(14, $data['quote_validity_days']);
        $this->assertSame('INV', $data['invoice_prefix']);
    }

    /**
     * **الأثر الحقيقي #1:** البادئة تدخل رقم الفاتورة المولَّد.
     *
     * @test
     */
    public function the_prefix_changes_the_generated_invoice_number(): void
    {
        $auth     = $this->registerTenant();
        $customer = $this->customer($auth['token']);

        $this->assertStringStartsWith('INV-', $this->invoice($auth['token'], $customer['id'])['number']);

        $this->withToken($auth['token'])->putJson('/api/sales-settings', ['invoice_prefix' => 'FTR'])->assertOk();

        $this->assertStringStartsWith('FTR-', $this->invoice($auth['token'], $customer['id'])['number']);
    }

    /**
     * **الأثر الحقيقي #2:** النسبة الافتراضية تُطبَّق على سطر بلا نسبة.
     *
     * @test
     */
    public function the_default_tax_rate_applies_to_a_line_without_one(): void
    {
        $auth     = $this->registerTenant();
        $customer = $this->customer($auth['token']);

        $this->assertSame('1150.00', $this->invoice($auth['token'], $customer['id'])['total']);

        $this->withToken($auth['token'])->putJson('/api/sales-settings', ['default_tax_rate' => 0])->assertOk();

        $this->assertSame('1000.00', $this->invoice($auth['token'], $customer['id'])['total']);
    }

    /**
     * **الأثر الحقيقي #3:** نوع السداد الافتراضي يسري، والمرسل يسبقه.
     *
     * @test
     */
    public function the_default_payment_type_applies_and_is_overridable(): void
    {
        $auth     = $this->registerTenant();
        $customer = $this->customer($auth['token']);

        $this->assertSame('credit', $this->invoice($auth['token'], $customer['id'])['payment_type']);

        $this->withToken($auth['token'])->putJson('/api/sales-settings', ['default_payment_type' => 'cash'])->assertOk();

        $this->assertSame('cash', $this->invoice($auth['token'], $customer['id'])['payment_type']);
        // المرسل يسبق التفضيل
        $this->assertSame('credit', $this->invoice($auth['token'], $customer['id'], ['payment_type' => 'credit'])['payment_type']);
    }

    /**
     * **الأثر الحقيقي #4:** مدّة الصلاحية تملأ تاريخ انتهاء عرض السعر.
     *
     * @test
     */
    public function the_validity_days_fill_the_quote_expiry(): void
    {
        $auth     = $this->registerTenant();
        $customer = $this->customer($auth['token']);

        $quote = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $customer['id'], 'quote_date' => '2026-01-01',
            'items'      => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000]],
        ])->assertCreated()['data'];

        $this->assertSame('2026-01-15', $quote['valid_until']); // 1 + 14 يوماً

        // صفر يعني «بلا انتهاء» — فيبقى الحقل فارغاً كما كان قبل الإعداد
        $this->withToken($auth['token'])->putJson('/api/sales-settings', ['quote_validity_days' => 0])->assertOk();

        $open = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $customer['id'], 'quote_date' => '2026-01-01',
            'items'      => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000]],
        ])->assertCreated()['data'];

        $this->assertNull($open['valid_until']);
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  انحدار: تعديل حقلٍ لا مالي كان **يغيّر إجمالي الفاتورة**
     * ═══════════════════════════════════════════════════════════════
     *  `tax_inclusive` اختياري في الطلب، وكان مسار التعديل يعيده إلى `false`
     *  عند غيابه — فتعديلُ ملاحظةٍ وحدها يقلب وضع الضريبة ويرفع الإجمالي
     *  ١١٥٠ ← ١٣٢٢٫٥٠ في فاتورة لم يُمسّ مبلغُها. مؤكَّد تجريبياً قبل الإصلاح.
     *
     * @test
     */
    public function editing_a_note_never_changes_the_invoice_total(): void
    {
        $auth     = $this->registerTenant();
        $customer = $this->customer($auth['token']);

        $invoice = $this->invoice($auth['token'], $customer['id'], [
            'payment_type' => 'credit', 'tax_inclusive' => true,
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 115000, 'tax_rate' => 15]],
        ]);

        $this->assertSame('1150.00', $invoice['total']);

        // تعديل الملاحظة وحدها — بلا إرسال tax_inclusive ولا payment_type
        $after = $this->withToken($auth['token'])->putJson("/api/invoices/{$invoice['id']}", [
            'partner_id' => $customer['id'], 'notes' => 'تعديل الملاحظة',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 115000, 'tax_rate' => 15]],
        ])->assertOk()['data'];

        $this->assertSame('1150.00', $after['total'], 'تعديل الملاحظة لا يمسّ الإجمالي.');
        $this->assertTrue(Invoice::findOrFail($invoice['id'])->tax_inclusive, 'وضع الضريبة يبقى كما هو.');
        $this->assertSame('credit', $after['payment_type'], 'ونوع السداد كذلك.');
    }

    /** التفضيل قيمةٌ عند الإنشاء لا عند كل حفظ — فلا يطغى على المخزَّن. */
    /** @test */
    public function the_default_never_overrides_a_stored_value_on_update(): void
    {
        $auth     = $this->registerTenant();
        $customer = $this->customer($auth['token']);

        $invoice = $this->invoice($auth['token'], $customer['id'], ['payment_type' => 'credit']);
        $this->withToken($auth['token'])->putJson('/api/sales-settings', ['default_payment_type' => 'cash'])->assertOk();

        $after = $this->withToken($auth['token'])->putJson("/api/invoices/{$invoice['id']}", [
            'partner_id' => $customer['id'],
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000]],
        ])->assertOk()['data'];

        $this->assertSame('credit', $after['payment_type']);
    }

    /** البادئة مُعرّف يُطبع ويُبحث به — لا نصّ حرّ. */
    /** @test */
    public function an_invalid_prefix_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/sales-settings', ['invoice_prefix' => 'فاتورة مبيعات!'])
            ->assertStatus(422)->assertJsonValidationErrors('invoice_prefix');
    }

    /**
     * **دَين موثَّق:** `default_terms` يُحفظ ولا يقرؤه أحد — نسخةٌ مكرّرة من
     * `terms_text` في إعدادات تصميم المستندات، وتلك تُعرَض فعلاً على الفاتورة
     * والعرض. وصلُه كان سيطبع الشروط مرّتين، فبقي محفوظاً بانتظار قرار حذفه.
     * هذا الاختبار يثبّت الحالة صراحةً فلا تمرّ كأنها موصولة.
     *
     * @test
     */
    public function the_terms_key_is_still_stored_but_deliberately_unwired(): void
    {
        $auth = $this->registerTenant();

        $data = $this->withToken($auth['token'])
            ->putJson('/api/sales-settings', ['default_terms' => 'الدفع خلال 30 يوماً.'])
            ->assertOk()['data'];

        $this->assertSame('الدفع خلال 30 يوماً.', $data['default_terms']);

        // ولا أثر له في أي فاتورة — لا يتسرّب إلى الملاحظات
        $customer = $this->customer($auth['token']);
        $this->assertNull($this->invoice($auth['token'], $customer['id'])['notes']);
    }

    /** الإعدادات معزولة بالمستأجر. */
    /** @test */
    public function settings_are_isolated_per_tenant(): void
    {
        $a = $this->registerTenant();
        $b = $this->registerTenant('other', 'other@nibras.test');

        $this->withToken($a['token'])->putJson('/api/sales-settings', ['invoice_prefix' => 'AAA'])->assertOk();

        $this->assertSame('INV', $this->withToken($b['token'])
            ->getJson('/api/sales-settings')['data']['invoice_prefix']);
    }

    /** المجموعتان مستقلّتان: تفضيل المبيعات لا يسري على المشتريات. */
    /** @test */
    public function sales_and_purchase_settings_do_not_leak_into_each_other(): void
    {
        $auth = $this->registerTenant();
        app(\App\Tenancy\TenantContext::class)->set($auth['tenant_id']);

        Settings::put('sales', ['invoice_prefix' => 'AAA']);

        $this->assertSame('AAA', Settings::get('sales', 'invoice_prefix'));
        $this->assertSame('BILL', Settings::get('purchases', 'purchase_prefix'));
        // ومفتاح يخصّ المشتريات وحدها لا يظهر في المبيعات
        $this->assertNull(Settings::get('sales', 'purchase_prefix'));
        $this->assertNull(Settings::get('purchases', 'quote_validity_days'));
    }

    // ═══════════ الاختبارات الأصلية (محفوظة كما هي) ═══════════

    /** @test */
    public function owner_can_update_and_changes_persist(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');

        $this->withToken($token)->putJson('/api/sales-settings', [
            'default_tax_rate'     => 5,
            'default_payment_type' => 'cash',
            'quote_validity_days'  => 30,
            'invoice_prefix'       => 'SAL',
            'default_terms'        => 'الدفع خلال 30 يوماً.',
        ])->assertOk()->assertJsonPath('data.default_tax_rate', 5)
            ->assertJsonPath('data.invoice_prefix', 'SAL');

        // التغييرات محفوظة (قراءة لاحقة تعيدها)
        $this->withToken($token)->getJson('/api/sales-settings')
            ->assertOk()
            ->assertJsonPath('data.default_payment_type', 'cash')
            ->assertJsonPath('data.quote_validity_days', 30)
            ->assertJsonPath('data.default_terms', 'الدفع خلال 30 يوماً.');
    }

    /** @test */
    public function validation_rejects_bad_values(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');

        $this->withToken($token)->putJson('/api/sales-settings', [
            'default_tax_rate'     => 200,
            'default_payment_type' => 'bitcoin',
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['default_tax_rate', 'default_payment_type']);
    }

    /** @test */
    public function staff_cannot_update_sales_settings(): void
    {
        ['tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        $staff = $this->tokenForRole($tid, 'staff', 'staff@nibras.test');

        $this->withToken($staff)->putJson('/api/sales-settings', ['default_tax_rate' => 5])
            ->assertForbidden();
    }
}
