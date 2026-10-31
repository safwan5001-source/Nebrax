<?php

namespace App\Services\AppBuilder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  فاحصة عقد المكوّنات — AD-12 (S02، فرض مرحلي)
 * ═══════════════════════════════════════════════════════════════
 *
 * طبقة فوق `AppSchemaParser` (الذي يطابق محلّل Dart بنيوياً) ومستقلة عنه عمداً: الأخير مرآة حرفية لا يُضاف إليه
 * ما لا يفعله Flutter. هنا قواعد **سجلّ المكوّنات والإجراءات** (`PropDefinition`/`ActionParamDefinition`/`ChildrenRule`):
 *
 *  - **حدود صارمة عند الحفظ** (`assertHardLimits`): فرادة `component.id` داخل الصفحة الواحدة، وسقف بايتات المخطط.
 *    آمنة: لا تُحدث مخططاً غير قابل للعرض، وتحمي الخادم من حمولة ضخمة.
 *  - **فحص العقد** (`check`): قائمة `ContractIssue`؛ `error` يمنع النشر، `warning` لا يمنعه. عند الحفظ تُعرض كلها
 *    ولا تمنع الحفظ (تحذير)؛ عند النشر/الفحص تمنع الأخطاء (`blocking`).
 *
 * لا تعدّل هذه الفاحصة المخطط ولا تقرأ خارجه (لا استعلام، لا مستأجر): دالة نقية قابلة للاختبار.
 * `$item.*` (مرجع الربط) يُقبل في أي خاصية/معامل نصي لأن قيمته تُحلّ وقت التشغيل.
 */
final class AppSchemaContractChecker
{
    /** سقف حجم المخطط بالبايت (JSON). قابل للضبط عبر `config('app_builder.max_schema_bytes')`. */
    public const DEFAULT_MAX_SCHEMA_BYTES = 262144;

    /**
     * @param  array<string, mixed>  $schema
     *
     * @throws SchemaFormatException `schema_too_large` | `duplicate_id`
     */
    public function assertHardLimits(array $schema): void
    {
        $max = (int) config('app_builder.max_schema_bytes', self::DEFAULT_MAX_SCHEMA_BYTES);
        $bytes = strlen((string) json_encode($schema, JSON_UNESCAPED_UNICODE));
        if ($bytes > $max) {
            throw new SchemaFormatException('schema_too_large', sprintf('حجم المخطط %d بايت يتجاوز الحد المسموح (%d بايت).', $bytes, $max));
        }

        foreach (($schema['pages'] ?? []) as $pageId => $root) {
            $seen = [];
            $this->collectIds($root, $seen, (string) $pageId);
        }
    }

    /**
     * @param  array<string, mixed>  $schema
     * @return list<ContractIssue>
     */
    public function check(array $schema): array
    {
        $pages = is_array($schema['pages'] ?? null) ? $schema['pages'] : [];
        $pageIds = array_map('strval', array_keys($pages));
        $issues = [];
        $idPages = [];

        foreach ($pages as $pageId => $root) {
            $pageId = (string) $pageId;
            if (is_array($root)) {
                $this->walk($root, null, $pageId, $pageIds, $idPages, $issues);
            }
        }

        foreach ($idPages as $id => $where) {
            if (count(array_unique($where)) > 1) {
                $issues[] = new ContractIssue(
                    'duplicate_id_across_pages', ContractIssue::WARNING, $where[0], (string) $id, 'id',
                    "المعرّف \"{$id}\" مستعمل في أكثر من صفحة؛ يُفضَّل معرّف فريد لكل عقدة.",
                );
            }
        }

        return $issues;
    }

    /**
     * @param  list<ContractIssue>  $issues
     * @return list<ContractIssue> المخالفات التي تمنع النشر وحدها.
     */
    public static function blocking(array $issues): array
    {
        return array_values(array_filter($issues, fn (ContractIssue $i) => $i->blocksPublish()));
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  array<string, true>  $seen
     */
    private function collectIds(array $node, array &$seen, string $pageId): void
    {
        $id = (string) ($node['id'] ?? '');
        if ($id !== '') {
            if (isset($seen[$id])) {
                throw new SchemaFormatException('duplicate_id', "المعرّف \"{$id}\" مكرَّر داخل الصفحة \"{$pageId}\"؛ لكل مكوّن في الصفحة معرّف فريد.");
            }
            $seen[$id] = true;
        }
        foreach (($node['children'] ?? []) as $child) {
            if (is_array($child)) {
                $this->collectIds($child, $seen, $pageId);
            }
        }
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  list<string>  $pageIds
     * @param  array<string, list<string>>  $idPages
     * @param  list<ContractIssue>  $issues
     */
    private function walk(array $node, ?string $parentType, string $pageId, array $pageIds, array &$idPages, array &$issues): void
    {
        $type = (string) ($node['type'] ?? '');
        $id = (string) ($node['id'] ?? '');
        $definitions = ComponentRegistry::definitions();
        $definition = $definitions[$type] ?? null;

        if ($id !== '') {
            $idPages[$id][] = $pageId;
        }

        // نوع/إجراء مجهول: العقدة (وشجرتها كلها) من عمل `CompatibilityResolver` — إن كانت اختيارية فهي وحدة إسقاط آمنة
        // يتجاوزها التطبيق، فلا تُحجب بها مسودة كانت قابلة للنشر (مراجعة Codex). الفحص هنا لما سيُعرض فعلاً.
        $action = is_array($node['action'] ?? null) ? $node['action'] : null;
        $unsupportedAction = $action !== null && ! isset(ActionRegistry::definitions()[(string) ($action['type'] ?? '')]);
        if ($definition === null || $unsupportedAction) {
            return;
        }

        if ($parentType !== null) {
            if ($type === 'Page') {
                $issues[] = new ContractIssue('page_not_root', ContractIssue::ERROR, $pageId, $id, null, 'الصفحة لا تُضمَّن داخل مكوّن آخر؛ هي جذر الصفحة فقط.');
            } elseif ($definition !== null && ! in_array($parentType, ComponentRegistry::allowedParentTypes($type), true)) {
                $issues[] = new ContractIssue('child_not_allowed', ContractIssue::ERROR, $pageId, $id, null, "المكوّن \"{$type}\" لا يُضمَّن داخل \"{$parentType}\".");
            }
        }

        $children = $node['children'] ?? [];
        if (is_array($children) && $children !== [] && ComponentRegistry::allowedChildTypes($type) === []) {
            $issues[] = new ContractIssue('children_not_allowed', ContractIssue::ERROR, $pageId, $id, 'children', "المكوّن \"{$type}\" لا يقبل أبناء.");
        }

        $this->checkProps($node, $definition, $pageId, $id, $issues);

        if (($node['action'] ?? null) !== null && is_array($node['action'])) {
            $this->checkAction($node, $definition, $pageId, $id, $pageIds, $issues);
        }

        $this->walkChildren($node, $type, $pageId, $pageIds, $idPages, $issues);
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  list<string>  $pageIds
     * @param  array<string, list<string>>  $idPages
     * @param  list<ContractIssue>  $issues
     */
    private function walkChildren(array $node, string $type, string $pageId, array $pageIds, array &$idPages, array &$issues): void
    {
        foreach (($node['children'] ?? []) as $child) {
            if (is_array($child)) {
                $this->walk($child, $type, $pageId, $pageIds, $idPages, $issues);
            }
        }
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  list<ContractIssue>  $issues
     */
    private function checkProps(array $node, ComponentDefinition $definition, string $pageId, string $id, array &$issues): void
    {
        $props = is_array($node['props'] ?? null) ? $node['props'] : [];
        $bound = is_array($node['binding']['itemProps'] ?? null) ? array_keys($node['binding']['itemProps']) : [];
        $known = [];
        foreach ($definition->props as $prop) {
            $known[$prop->key] = $prop;
        }

        foreach ($props as $key => $value) {
            $key = (string) $key;
            if (! isset($known[$key])) {
                $issues[] = new ContractIssue('unknown_prop', ContractIssue::WARNING, $pageId, $id, $key, "الخاصية \"{$key}\" غير معرّفة للمكوّن \"{$definition->type}\" وسيتجاهلها التطبيق.");

                continue;
            }
            $prop = $known[$key];
            if ($this->isBindingRef($value)) {
                continue;
            }
            if (! $this->valueMatches($prop->type, $value)) {
                $issues[] = new ContractIssue('prop_type_mismatch', ContractIssue::ERROR, $pageId, $id, $key, "قيمة الخاصية \"{$key}\" ليست من النوع المتوقع ({$prop->type}).");
            } elseif ($prop->enumValues !== null && ! in_array($value, $prop->enumValues, true)) {
                $issues[] = new ContractIssue('prop_enum_invalid', ContractIssue::ERROR, $pageId, $id, $key, "قيمة الخاصية \"{$key}\" يجب أن تكون إحدى: ".implode('، ', $prop->enumValues).'.');
            }
        }

        foreach ($known as $key => $prop) {
            if ($prop->required && $prop->default === null && ! array_key_exists($key, $props) && ! in_array($key, $bound, true)) {
                $issues[] = new ContractIssue('missing_required_prop', ContractIssue::WARNING, $pageId, $id, $key, "الخاصية المطلوبة \"{$key}\" غائبة عن المكوّن \"{$definition->type}\".");
            }
        }
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  list<string>  $pageIds
     * @param  list<ContractIssue>  $issues
     */
    private function checkAction(array $node, ComponentDefinition $definition, string $pageId, string $id, array $pageIds, array &$issues): void
    {
        $action = $node['action'];
        $actionType = (string) ($action['type'] ?? '');
        $actionDefinition = ActionRegistry::definitions()[$actionType] ?? null;

        if (! $definition->actionable) {
            $issues[] = new ContractIssue('action_not_supported', ContractIssue::WARNING, $pageId, $id, 'action', "المكوّن \"{$definition->type}\" لا ينفّذ إجراءات؛ سيُتجاهل الإجراء.");
        }
        if ($actionDefinition === null) {
            return; // نوع الإجراء المجهول عمل CompatibilityResolver
        }

        $params = is_array($action['params'] ?? null) ? $action['params'] : [];
        $known = [];
        foreach ($actionDefinition->params as $param) {
            $known[$param->key] = $param;
        }

        foreach ($params as $key => $value) {
            $key = (string) $key;
            if (! isset($known[$key])) {
                $issues[] = new ContractIssue('unknown_action_param', ContractIssue::WARNING, $pageId, $id, "action.params.{$key}", "المعامل \"{$key}\" غير معرّف للإجراء \"{$actionType}\".");

                continue;
            }
            $param = $known[$key];
            if ($value === null && $param->nullable) {
                continue;
            }
            if ($this->isBindingRef($value)) {
                continue;
            }
            $ok = match ($param->type) {
                PropType::INTEGER => $this->isInteger($value) && ($param->minValue === null || (int) $value >= $param->minValue),
                // المطلوب نصٌّ غير فارغ؛ الاختياري (مثل `variantId` الذي يتركه المحرر "" بعد المسح) يقبله Runtime فارغاً.
                default => is_string($value) && ($value !== '' || ! $param->required),
            };
            if (! $ok) {
                $issues[] = new ContractIssue('action_param_invalid', ContractIssue::ERROR, $pageId, $id, "action.params.{$key}", "قيمة المعامل \"{$key}\" للإجراء \"{$actionType}\" غير صالحة.");
            }
        }

        foreach ($known as $key => $param) {
            if ($param->required && ! array_key_exists($key, $params) && ! in_array($key, $definition->injectedRuntimeActionParams, true)) {
                $issues[] = new ContractIssue('missing_action_param', ContractIssue::ERROR, $pageId, $id, "action.params.{$key}", "المعامل المطلوب \"{$key}\" غائب عن الإجراء \"{$actionType}\".");
            }
        }

        if ($actionType === 'navigate' && is_string($params['pageId'] ?? null) && ! $this->isBindingRef($params['pageId'])
            && $params['pageId'] !== '' && ! in_array($params['pageId'], $pageIds, true)) {
            $issues[] = new ContractIssue('navigate_target_missing', ContractIssue::ERROR, $pageId, $id, 'action.params.pageId', 'وجهة الانتقال تشير إلى صفحة غير موجودة في التطبيق.');
        }
    }

    private function isBindingRef(mixed $value): bool
    {
        return is_string($value) && str_starts_with($value, '$item.');
    }

    private function isInteger(mixed $value): bool
    {
        return is_int($value) || (is_float($value) && floor($value) === $value && is_finite($value));
    }

    private function valueMatches(string $type, mixed $value): bool
    {
        return match ($type) {
            PropType::STRING, PropType::ASSET_URL => is_string($value),
            PropType::INTEGER, PropType::AMOUNT_MINOR => $this->isInteger($value),
            PropType::STRING_LIST => is_array($value) && array_is_list($value) && array_reduce($value, fn ($ok, $v) => $ok && is_string($v), true),
            default => true,
        };
    }
}
