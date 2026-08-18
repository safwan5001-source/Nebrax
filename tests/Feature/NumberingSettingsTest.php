<?php

namespace Tests\Feature;

use App\Support\DocumentNumberingCatalog;
use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  إعدادات الترقيم المتسلسل — شاشة عرضٍ ببادئةٍ واحدة قابلة للتحرير
 * ═══════════════════════════════════════════════════════════════
 *  الشاشة تعرض ما تفعله طبقة الترقيم فعلاً، ولا تَعِد بما لا تملكه:
 *  التنسيق وعدد الأرقام والنطاق ثوابتُ الطبقة وتصنيفُ النموذج، تُعرَض
 *  للاطّلاع. والبادئة تُحرَّر حيث تقرؤها الخدمة فعلاً — وهما اثنتان اليوم.
 *
 *  تشغيل: php artisan test --filter=NumberingSettingsTest
 */
class NumberingSettingsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function catalog(string $token): array
    {
        return $this->withToken($token)->getJson('/api/numbering-settings')->assertOk()['data'];
    }

    private function entity(string $token, string $key): array
    {
        return collect($this->catalog($token))->firstWhere('key', $key);
    }

    // ═══════════════════════════════════════════════════════════
    //  التغطية: الفهرس يطابق الطبقة
    // ═══════════════════════════════════════════════════════════

    /**
     * **حارس الانجراف:** كل نموذج يستعمل طبقة الترقيم يجب أن يظهر في الفهرس.
     *
     * فنموذجٌ جديد يُرقَّم ولا يُدرج هنا يغيب عن الشاشة بصمت — يصير له تسلسل
     * لا يراه أحد. والعكس كذلك: مدخلٌ في الفهرس بلا طبقةٍ خلفه يعرض رقماً
     * وهمياً. الطرفان يفشلان هنا لا في الإنتاج.
     *
     * @test
     */
    public function the_catalog_covers_every_model_that_uses_the_numbering_layer(): void
    {
        $numbered = [];

        foreach (glob(app_path('Models/*.php')) as $file) {
            $class = 'App\\Models\\' . basename($file, '.php');

            if (class_exists($class) && in_array(GeneratesDocumentNumbers::class, class_uses_recursive($class), true)) {
                $numbered[] = $class;
            }
        }

        $catalogued = array_column(DocumentNumberingCatalog::ENTITIES, 'model');

        sort($numbered);
        sort($catalogued);

        $this->assertSame($numbered, $catalogued, implode("\n", [
            'الفهرس لا يطابق النماذج المرقَّمة.',
            'كل نموذج يستعمل GeneratesDocumentNumbers يُدرج في DocumentNumberingCatalog::ENTITIES،',
            'وكل مدخل هناك يجب أن يقابل نموذجاً يستعمل الطبقة فعلاً.',
        ]));

        $this->assertCount(17, $catalogued);
    }

    /** عدّاد ZATCA ليس رقم مستند — فلا يظهر في هذه الشاشة إطلاقاً. @test */
    public function the_zatca_counter_never_appears_in_the_catalog(): void
    {
        $auth = $this->registerTenant();

        $payload = json_encode($this->catalog($auth['token']), JSON_UNESCAPED_UNICODE);

        $this->assertStringNotContainsString('zatca', strtolower($payload));
        $this->assertStringNotContainsString('icv', strtolower($payload));
    }

    // ═══════════════════════════════════════════════════════════
    //  العرض
    // ═══════════════════════════════════════════════════════════

    /** الرقم التالي المعروض هو ما ستنتجه الطبقة حرفياً — لا حساب موازٍ. @test */
    public function the_shown_next_number_is_what_the_layer_would_produce(): void
    {
        $auth = $this->registerTenant();

        $invoice = $this->entity($auth['token'], 'invoice');
        $this->assertSame('INV-' . now()->year . '-00001', $invoice['series'][0]['next_number']);

        // بعد إصدار فاتورة يتقدّم المعروض معها.
        $customer = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $customer['id'], 'payment_type' => 'cash',
            'items' => [['description' => 'منتج', 'quantity' => 1, 'unit_price' => 100000]],
        ])->assertCreated();

        $this->assertSame(
            'INV-' . now()->year . '-00002',
            $this->entity($auth['token'], 'invoice')['series'][0]['next_number']
        );
    }

    /** النطاق معروضٌ بحسب تصنيف النموذج: بالفرع أو للمؤسسة. @test */
    public function the_scope_reflects_the_model_classification(): void
    {
        $auth    = $this->registerTenant();
        $catalog = collect($this->catalog($auth['token']))->keyBy('key');

        // موسومة بالفرع
        $this->assertSame('branch', $catalog['invoice']['scope']);
        $this->assertSame('branch', $catalog['asset']['scope']);

        // مصنَّفة CompanyWide صراحةً
        foreach (['journal_entry', 'payroll_run', 'warehouse', 'branch', 'employee'] as $key) {
            $this->assertSame('company', $catalog[$key]['scope'], "النطاق المعروض لـ«{$key}» غير مطابق لتصنيفه.");
        }
    }

    /** التنسيق وعدد الأرقام ثابتان يُعرَضان للاطّلاع لا للضبط. @test */
    public function format_and_padding_are_reported_as_the_layer_constants(): void
    {
        $auth = $this->registerTenant();

        $res = $this->withToken($auth['token'])->getJson('/api/numbering-settings')->assertOk();

        $this->assertSame('numeric', $res['meta']['format']);
        $this->assertSame(5, $res['meta']['padding']);
        $this->assertSame(['invoice', 'purchase', 'quote'], $res['meta']['editable_keys']);
    }

    /** السلاسل المتعدّدة في الجدول الواحد تُعرَض منفصلة. @test */
    public function multi_series_entities_expose_each_series(): void
    {
        $auth = $this->registerTenant();

        $this->assertSame(
            ['SRET', 'PRET'],
            array_column($this->entity($auth['token'], 'return')['series'], 'prefix')
        );
        $this->assertSame(
            ['PR', 'RFQ', 'PQ', 'PO'],
            array_column($this->entity($auth['token'], 'procurement')['series'], 'prefix')
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  التحرير — البادئة وحدها، وحيث تدعمها الطبقة وحدها
    // ═══════════════════════════════════════════════════════════

    /** البادئة المحرَّرة تدخل رقم المستند المولَّد فعلاً. @test */
    public function editing_the_prefix_changes_the_generated_number(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'prefix' => 'FTR'])
            ->assertOk()->assertJsonPath('data.prefix', 'FTR');

        $customer = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data'];

        $number = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $customer['id'], 'payment_type' => 'cash',
            'items' => [['description' => 'منتج', 'quantity' => 1, 'unit_price' => 100000]],
        ])->assertCreated()['data']['number'];

        $this->assertStringStartsWith('FTR-', $number);
    }

    /**
     * الكيانات ذات البادئة الثابتة تُرفض صراحةً.
     *
     * القبول الصامت أسوأ من الرفض: يحفظ المستخدم بادئةً ويراها محفوظة، ثم
     * يصدر المستند بالبادئة القديمة — فيظنّ العطل في الترقيم لا في الإعداد.
     *
     * @test
     */
    public function a_hardcoded_prefix_entity_is_rejected_not_silently_ignored(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'journal_entry', 'prefix' => 'QYD'])
            ->assertStatus(422)->assertJsonValidationErrors('entity');

        $this->assertSame('JE', $this->entity($auth['token'], 'journal_entry')['series'][0]['prefix']);
    }

    /**
     * بادئة عرض السعر صارت إعداداً كبادئة الفاتورة — والإثبات أن الرقم
     * المولَّد يحملها، لا أن الإعداد حُفظ.
     *
     * @test
     */
    public function the_quote_prefix_is_configurable_and_reaches_the_generated_number(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'quote', 'prefix' => 'OFR'])
            ->assertOk()->assertJsonPath('data.prefix', 'OFR');

        $customer = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data'];

        $number = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $customer['id'],
            'items'      => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000]],
        ])->assertCreated()['data']['number'];

        $this->assertSame('OFR-' . now()->year . '-00001', $number);
    }

    /**
     * وبادئتا العرض والفاتورة مستقلّتان: ضبط إحداهما لا يمسّ الأخرى، وإن
     * كانتا في مجموعة الإعدادات نفسها.
     *
     * @test
     */
    public function the_quote_and_invoice_prefixes_stay_independent(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'quote', 'prefix' => 'OFR'])->assertOk();

        $this->assertSame('INV', $this->entity($auth['token'], 'invoice')['prefix']);

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'prefix' => 'FTR'])->assertOk();

        $this->assertSame('OFR', $this->entity($auth['token'], 'quote')['prefix']);
    }

    /** البادئة مُعرّف يُطبع ويُبحث به — لا نصّ حرّ. @test */
    public function an_invalid_prefix_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'prefix' => 'فاتورة!'])
            ->assertStatus(422)->assertJsonValidationErrors('prefix');
    }

    /** البادئة الفارغة تُعيد الافتراض لا تمحو الترقيم. @test */
    public function clearing_the_prefix_falls_back_to_the_default(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'prefix' => 'FTR'])->assertOk();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'prefix' => null])
            ->assertOk()->assertJsonPath('data.prefix', 'INV');
    }

    /**
     * الكتابة تذهب إلى المفتاح الذي تقرؤه الخدمة أصلاً — لا مخزن مواز.
     *
     * @test
     */
    public function the_prefix_is_written_where_the_service_already_reads_it(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'purchase', 'prefix' => 'SHR'])->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);

        $this->assertSame('SHR', \App\Support\Settings::get('purchases', 'purchase_prefix'));
    }

    /** التحرير محكوم بصلاحية إدارة المؤسسة. @test */
    public function editing_requires_company_manage_permission(): void
    {
        $auth  = $this->registerTenant();
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $this->withToken($staff)
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'prefix' => 'XXX'])
            ->assertForbidden();
    }
}
