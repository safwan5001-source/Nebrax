<?php

namespace App\Services\AppBuilder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سجلّ موارد البيانات — فارغٌ عمداً اليوم (APP-BUILDER-3)
 * ═══════════════════════════════════════════════════════════════
 *
 * `DATA_RESOURCE_REGISTRY_V1.md` يصف آلية "ربط" (`binding`) تصل مكوّناً بمورد
 * بيانات حيّ (`commerce.products`، `commerce.cart`...). هذه الآلية **غير
 * موجودة في عقد المخطط الحقيقي المُختبَر**: `SchemaComponent._allowedKeys`
 * في `mobile/lib/schema/app_schema.dart` يقبل فقط
 * `type/id/optional/props/children/action` — أي مفتاح `bindings` يُرفَض
 * بنيوياً بخطأ `unknown_key`، لا يُقبل ويُتجاهَل. `RuntimeCapabilities`
 * (APP-BUILDER-2) لا يُعرِّف أي هوية "مورد بيانات" ضمن العقد المتوافق أصلاً.
 *
 * لا وجود أيضاً لـ`COMMERCE_MOBILE_API_READINESS.md` في هذا المستودع (الوثيقة
 * التي يشترطها `DATA_RESOURCE_REGISTRY_V1.md` §41/§43 قبل قفل أي مورد) — أي
 * قائمة موارد اليوم ستكون اختراعاً بلا دليل تنفيذي وراءه، تماماً كالخطأ الذي
 * صحّحته APP-BUILDER-2 على مستوى المخطط نفسه.
 *
 * **لذلك هذا السجلّ فارغ عمداً**، لا مفقود سهواً: يثبّت الحيّز البنائي الذي
 * ستملؤه مهمة لاحقة (بعد إضافة نحو `bindings` فعلي لعقد المخطط، ومُثبَت
 * بدليل جاهزية Commerce Mobile API حقيقي)، دون اختراع مورد واحد اليوم.
 * `DataResourceRegistryTest` يحرس بقاءه فارغاً حتى يُتَّخذ قرارٌ صريح بخلاف ذلك.
 */
final class DataResourceRegistry
{
    private function __construct() {}

    /** @var array<string, int> */
    public const RESOURCES = [];
}
