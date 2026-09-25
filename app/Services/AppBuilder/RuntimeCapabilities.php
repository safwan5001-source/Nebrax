<?php

namespace App\Services\AppBuilder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سجلّ هويات ثابت — مطابقٌ حرفياً لـ mobile/lib/schema/registry_identifiers.dart
 * ═══════════════════════════════════════════════════════════════
 *
 * **يجب أن يبقى مطابقاً حرفياً** لملف Flutter المقابل — هذا هو نفس بناء AWJ
 * Mobile Runtime المُثبَت فعلياً (15 مكوّناً، 6 إجراءات، قدرة أصلية واحدة،
 * كلها إصدار 1)، لا قائمة مستقلة يخترعها الخادم. أي تعديل هنا بلا تعديل
 * مطابق في `registry_identifiers.dart` يكسر التوافق الحقيقي بين ما يقبله
 * الخادم وقت النشر وما يعرضه التطبيق فعلياً وقت التشغيل.
 *
 * سجلّات المكوّنات/الإجراءات/الموارد الكاملة (خصائص، تحقق قيم، meta المحرّر)
 * هي APP-BUILDER-3 — هذا الصنف يعرف فقط «هوية + رقم إصدار»، تماماً كنظيره
 * في Dart.
 */
final class RuntimeCapabilities
{
    private function __construct() {}

    /** @var array<string, int> */
    public const COMPONENTS = [
        'Page' => 1,
        'Section' => 1,
        'Text' => 1,
        'Image' => 1,
        'ProductList' => 1,
        'ProductCard' => 1,
        'ProductDetail' => 1,
        'Price' => 1,
        'VariantSelector' => 1,
        'Quantity' => 1,
        'AddToCart' => 1,
        'CartList' => 1,
        'CartSummary' => 1,
        'Button' => 1,
        'NavigationTarget' => 1,
    ];

    /** @var array<string, int> */
    public const ACTIONS = [
        'navigate' => 1,
        'openProduct' => 1,
        'addToCart' => 1,
        'updateCartQuantity' => 1,
        'removeCartItem' => 1,
        'refresh' => 1,
    ];

    /** @var array<string, int> */
    public const NATIVE_CAPABILITIES = [
        'push.notifications' => 1,
    ];

    /**
     * فضاء هويات موارد البيانات — **فارغٌ عمداً اليوم**، على عكس
     * `DataResourceRegistry::RESOURCES` (`APP-BUILDER-13`، مُقفَل على نطاق V1
     * الثلاثي). هذا الثابت يمثّل ما **يستهلكه فعلياً** بناء Flutter المُثبَت —
     * لا Flutter Runtime يحلّ `binding` إلى استدعاء `commerce/v1` حقيقي بعد
     * (ذلك `APP-BUILDER-17`، الذي يحدّث هذا الثابت **و**نظيره Dart معاً في
     * نفس المهمة). حتى ذلك الحين، أي عقدة تحمل `binding` تُعامَل كقدرة غير
     * متوفرة عبر `CompatibilityResolver::resolveComponent()` — تماماً كمكوّن/
     * إجراء غير مدعوم: تُقلَّم إن كانت اختيارية، أو تُفشل الوثيقة كاملة إن
     * كانت إلزامية. الفصل بين هذا الثابت و`DataResourceRegistry::RESOURCES`
     * مقصود: الأول «ماذا يعرف أَوْج عن `commerce/v1`» (يغذّي محرِّر الربط)،
     * والثاني «ماذا يستهلك التشغيل المُثبَت فعلياً اليوم» — لا يتطابقان حتى
     * يُنجَز APP-BUILDER-17.
     *
     * @var array<string, int>
     */
    public const DATA_RESOURCES = [];

    /**
     * فضاء ميزات المخطط (لا هويّة مورد بيانات ولا قدرة منصّة أصلية) — **فارغٌ
     * عمداً اليوم** لنفس سبب `DATA_RESOURCES` بالضبط: لا Flutter Runtime
     * يحلّ شجرة `visibility` إلى إخفاء/إظهار فعلي بعد (`APP-BUILDER-16` يضيف
     * العقد فقط؛ الاستهلاك الحقيقي `APP-BUILDER-17`، الذي يحدّث هذا الثابت
     * ونظيره Dart معاً). حتى ذلك الحين تُعامَل `visibility` كقدرة غير متوفرة
     * — تُقلَّم إن كانت اختيارية، أو تُفشل الوثيقة كاملة إن كانت إلزامية،
     * تماماً كمكوّن/إجراء/مورد بيانات غير مدعوم.
     *
     * **`binding.collect`** (`APP-BUILDER-17` slice 3، Decision Gate معتمَد):
     * مفتاح مستقلّ يفصل «يدعم الربط الأساسي» عن «يدعم تكرار قالب التجميع»
     * — بناءٌ يُبلِّغ عن `resourceVersion()` بلا هذا المفتاح لا يُعامَل كداعمٍ
     * لِـ`binding.collect` إطلاقاً (`CompatibilityResolver::bindingSupported()`).
     * **فارغٌ عمداً حتى الآن أيضاً**: قلب هذا المفتاح والتشغيل الفعلي في
     * `mobile/` كلاهما يجب أن يشحنا معاً في بناء جوال مُثبَت ومُتحقَّق منه أولاً
     * — لا قبل ذلك.
     *
     * @var array<string, int>
     */
    public const SCHEMA_FEATURES = [];
}
