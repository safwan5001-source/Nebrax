<?php

namespace Tests\Feature;

use App\Services\AppBuilder\DataResourceRegistry;
use Tests\TestCase;

/**
 * APP-BUILDER-3 — سجلّ موارد البيانات فارغٌ عمداً اليوم: لا آلية "ربط"
 * (`bindings`) في عقد المخطط الحقيقي (`SchemaComponent._allowedKeys`)، ولا
 * `COMMERCE_MOBILE_API_READINESS.md` في هذا المستودع. هذا الاختبار يحرس بقاء
 * السجلّ فارغاً حتى يُتَّخذ قرارٌ صريح بخلاف ذلك (إضافة نحو `bindings` فعلي
 * لعقد المخطط + دليل جاهزية API حقيقي) — لا امتلاءه سهواً بمورد مُخترَع.
 *
 * تشغيل: php artisan test --filter=DataResourceRegistryTest
 */
class DataResourceRegistryTest extends TestCase
{
    public function test_registry_is_intentionally_empty_pending_schema_binding_support_and_api_readiness_evidence(): void
    {
        $this->assertSame(
            [],
            DataResourceRegistry::RESOURCES,
            'أي مورد يُضاف هنا يحتاج دليلاً حقيقياً (نحو bindings في عقد المخطط + '
            .'COMMERCE_MOBILE_API_READINESS.md) قبل قفله — انظر تعليق الصنف.'
        );
    }
}
