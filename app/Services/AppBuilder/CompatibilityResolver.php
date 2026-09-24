<?php

namespace App\Services\AppBuilder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  محلِّل التوافق — مطابقٌ لـ mobile/lib/schema/compatibility.dart
 * ═══════════════════════════════════════════════════════════════
 *
 * دالة نقية: نفس المخطط + نفس البيان يُنتجان دوماً نفس النتيجة. يُستدعى فقط
 * عند **النشر** (`BuilderPublishedExperienceVersionService::publish()`) —
 * حفظ المسودة (Authoring validation) يكتفي بالتحقق البنيوي
 * (`AppSchemaParser`)، مطابقاً لتمييز `APP_SCHEMA_V1.md` §21 بين تحقق
 * التأليف وتحقق النشر (الأخير أشدّ صراحةً). يفترض أن `$schema` مرّ فعلاً عبر
 * `AppSchemaParser::validate()` (بلا استثناء) — لا يعيد التحقق البنيوي.
 *
 * **قاعدة الإغلاق الآمن**: قدرة مطلوبة (component/action/binding غير `optional`)
 * غير مدعومة تُفشل **الوثيقة كاملة**، لا الصفحة فقط — يطابق تعليق Dart
 * الحرفي: «reaching null here means a required descendant failed closed,
 * which must fail the whole document closed». عقدة اختيارية غير مدعومة
 * تُسقَط هي وشجرتها الفرعية كاملة (`fallbacks`)، والنشر يستمر.
 *
 * **`binding` (`APP-BUILDER-14`, `ADR-01`)**: يُعامَل بنفس آلية component/action
 * تماماً — هوية مورد غير معروفة، مكوّن لا يسمح بالربط بهذا المورد، حقول/
 * معاملات لا يعرضها المورد، أو قدرة تشغيل غير متوفرة بعد (`resourceVersion()`)
 * كلها تُسقِط العقدة بنفس مسار الإسقاط/الإغلاق أعلاه — لا مسار فشل منفصل.
 *
 * **`visibility` (`APP-BUILDER-16`, `ADR-01`)**: نفس المعاملة أيضاً — إشارة/
 * مُشغّل غير معروفين، `value` بشكل لا يوافق المُشغّل، أو قدرة تشغيل غير
 * متوفرة بعد (`schemaFeatureVersion('visibility')`) تُسقِط العقدة بنفس
 * المسار. لا محرّك تعابير هنا — مجموعة إشارات/مُشغّلات مغلقة فقط
 * (`VisibilitySignal`/`VisibilityOperator`)، والعرض/الإخفاء دوماً سلوك واجهة
 * بحت لا يُغيّر أي تفويض خادم حقيقي.
 */
final class CompatibilityResolver
{
    public function resolve(array $schema, CapabilityManifest $manifest): CompatibilityResult
    {
        $schemaVersion = SchemaVersion::tryParse($schema['schemaVersion']);
        $minRuntimeVersion = SchemaVersion::tryParse($schema['minRuntimeVersion']);

        if ($schemaVersion->greaterThan($manifest->maxSupportedSchemaVersion)) {
            return CompatibilityResult::incompatible(
                CompatibilityResult::REASON_SCHEMA_VERSION_TOO_NEW,
                "schema {$schemaVersion} is newer than this runtime supports (max {$manifest->maxSupportedSchemaVersion})",
            );
        }
        if ($manifest->minSupportedSchemaVersion->greaterThan($schemaVersion)) {
            return CompatibilityResult::incompatible(
                CompatibilityResult::REASON_SCHEMA_VERSION_TOO_OLD,
                "schema {$schemaVersion} is older than this runtime supports (min {$manifest->minSupportedSchemaVersion})",
            );
        }
        if ($manifest->runtimeVersion->lessThan($minRuntimeVersion)) {
            return CompatibilityResult::incompatible(
                CompatibilityResult::REASON_RUNTIME_TOO_OLD,
                "runtime {$manifest->runtimeVersion} is older than schema requires (min {$minRuntimeVersion})",
            );
        }

        foreach (($schema['requiredCapabilities'] ?? []) as $key => $requiredVersion) {
            $have = $manifest->namedCapabilityVersion($key);
            if ($have === null || $have < $requiredVersion) {
                $haveLabel = $have === null ? 'none' : (string) $have;

                return CompatibilityResult::incompatible(
                    CompatibilityResult::REASON_MISSING_REQUIRED_CAPABILITY,
                    "required capability \"{$key}\" v{$requiredVersion} is not available (have: {$haveLabel})",
                );
            }
        }

        $fallbacks = [];
        foreach (($schema['pages'] ?? []) as $pageId => $root) {
            $resolvedRoot = $this->resolveComponent($root, $manifest, $fallbacks);
            if ($resolvedRoot === false) {
                return CompatibilityResult::incompatible(
                    CompatibilityResult::REASON_MISSING_REQUIRED_CAPABILITY,
                    "page \"{$pageId}\" contains a required, unsupported component or action",
                );
            }
        }

        return CompatibilityResult::compatible($fallbacks);
    }

    /**
     * يعيد `true` عند إمكان عرض العقدة (بغضّ النظر عن تقليم فرعي اختياري)،
     * أو `false` حين يكون نوع العقدة نفسها أو إجراؤها أو ربطها غير مدعوم.
     * القرار سقوط/تجاوز يُتّخذ عند الأب باستعمال علم `optional` **للطفل
     * نفسه** — وسم مكوّن اختيارياً يجعل شجرته الفرعية كلها وحدة إسقاط آمنة
     * واحدة.
     *
     * @param  array<int, array{componentId: string, componentType: string, reason: string}>  &$fallbacks
     */
    private function resolveComponent(array $node, CapabilityManifest $manifest, array &$fallbacks): bool
    {
        $action = $node['action'] ?? null;
        $unsupportedHere = $manifest->componentVersion($node['type']) === null
            || ($action !== null && $manifest->actionVersion($action['type']) === null)
            || (($node['binding'] ?? null) !== null && ! $this->bindingSupported($node['type'], $node['binding'], $manifest))
            || (($node['visibility'] ?? null) !== null && ! $this->visibilitySupported($node['visibility'], $manifest));
        if ($unsupportedHere) {
            return false;
        }

        foreach (($node['children'] ?? []) as $child) {
            $childOk = $this->resolveComponent($child, $manifest, $fallbacks);
            if (! $childOk) {
                if ($child['optional'] ?? false) {
                    $fallbacks[] = [
                        'componentId' => $child['id'],
                        'componentType' => $child['type'],
                        'reason' => 'unsupported component/action, or an unsupported required descendant within this optional subtree',
                    ];

                    continue;
                }

                return false;
            }
        }

        return true;
    }

    /**
     * `APP-BUILDER-14` (`ADR-01`): يفشل الربط في أيٍّ من أربع حالات — مورد
     * غير معروف في `DataResourceRegistry`، مكوّن لا يسمح سجلّه (`ComponentRegistry`)
     * بالربط بهذا المورد تحديداً، `itemProps`/`query` تُشير إلى حقول/معاملات
     * لا يعرضها المورد فعلياً، أو القدرة نفسها غير متوفرة في بناء التشغيل
     * الحالي (`manifest->resourceVersion()` — فارغة دوماً حتى `APP-BUILDER-17`).
     * التحقّق الثلاثة الأولى شكلي/دلالي بحت (لا علاقة له بإصدار البناء)، مطلوبٌ
     * حتى قبل أن يستهلك أيّ تشغيل رابطاً فعلياً — فيمنع محرِّر الربط
     * (`APP-BUILDER-15`) من حفظ ربط مكسور بنيوياً من اليوم الأول.
     */
    private function bindingSupported(string $componentType, array $binding, CapabilityManifest $manifest): bool
    {
        $resourceId = $binding['resource'] ?? null;
        if (! is_string($resourceId) || $resourceId === '') {
            return false;
        }

        $resource = DataResourceRegistry::definitions()[$resourceId] ?? null;
        if ($resource === null) {
            return false;
        }

        $component = ComponentRegistry::definitions()[$componentType] ?? null;
        if ($component === null || ! in_array($resourceId, $component->bindableResources, true)) {
            return false;
        }

        // `ProductList`/`CartList` (شكل قائمة) لا يعلنان أيّ `props` خاصة بهما —
        // `itemProps` هناك يستهدف قالب عنصر لم يُحسم شكله بعد (`APP-BUILDER-15`/
        // `17`)، فالتحقّق من مطابقة `propKey` لخصائص المكوّن نفسه يُطبَّق فقط
        // حين يُعلن المكوّن (شكل مفرد، مثل `ProductDetail`/`CartSummary`) خصائصه
        // فعلياً — تحقّق صحة حقل المورد المقروء يبقى إلزامياً في الحالتين.
        $componentPropKeys = array_map(fn (PropDefinition $prop) => $prop->key, $component->props);
        $readableFields = $resource->readableFieldKeys();
        foreach (($binding['itemProps'] ?? []) as $propKey => $fieldPath) {
            if ($componentPropKeys !== [] && ! in_array($propKey, $componentPropKeys, true)) {
                return false;
            }
            $topSegment = explode('.', (string) $fieldPath, 2)[0];
            if (! in_array($topSegment, $readableFields, true)) {
                return false;
            }
        }

        // مفاتيح الاستعلام المسموحة: مفاتيح الترشيح حرفياً + مفتاح `sort` الحرفي
        // الواحد إن كان للمورد حقول فرز أصلاً (قيمته تُتحقَّق بمعزل أدناه، لا
        // كمفتاح) + `id` فقط حين يملك المورد endpoint تفاصيل.
        $allowedQueryKeys = array_merge(
            $resource->filterKeys(),
            $resource->sortKeys() !== [] ? ['sort'] : [],
            $resource->detailEndpoint !== null ? ['id'] : [],
        );
        foreach (($binding['query'] ?? []) as $queryKey => $queryValue) {
            if (! in_array($queryKey, $allowedQueryKeys, true)) {
                return false;
            }
            if ($queryKey === 'sort') {
                $sortField = ltrim((string) $queryValue, '-');
                if (! in_array($sortField, $resource->sortKeys(), true)) {
                    return false;
                }
            }
        }

        return $manifest->resourceVersion($resourceId) !== null;
    }

    /**
     * `APP-BUILDER-16` (`ADR-01`): القدرة أولاً (`manifest->schemaFeatureVersion('visibility')`
     * — فارغة دوماً حتى `APP-BUILDER-17`)، ثم صحة الشجرة دلالياً بمعزل عن
     * إصدار البناء (إشارة/مُشغّل معروفان، وتوافق شكل `value` مع المُشغّل) —
     * كلاهما يجب أن يمرّا.
     */
    private function visibilitySupported(array $visibility, CapabilityManifest $manifest): bool
    {
        return $manifest->schemaFeatureVersion('visibility') !== null
            && $this->visibilityConditionValid($visibility);
    }

    private function visibilityConditionValid(array $condition): bool
    {
        foreach (['all', 'any'] as $combinator) {
            if (array_key_exists($combinator, $condition)) {
                foreach ($condition[$combinator] as $branch) {
                    if (! $this->visibilityConditionValid($branch)) {
                        return false;
                    }
                }

                return true;
            }
        }

        $signal = $condition['signal'] ?? null;
        $operator = $condition['operator'] ?? null;
        if (! in_array($signal, VisibilitySignal::ALL, true) || ! in_array($operator, VisibilityOperator::ALL, true)) {
            return false;
        }

        $hasValue = array_key_exists('value', $condition);
        if (in_array($operator, VisibilityOperator::NO_VALUE, true)) {
            return ! $hasValue;
        }
        if (in_array($operator, VisibilityOperator::LIST_VALUE, true)) {
            return $hasValue && is_array($condition['value']) && $condition['value'] !== [];
        }

        return $hasValue && ! is_array($condition['value']);
    }
}
