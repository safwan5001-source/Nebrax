<?php

namespace App\Services\AppBuilder;

/**
 * البيان الوصفي الكامل لنوع مكوّن واحد — يغذّي Inspector المستقبلي (لوحة
 * الخصائص، تسميات المحرِّر، قواعد الإسقاط) دون أي أثر على وقت التشغيل.
 *
 * **`ADR-01` (APP-BUILDER-14): `binding` صار مفتاحاً اختيارياً حقيقياً** على
 * عقدة المكوّن (`AppSchemaParser::COMPONENT_KEYS`)، محروساً بقدرة تشغيل
 * (`CapabilityManifest::resourceVersion()`) لا تزال فارغة اليوم عمداً —
 * لا Flutter Runtime يستهلك ربطاً حياً بعد (ذلك `APP-BUILDER-17`). `$bindableResources`
 * هنا وصفيٌّ فقط اليوم أيضاً (يوازي عدم تفعيل `$actionable` بنيوياً بعد) —
 * يُستهلَك عند التحقّق الفعلي في `CompatibilityResolver`، ومحرِّر الربط
 * (`APP-BUILDER-15`) يقرأه ليعرض للتاجر أيّ مورد يصحّ ربطه بهذا المكوّن.
 */
final class ComponentDefinition
{
    /**
     * @param  array<int, PropDefinition>  $props
     * @param  array<int, string>  $injectedRuntimeActionParams  مفاتيح يُلحقها وقت التشغيل بـ`action.params` تلقائياً (مثال: `Quantity` يُلحق `quantity` الحيّة عند كل ضغطة)، لا يؤلّفها المخطط.
     * @param  array<int, string>  $bindableResources  معرّفات `DataResourceRegistry` المسموح ربط هذا المكوّن بها — فارغة يعني غير قابل للربط في V1.
     */
    public function __construct(
        public readonly string $type,
        public readonly int $version,
        public readonly string $category,
        public readonly array $props,
        public readonly ChildrenRule $childrenRule,
        public readonly bool $actionable,
        public readonly array $injectedRuntimeActionParams,
        public readonly string $notes,
        public readonly Label $label,
        public readonly array $bindableResources = [],
    ) {}
}
