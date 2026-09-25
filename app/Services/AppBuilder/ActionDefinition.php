<?php

namespace App\Services\AppBuilder;

/**
 * البيان الوصفي الكامل لنوع إجراء واحد — يغذّي Inspector المستقبلي (نموذج
 * ضبط مُدخلات الإجراء). `dispatchStatus` يوثّق فجوة **عقد مخطط App Builder
 * تحديداً**: هل مساراً تُنشئه أنت في الـInspector — إجراءً على عقدة، مربوطاً
 * أو غير مربوط — يصل فعلياً إلى تنفيذ تجاري حقيقي عند العرض/النشر؟ هذا
 * مستقلٌّ تماماً عن كون بناء الجوال المُثبَت نفسه ينفّذ الإجراء فعلياً في
 * شاشاته المكتوبة يدوياً (`home_screen.dart`/`product_screen.dart`/
 * `cart_screen.dart` عبر `RuntimeActionHandler` الحقيقي — ذلك أُنجز في أفق
 * Mobile Runtime Proof V1 المُغلَق، ولا علاقة له بهذا العقد).
 *
 * - `DISPATCH_PROVEN_NOOP`: يُفكَّك ويُتحقَّق منه بنجاح، لكن لا مسار مخطط
 *   يصل به إلى تنفيذ حقيقي بعد — إمّا لأنه غير قابل للربط أصلاً (`navigate`/
 *   `refresh` لا يحتاجان بيانات عنصر)، أو لأنه يُستهلَك فقط من شجرة Dart
 *   مملوكة للشاشة لا من مخطط مُحلَّل (`addToCart`، حصراً `ProductScreen`).
 * - `DISPATCH_LIVE` (`APP-BUILDER-18`): مُثبَتٌ الآن قابلاً للوصول تماماً عبر
 *   مسارٍ **مربوط** مُعلَن في المخطط — تحليل ← توافق ← ربط/`$item.*` ←
 *   عرض ← تفكيك/تفويض — بنفس الآلية الحرفية التي يستهلكها أي مخطط منشور
 *   حقيقي (`resolveNodeBindings`، `CompatibilityResolver::bindingSupported()`).
 *   الإثبات: `mobile/test/app/vertical_slice_test.dart` (PR #1006) يُشغِّل
 *   هذا المسار الحقيقي حرفياً (تبويب بطاقة منتج، تعديل كمية، إزالة سطر).
 */
final class ActionDefinition
{
    public const DISPATCH_PROVEN_NOOP = 'provenNoop';

    /** `APP-BUILDER-18` — انظر توثيق الصنف أعلاه. */
    public const DISPATCH_LIVE = 'live';

    /**
     * @param  array<int, ActionParamDefinition>  $params
     */
    public function __construct(
        public readonly string $type,
        public readonly int $version,
        public readonly string $riskClass,
        public readonly array $params,
        public readonly string $dispatchStatus,
        public readonly string $notes,
        public readonly Label $label,
    ) {}
}
