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
     * فضاء هويات موارد البيانات — **مُفعَّلٌ الآن لِـ`commerce.products`/
     * `commerce.cart` فقط** (`APP-BUILDER-17` slice 3c — تفعيل الخادم بعد
     * الإثبات التشغيلي)، لا نطاق `DataResourceRegistry::RESOURCES` الثلاثي
     * كاملاً (`commerce.categories` يبقى مستبعَداً عمداً: لا مكوّن مسجَّل
     * يسمح بالربط به، ولا بناء جوال يستهلكه). هذا الثابت يطابق حرفياً ما
     * أثبتته `mobile/lib/schema/registry_identifiers.dart`'s `dataResources`
     * — نفس هويتَي المورد، نفس رقم الإصدار — عملاً بقرار المالك (2026-09-25):
     * تحقّق Gate G/H للتشغيل الحالي (تحليل + اختبارات + بناء إصدار Android/iOS
     * عبر CI، PR #1006/Mobile CI run 36131595231) يكفي وفق سابقة هذا المستودع
     * ذاته لإغلاق أفق إثبات التشغيل بالكامل (`AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1_CLOSURE_REPORT.md`)
     * — لا يُشترَط توزيعٌ فعلي على جهاز حقيقي لهذا التفعيل. أي عقدة تربط
     * مورداً آخر (مثل `commerce.categories`) تبقى تُعامَل كقدرة غير متوفرة
     * عبر `CompatibilityResolver::resolveComponent()` تماماً كمكوّن/إجراء غير
     * مدعوم: تُقلَّم إن كانت اختيارية، أو تُفشل الوثيقة كاملة إن كانت إلزامية.
     *
     * **قيدٌ تشغيلي مسجَّل، لا حاجزٌ لهذا التفعيل**: قبل أوّل توزيع فعلي
     * لتطبيق الجوال (توزيع داخلي، متجر، أو أي قناة إنتاجية)، يجب إجراء تحقّق
     * حقيقي على جهاز/محاكي فعلي مقابل مستأجر `commerce/v1` حقيقي ومُتحكَّم
     * به بأمان، يغطي على الأقل: الرئيسية، السلة، سلوك الشبكة، ترطيب الربط
     * (binding hydration)، العرض، وتدفّقات التعديل/الإجراء (mutation/action).
     * هذا القيد لا يُسقَط ضمناً بهذا التفعيل — يُسجَّل صراحةً هنا لأن أي بناء
     * جوال حتى تاريخه (بما فيه هذا) لم يُوزَّع فعلياً على جهاز حقيقي قط.
     *
     * @var array<string, int>
     */
    public const DATA_RESOURCES = ['commerce.products' => 1, 'commerce.cart' => 1];

    /**
     * فضاء ميزات المخطط (لا هويّة مورد بيانات ولا قدرة منصّة أصلية).
     *
     * **`binding.collect`** (`APP-BUILDER-17` slice 3، Decision Gate معتمَد)
     * **مُفعَّلٌ الآن**: مفتاح مستقلّ يفصل «يدعم الربط الأساسي» عن «يدعم تكرار
     * قالب التجميع» — بناءٌ يُبلِّغ عن `resourceVersion()` بلا هذا المفتاح لا
     * يُعامَل كداعمٍ لِـ`binding.collect` إطلاقاً
     * (`CompatibilityResolver::bindingSupported()`) — القاعدة تبقى فعّالة
     * ومُختبَرة حتى بعد هذا التفعيل (`CompatibilityResolverTest`). يطابق
     * حرفياً `mobile/lib/schema/registry_identifiers.dart`'s `schemaFeatures`،
     * لنفس سبب [DATA_RESOURCES] بالضبط.
     *
     * **`visibility` تبقى مستبعدةً عمداً**: لا Flutter Runtime يحلّ شجرة
     * `visibility` إلى إخفاء/إظهار فعلي بعد (`APP-BUILDER-16` يضيف العقد
     * فقط، ولا مخطط مُجمَّع يستعملها اليوم) — تُعامَل كقدرة غير متوفرة، تُقلَّم
     * إن كانت اختيارية أو تُفشل الوثيقة كاملة إن كانت إلزامية، تماماً كمكوّن/
     * إجراء/مورد بيانات غير مدعوم، ومطابقةً تماماً لتحفّظ Dart المقابل.
     *
     * @var array<string, int>
     */
    public const SCHEMA_FEATURES = ['binding.collect' => 1];
}
