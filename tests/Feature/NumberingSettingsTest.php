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

        $this->assertCount(count(DocumentNumberingCatalog::ENTITIES), $catalogued);
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
        $this->assertSame(
            DocumentNumberingCatalog::editableKeys(),
            $res['meta']['editable_keys']
        );
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
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'series_key' => 'default', 'prefix' => 'FTR'])
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
     * عقد PUT السابق يبقى للكيان ذي السلسلة الوحيدة: غياب المفتاح لا يخلق
     * تخميناً، بل يحل `default` المحددة في الكتالوج نفسه.
     *
     * @test
     */
    public function a_legacy_single_series_update_resolves_the_catalog_default(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'prefix' => 'LEG'])
            ->assertOk()->assertJsonPath('data.prefix', 'LEG');

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('LEG', DocumentNumberingCatalog::formatForModel(\App\Models\Invoice::class, 'INV')['prefix']);
    }

    /** السلسلة المتعددة لا تسمح بتخمينٍ قد يضبط مساراً غير مقصود. @test */
    public function a_multi_series_entity_requires_its_explicit_valid_series_key(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'payment', 'prefix' => 'REC'])
            ->assertStatus(422)->assertJsonValidationErrors('series_key');

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'payment', 'series_key' => 'sales', 'prefix' => 'REC'])
            ->assertStatus(422)->assertJsonValidationErrors('series_key');

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'payment', 'series_key' => 'received', 'prefix' => 'RECPT'])
            ->assertOk()->assertJsonPath('data.series.0.prefix', 'RECPT');

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('RECPT', DocumentNumberingCatalog::formatForModel(\App\Models\Payment::class, 'REC')['prefix']);
    }

    /**
     * كل كيان مرقّم يقبل ضبط السلسلة المعلنة له؛ لا تبقى البادئات الثابتة
     * مقبولة شكلياً ثم متجاهلة عند التوليد.
     *
     * @test
     */
    public function a_previously_hardcoded_entity_uses_its_explicit_series_format(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'journal_entry', 'series_key' => 'default', 'prefix' => 'QYD'])
            ->assertOk()->assertJsonPath('data.series.0.prefix', 'QYD');

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('QYD', DocumentNumberingCatalog::formatForModel(\App\Models\JournalEntry::class, 'JE')['prefix']);
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
            ->putJson('/api/numbering-settings', ['entity' => 'quote', 'series_key' => 'default', 'prefix' => 'OFR'])
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
            ->putJson('/api/numbering-settings', ['entity' => 'quote', 'series_key' => 'default', 'prefix' => 'OFR'])->assertOk();

        $this->assertSame('INV', $this->entity($auth['token'], 'invoice')['prefix']);

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'series_key' => 'default', 'prefix' => 'FTR'])->assertOk();

        $this->assertSame('OFR', $this->entity($auth['token'], 'quote')['prefix']);
    }

    /**
     * كود الفرع والمخزن يتبع الإعداد كبقية المستندات — وافتراضه فارغ فيبقى
     * `00001` كما كان لكل مستأجر قائم، فلا يتغيّر شيء بلا طلبٍ صريح.
     *
     * @test
     */
    public function branch_and_warehouse_codes_follow_the_configured_prefix(): void
    {
        $auth = $this->registerTenant();

        // الافتراض: بلا بادئة.
        $branch = $this->withToken($auth['token'])
            ->postJson('/api/branches', ['name' => 'بلا بادئة'])->assertCreated()['data'];
        $this->assertSame('00002', $branch['code']); // 00001 هو الفرع الرئيسي المُنشأ بالتسجيل

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'branch', 'series_key' => 'default', 'prefix' => 'BR'])
            ->assertOk()->assertJsonPath('data.prefix', 'BR');

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'warehouse', 'series_key' => 'default', 'prefix' => 'WH'])->assertOk();

        $next = $this->withToken($auth['token'])
            ->postJson('/api/branches', ['name' => 'ببادئة'])->assertCreated()['data'];
        $this->assertSame('BR-00001', $next['code']);

        $warehouse = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن', 'branch_id' => $branch['id'],
        ])->assertCreated()['data'];
        $this->assertSame('WH-00001', $warehouse['code']);
    }

    /** البادئة مُعرّف يُطبع ويُبحث به — لا نصّ حرّ. @test */
    public function an_invalid_prefix_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'series_key' => 'default', 'prefix' => 'فاتورة!'])
            ->assertStatus(422)->assertJsonValidationErrors('prefix');
    }

    /** البادئة الفارغة تُعيد الافتراض لا تمحو الترقيم. @test */
    public function clearing_the_prefix_falls_back_to_the_default(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'series_key' => 'default', 'prefix' => 'FTR'])->assertOk();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'series_key' => 'default', 'prefix' => null])
            ->assertOk()->assertJsonPath('data.prefix', 'INV');
    }

    /**
     * الكتابة تذهب إلى مخزن السلاسل الذي تقرؤه طبقة الترقيم نفسها — لا إلى
     * مفتاح بادئة قديم أو مسار مواز.
     *
     * @test
     */
    public function the_series_format_is_written_where_the_numbering_layer_reads_it(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/numbering-settings', ['entity' => 'purchase', 'series_key' => 'default', 'prefix' => 'SHR'])->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);

        $this->assertSame('SHR', \App\Support\Settings::get('numbering', 'document_series')['purchase']['default']['prefix']);
        $this->assertSame('SHR', DocumentNumberingCatalog::formatForModel(\App\Models\Purchase::class, 'BILL')['prefix']);
    }

    /** التحرير محكوم بصلاحية إدارة المؤسسة. @test */
    public function editing_requires_company_manage_permission(): void
    {
        $auth  = $this->registerTenant();
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $this->withToken($staff)
            ->putJson('/api/numbering-settings', ['entity' => 'invoice', 'series_key' => 'default', 'prefix' => 'XXX'])
            ->assertForbidden();
    }
}
