<?php

namespace App\Services\AppBuilder;

/**
 * البيان الوصفي الكامل لنوع مكوّن واحد — يغذّي Inspector المستقبلي (لوحة
 * الخصائص، تسميات المحرِّر، قواعد الإسقاط) دون أي أثر على وقت التشغيل.
 *
 * لا حقل `bindings` هنا — عقد المخطط الحقيقي المُختبَر
 * (`mobile/lib/schema/app_schema.dart`، `SchemaComponent._allowedKeys`) يقبل
 * فقط `type/id/optional/props/children/action`؛ لا آلية "ربط بيانات" منفصلة
 * عن `props` موجودة اليوم. مفهوم "Bindings" في `COMPONENT_REGISTRY_V1.md` §6
 * توضيحي لعقدٍ مستقبلي لم يُبنَ بعد — اختراعه هنا كان سيكرر خطأ APP-BUILDER-1
 * (بناء من وثيقة توضيحية بدل الدليل الحقيقي) الذي صحّحته APP-BUILDER-2.
 */
final class ComponentDefinition
{
    /**
     * @param  array<int, PropDefinition>  $props
     * @param  array<int, string>  $injectedRuntimeActionParams  مفاتيح يُلحقها وقت التشغيل بـ`action.params` تلقائياً (مثال: `Quantity` يُلحق `quantity` الحيّة عند كل ضغطة)، لا يؤلّفها المخطط.
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
    ) {}
}
