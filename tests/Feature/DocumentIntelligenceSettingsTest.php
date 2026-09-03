<?php

namespace Tests\Feature;

use App\Services\DocumentCenter\DocumentExtractionNormalizer;
use App\Services\DocumentCenter\DocumentIntelligencePolicy;
use App\Support\DocumentIntelligence;
use App\Support\DocumentTypeCatalog;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  الذكاء المستندي — مفهومان مستقلّان لكل مستأجر
 * ═══════════════════════════════════════════════════════════════
 *  القرار المعماري غير القابل للكسر: **المعالجة الذكية** و**الاحتفاظ بالأصل**
 *  إعدادان منفصلان لا يقترنان. تفعيل الذكاء لا يفرض الاحتفاظ ولا يمنعه.
 *
 *  تشغيل: php artisan test --filter=DocumentIntelligenceSettingsTest
 */
class DocumentIntelligenceSettingsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** الافتراضات تحفظ سلوك المستأجرين القائمين حرفياً. */
    /** @test */
    public function defaults_preserve_existing_tenant_behavior(): void
    {
        $auth = $this->registerTenant();

        $data = $this->withToken($auth['token'])
            ->getJson('/api/document-intelligence-settings')->assertOk()['data'];

        $this->assertFalse($data['settings']['processing_enabled'], 'المعالجة الذكية معطّلة افتراضاً.');
        $this->assertSame([], $data['settings']['allowed_document_types'], 'لا نوع يُعالَج ذكياً افتراضاً.');
        $this->assertSame(
            DocumentIntelligence::RETENTION_DOCUMENT_CENTER_ONLY,
            $data['settings']['retention_mode'],
            'الاحتفاظ الافتراضي = المركز فقط (سلوك اليوم).'
        );
        $this->assertTrue($data['settings']['retains_original_in_document_center']);
        $this->assertFalse($data['settings']['attaches_original_to_record']);

        // الخيارات المتاحة للواجهة من نفس المصدر — لا تصنيفة موازية.
        $this->assertSame(DocumentTypeCatalog::all(), $data['available_document_types']);
        $this->assertContains('delivery_note', $data['available_document_types']);
        $this->assertSame(DocumentIntelligence::RETENTION_MODES, $data['available_retention_modes']);
    }

    /** المعالجة الذكية قابلة للتفعيل/التعطيل، والأنواع المسموحة قابلة للضبط. */
    /** @test */
    public function processing_and_allowed_types_are_configurable(): void
    {
        $auth = $this->registerTenant();

        $data = $this->withToken($auth['token'])->putJson('/api/document-intelligence-settings', [
            'processing_enabled' => true,
            'allowed_document_types' => ['purchase_invoice', 'delivery_note'],
        ])->assertOk()['data'];

        $this->assertTrue($data['settings']['processing_enabled']);
        $this->assertSame(['purchase_invoice', 'delivery_note'], $data['settings']['allowed_document_types']);

        // محفوظ ويُقرأ لاحقاً.
        $reload = $this->withToken($auth['token'])->getJson('/api/document-intelligence-settings')->assertOk();
        $reload->assertJsonPath('data.settings.processing_enabled', true);
        $reload->assertJsonPath('data.settings.allowed_document_types', ['purchase_invoice', 'delivery_note']);
    }

    /**
     * **القرار غير القابل للكسر:** تفعيل الذكاء لا يفرض الاحتفاظ بالأصل.
     *
     * @test
     */
    public function enabling_ai_never_implies_retention(): void
    {
        $auth = $this->registerTenant();

        // فعّل الذكاء واختر «لا تحتفظ بالأصل» معاً — كلاهما يُقبل ولا يشتقّ من الآخر.
        $data = $this->withToken($auth['token'])->putJson('/api/document-intelligence-settings', [
            'processing_enabled' => true,
            'allowed_document_types' => ['purchase_invoice'],
            'retention_mode' => DocumentIntelligence::RETENTION_DO_NOT_RETAIN,
        ])->assertOk()['data'];

        $this->assertTrue($data['settings']['processing_enabled']);
        $this->assertSame(DocumentIntelligence::RETENTION_DO_NOT_RETAIN, $data['settings']['retention_mode']);
        $this->assertFalse($data['settings']['retains_original_in_document_center']);
        $this->assertFalse($data['settings']['attaches_original_to_record']);
    }

    /** تغيير المعالجة لا يمسّ الاحتفاظ، والعكس صحيح — تحديث جزئي مستقلّ. */
    /** @test */
    public function the_two_concepts_are_updated_independently(): void
    {
        $auth = $this->registerTenant();

        // اضبط الاحتفاظ وحده.
        $this->withToken($auth['token'])->putJson('/api/document-intelligence-settings', [
            'retention_mode' => DocumentIntelligence::RETENTION_DOCUMENT_CENTER_AND_ATTACHMENT,
        ])->assertOk();

        // ثم فعّل المعالجة وحدها — الاحتفاظ يبقى كما هو.
        $data = $this->withToken($auth['token'])->putJson('/api/document-intelligence-settings', [
            'processing_enabled' => true,
        ])->assertOk()['data'];

        $this->assertTrue($data['settings']['processing_enabled']);
        $this->assertSame(
            DocumentIntelligence::RETENTION_DOCUMENT_CENTER_AND_ATTACHMENT,
            $data['settings']['retention_mode'],
            'ضبط المعالجة لم يعِد الاحتفاظ إلى الافتراض.'
        );
        $this->assertTrue($data['settings']['retains_original_in_document_center']);
        $this->assertTrue($data['settings']['attaches_original_to_record']);
    }

    /** كل دلالات الاحتفاظ الأربع ممثّلة تمثيلاً متمايزاً. */
    /** @test */
    public function all_four_retention_modes_are_represented_distinctly(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $expected = [
            DocumentIntelligence::RETENTION_DOCUMENT_CENTER_ONLY => [true, false],
            DocumentIntelligence::RETENTION_RECORD_ATTACHMENT_ONLY => [false, true],
            DocumentIntelligence::RETENTION_DOCUMENT_CENTER_AND_ATTACHMENT => [true, true],
            DocumentIntelligence::RETENTION_DO_NOT_RETAIN => [false, false],
        ];

        foreach ($expected as $mode => [$retains, $attaches]) {
            Settings::put(DocumentIntelligence::SETTINGS_GROUP, ['retention_mode' => $mode]);
            $policy = DocumentIntelligencePolicy::forTenant();
            $this->assertSame($mode, $policy->retentionMode());
            $this->assertSame($retains, $policy->retainsOriginalInDocumentCenter(), "retains for {$mode}");
            $this->assertSame($attaches, $policy->attachesOriginalToRecord(), "attaches for {$mode}");
        }
    }

    /** بوّابة المعالجة: التفعيل العام + إدراج النوع صراحةً. */
    /** @test */
    public function should_process_requires_both_enabled_and_allowed_type(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        // معطّل → لا معالجة مهما كانت الأنواع.
        Settings::put(DocumentIntelligence::SETTINGS_GROUP, [
            'processing_enabled' => false,
            'allowed_document_types' => ['purchase_invoice'],
        ]);
        $this->assertFalse(DocumentIntelligencePolicy::forTenant()->shouldProcessDocumentType('purchase_invoice'));

        // مفعّل لكن النوع غير مدرج → لا معالجة لهذا النوع.
        Settings::put(DocumentIntelligence::SETTINGS_GROUP, [
            'processing_enabled' => true,
            'allowed_document_types' => ['purchase_invoice'],
        ]);
        $policy = DocumentIntelligencePolicy::forTenant();
        $this->assertTrue($policy->shouldProcessDocumentType('purchase_invoice'));
        $this->assertFalse($policy->shouldProcessDocumentType('delivery_note'));
    }

    /** سياسة الاحتفاظ غير المعروفة مرفوضة. */
    /** @test */
    public function invalid_retention_mode_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->putJson('/api/document-intelligence-settings', [
            'retention_mode' => 'delete_everything_now',
        ])->assertStatus(422)->assertJsonValidationErrors('retention_mode');
    }

    /** نوع مستند غير مدعوم في قائمة المسموح مرفوض. */
    /** @test */
    public function invalid_allowed_document_type_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->putJson('/api/document-intelligence-settings', [
            'allowed_document_types' => ['purchase_invoice', 'not_a_real_type'],
        ])->assertStatus(422)->assertJsonValidationErrors('allowed_document_types.1');
    }

    /** الإعدادات معزولة بالمستأجر. */
    /** @test */
    public function settings_are_isolated_per_tenant(): void
    {
        $a = $this->registerTenant();
        $b = $this->registerTenant('other', 'other@nibras.test');

        $this->withToken($a['token'])->putJson('/api/document-intelligence-settings', [
            'processing_enabled' => true,
            'allowed_document_types' => ['delivery_note'],
            'retention_mode' => DocumentIntelligence::RETENTION_DO_NOT_RETAIN,
        ])->assertOk();

        // المستأجر الثاني لا يرى قرار الأول — يبقى على الافتراض الآمن.
        $data = $this->withToken($b['token'])->getJson('/api/document-intelligence-settings')->assertOk()['data'];
        $this->assertFalse($data['settings']['processing_enabled']);
        $this->assertSame([], $data['settings']['allowed_document_types']);
        $this->assertSame(DocumentIntelligence::RETENTION_DOCUMENT_CENTER_ONLY, $data['settings']['retention_mode']);
    }

    /** الإعداد سلطةٌ محكومة — الموظف لا يملكها. */
    /** @test */
    public function staff_cannot_change_document_intelligence_settings(): void
    {
        $auth = $this->registerTenant('nibras', 'owner@nibras.test');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@nibras.test');

        $this->withToken($staff)->putJson('/api/document-intelligence-settings', [
            'processing_enabled' => true,
        ])->assertForbidden();

        $this->withToken($staff)->getJson('/api/document-intelligence-settings')->assertForbidden();
    }

    /** التصنيف مصدره واحد: طلب الحزمة وإعدادات المستأجر يقرآن نفس القائمة. */
    /** @test */
    public function document_type_catalog_is_the_single_source_of_truth(): void
    {
        // النوع القديم delivery_note ما زال مقبولاً في طلب الحزمة (توافق رجعي).
        $this->assertTrue(DocumentTypeCatalog::supports('purchase_invoice'));
        $this->assertTrue(DocumentTypeCatalog::supports('delivery_note'));
        $this->assertFalse(DocumentTypeCatalog::supports('bank_statement'));
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  عقد المراجعة يمثّل القيم غير المؤكّدة (المكتوبة بخط اليد) بأمان
     * ═══════════════════════════════════════════════════════════════
     *  سندات التسليم غالباً بخط اليد. عقد الاستخراج **لا يفبرِك** قيمة حين
     *  يعجز عنها، ويحمل لكل حقل: الثقة، المصدر (provenance)، والموضع.
     */
    /** @test */
    public function extraction_contract_represents_uncertain_handwritten_fields_without_fabrication(): void
    {
        $json = json_encode([
            'document_type' => 'delivery_note',
            'language' => 'ar',
            'confidence' => '0.42',
            'fields' => [
                // كمية مكتوبة بخط اليد بثقة منخفضة — قيمة صريحة بمصدرها.
                'document_number' => 'DN-1507',
                'document_number_evidence' => ['confidence' => '0.55', 'source' => 'handwritten', 'page_number' => 1],
                // رقم العميل مفقود — يبقى null، لا يُفبرَك.
                'recipient_name' => null,
            ],
            'lines' => [[
                'description' => 'ديزل',
                'quantity' => '1507',
                'unit' => 'لتر',
                'confidence' => '0.40',
                'source' => 'handwritten',
                'page_number' => 1,
            ]],
            'warnings' => ['خط يدوي منخفض الوضوح'],
        ], JSON_THROW_ON_ERROR);

        $normalized = DocumentExtractionNormalizer::normalize($json, 'anthropic', 'test-model');

        // القيمة المفقودة تبقى null — لا اختلاق.
        $this->assertNull($normalized['fields']['recipient_name']);
        // القيمة غير المؤكّدة محفوظة مع دليلها (ثقة + مصدر خط اليد + الصفحة).
        $this->assertSame('DN-1507', $normalized['fields']['document_number']);
        $this->assertSame('handwritten', $normalized['field_evidence']['document_number']['source']);
        $this->assertSame(5500, $normalized['field_evidence']['document_number']['confidence_basis_points']);
        // السطر يحمل ثقته ومصدره كذلك.
        $this->assertSame('1507', $normalized['lines'][0]['quantity']);
        $this->assertSame('handwritten', $normalized['lines'][0]['source']);
        $this->assertSame(4000, $normalized['lines'][0]['confidence_basis_points']);
        $this->assertContains('خط يدوي منخفض الوضوح', $normalized['warnings']);
    }
}
