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
}
