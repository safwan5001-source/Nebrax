<?php

namespace App\Services\AppBuilder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تحقّق بنيوي كامل من App Schema — مطابقٌ حرفياً لـ
 *  mobile/lib/schema/app_schema.dart (`AppSchema._fromJson`)
 * ═══════════════════════════════════════════════════════════════
 *
 * APP-BUILDER-2: لا يتحقق هذا الصنف من «شكل سطحي» فقط (ذاك كان نطاق
 * APP-BUILDER-1's `AppSchemaStructuralValidator` المؤقت) — يعيد تنفيذ نفس
 * قواعد محلّل Flutter عقدة عقدة: مفاتيح معروفة فقط في كل مستوى، أنواع أساسية
 * صارمة، حدود حجم/عمق مطابقة، ومرجعية `navigation.initialPageId` لصفحة
 * معرَّفة فعلاً. **لا يتحقق من هوية المكوّن/الإجراء نفسها** (هل `type` ضمن
 * سجلّ حقيقي) — ذلك عمل `CompatibilityResolver` (يقارن بمِرآة بناء تشغيل
 * فعلي)، تماماً كما يفصلهما Dart (`AppSchemaParser` هنا يوازي
 * `AppSchema._fromJson`، لا `CompatibilityResolver`).
 *
 * سلطة التحقق الوحيدة قبل الحفظ (Authoring) وقبل النشر (Publish، إلى جانب
 * `CompatibilityResolver` هناك حصراً) — `BuilderDraftExperienceService::save()`
 * و`BuilderPublishedExperienceVersionService::publish()` كلاهما يستدعيانها.
 */
final class AppSchemaParser
{
    private const MAX_COMPONENT_TREE_DEPTH = 32;

    private const MAX_COMPONENT_NODE_COUNT = 500;

    private const MAX_PROPS_NESTING_DEPTH = 8;

    private const MAX_PROPS_COLLECTION_LENGTH = 64;

    private const TOP_LEVEL_KEYS = [
        'schemaVersion', 'minRuntimeVersion', 'requiredCapabilities', 'theme', 'navigation', 'pages',
    ];

    private const COMPONENT_KEYS = ['type', 'id', 'optional', 'props', 'children', 'action', 'binding', 'visibility'];

    private const ACTION_KEYS = ['type', 'params'];

    private const BINDING_KEYS = ['resource', 'query', 'itemProps', 'collect'];

    private const CONDITION_LEAF_KEYS = ['signal', 'operator', 'value'];

    private const MAX_CONDITION_DEPTH = 4;

    private const MAX_CONDITION_BRANCHES = 16;

    private const THEME_KEYS = ['tokens'];

    private const NAVIGATION_KEYS = ['initialPageId'];

    /**
     * @param  array<string, mixed>  $schema
     *
     * @throws SchemaFormatException مخطط غير صالح بنيوياً.
     */
    public function validate(array $schema): void
    {
        $this->rejectUnknownKeys($schema, self::TOP_LEVEL_KEYS, 'schema');

        $this->parseVersion($schema['schemaVersion'] ?? null, 'schemaVersion');
        $this->parseVersion($schema['minRuntimeVersion'] ?? null, 'minRuntimeVersion');

        $this->validateRequiredCapabilities($schema['requiredCapabilities'] ?? null);
        $this->validateTheme($schema['theme'] ?? null);

        $navigation = $schema['navigation'] ?? null;
        if (! $this->isObjectLike($navigation)) {
            throw new SchemaFormatException('missing_field', 'navigation is required');
        }
        $this->rejectUnknownKeys($navigation, self::NAVIGATION_KEYS, 'navigation');
        $initialPageId = $navigation['initialPageId'] ?? null;
        if (! is_string($initialPageId) || $initialPageId === '') {
            throw new SchemaFormatException('missing_field', 'navigation.initialPageId is required');
        }

        $pages = $schema['pages'] ?? null;
        if (! $this->isObjectLike($pages) || $pages === []) {
            throw new SchemaFormatException('missing_field', 'pages must be a non-empty object');
        }
        $budget = new SchemaParseBudget(self::MAX_COMPONENT_NODE_COUNT);
        foreach ($pages as $pageId => $root) {
            // ملاحظة PHP: json_decode يحوّل مفتاح كائن رقمياً بالكامل مثل "123"
            // إلى مفتاح مصفوفة int — بخلاف Dart's Map<String,dynamic> الذي
            // يحفظ النوع النصي دوماً. لا فحص `is_string` هنا إذاً: القيمة
            // نفسها معرّف صفحة صالح دوماً أياً كان تمثيلها الداخلي في PHP،
            // و`array_key_exists()` أدناه يقارن بتكافؤ int/string القياسي.
            $pageId = (string) $pageId;
            if (! $this->isObjectLike($root)) {
                throw new SchemaFormatException('invalid_type', "page \"{$pageId}\" must be an object");
            }
            $this->validateComponent($root, $budget, 0, $pageId);
            if ($root['type'] !== 'Page') {
                throw new SchemaFormatException(
                    'invalid_type',
                    "page \"{$pageId}\" root component must have type \"Page\", got \"{$root['type']}\"",
                );
            }
        }

        if (! array_key_exists($initialPageId, $pages)) {
            throw new SchemaFormatException(
                'missing_field',
                "navigation.initialPageId \"{$initialPageId}\" does not reference a declared page",
            );
        }
    }

    private function parseVersion(mixed $raw, string $field): SchemaVersion
    {
        if (! is_string($raw)) {
            throw new SchemaFormatException('missing_field', "{$field} is required");
        }
        $version = SchemaVersion::tryParse($raw);
        if ($version === null) {
            throw new SchemaFormatException('invalid_version', "{$field} is not a valid x.y.z version");
        }

        return $version;
    }

    private function validateRequiredCapabilities(mixed $raw): void
    {
        if ($raw === null) {
            return;
        }
        if (! $this->isObjectLike($raw)) {
            throw new SchemaFormatException('invalid_type', 'requiredCapabilities must be an object');
        }
        foreach ($raw as $key => $value) {
            if (! is_string($key) || ! is_int($value) || $value < 1) {
                throw new SchemaFormatException(
                    'invalid_type',
                    'requiredCapabilities entries must be string:positive-int',
                );
            }
        }
    }

    private function validateTheme(mixed $raw): void
    {
        if ($raw === null) {
            return;
        }
        if (! $this->isObjectLike($raw)) {
            throw new SchemaFormatException('invalid_type', 'theme must be an object');
        }
        $this->rejectUnknownKeys($raw, self::THEME_KEYS, 'theme');

        $tokens = $raw['tokens'] ?? null;
        if ($tokens === null) {
            return;
        }
        if (! $this->isObjectLike($tokens)) {
            throw new SchemaFormatException('invalid_type', 'theme.tokens must be an object');
        }
        foreach ($tokens as $key => $value) {
            if (! is_string($key) || ! is_string($value)) {
                throw new SchemaFormatException('invalid_type', 'theme.tokens entries must be string:string');
            }
        }
    }

    private function validateComponent(array $json, SchemaParseBudget $budget, int $depth, string $context): void
    {
        $budget->consumeNode();
        if ($depth > self::MAX_COMPONENT_TREE_DEPTH) {
            throw new SchemaFormatException(
                'too_deep',
                'component tree exceeds max depth (' . self::MAX_COMPONENT_TREE_DEPTH . ')',
            );
        }
        $this->rejectUnknownKeys($json, self::COMPONENT_KEYS, 'component');

        $type = $json['type'] ?? null;
        if (! is_string($type) || $type === '') {
            throw new SchemaFormatException('invalid_type', 'component.type must be a non-empty string');
        }
        $id = $json['id'] ?? null;
        if (! is_string($id) || $id === '') {
            throw new SchemaFormatException('missing_field', 'component.id is required');
        }
        $optional = $json['optional'] ?? null;
        if ($optional !== null && ! is_bool($optional)) {
            throw new SchemaFormatException('invalid_type', 'component.optional must be a boolean');
        }
        $props = $json['props'] ?? null;
        if ($props !== null && ! $this->isObjectLike($props)) {
            throw new SchemaFormatException('invalid_type', 'component.props must be an object');
        }
        $this->validateJsonSafeMap($props, 'component.props');

        $children = $json['children'] ?? null;
        if ($children !== null) {
            if (! is_array($children) || ! array_is_list($children)) {
                throw new SchemaFormatException('invalid_type', 'component.children must be a list');
            }
            foreach ($children as $child) {
                if (! $this->isObjectLike($child)) {
                    throw new SchemaFormatException('invalid_type', 'component.children entries must be objects');
                }
                $this->validateComponent($child, $budget, $depth + 1, $context);
            }
        }

        $action = $json['action'] ?? null;
        if ($action !== null) {
            if (! $this->isObjectLike($action)) {
                throw new SchemaFormatException('invalid_type', 'component.action must be an object');
            }
            $this->validateActionRef($action);
        }

        $binding = $json['binding'] ?? null;
        if ($binding !== null) {
            if (! $this->isObjectLike($binding)) {
                throw new SchemaFormatException('invalid_type', 'component.binding must be an object');
            }
            $this->validateBinding($binding);
        }

        $visibility = $json['visibility'] ?? null;
        if ($visibility !== null) {
            if (! $this->isObjectLike($visibility)) {
                throw new SchemaFormatException('invalid_type', 'component.visibility must be an object');
            }
            $this->validateVisibility($visibility, 0);
        }
    }

    /**
     * تحقّق بنيوي بحت من شجرة `visibility` — شكل ثلاثي مغلق: `{all:[...]}`،
     * `{any:[...]}`، أو ورقة `{signal, operator, value?}`. لا يتحقق من صحة
     * `signal`/`operator` نفسيهما ولا من توافق نوع `value` مع المُشغّل (ذلك
     * `CompatibilityResolver` وقت النشر، تماماً كتمييز هوية المكوّن/الإجراء/
     * المورد) — فقط الشكل والحدود (عمق، عدد فروع) بلا أي تعبير قابل للتنفيذ.
     */
    private function validateVisibility(array $json, int $depth): void
    {
        if ($depth > self::MAX_CONDITION_DEPTH) {
            throw new SchemaFormatException('too_deep', 'visibility nesting too deep');
        }

        if (array_key_exists('all', $json) || array_key_exists('any', $json)) {
            $combinator = array_key_exists('all', $json) ? 'all' : 'any';
            $this->rejectUnknownKeys($json, [$combinator], 'visibility');
            $branches = $json[$combinator];
            if (! is_array($branches) || ! array_is_list($branches) || $branches === []) {
                throw new SchemaFormatException('invalid_type', "visibility.{$combinator} must be a non-empty list");
            }
            if (count($branches) > self::MAX_CONDITION_BRANCHES) {
                throw new SchemaFormatException('too_many_nodes', "visibility.{$combinator} has too many entries");
            }
            foreach ($branches as $branch) {
                if (! $this->isObjectLike($branch)) {
                    throw new SchemaFormatException('invalid_type', "visibility.{$combinator} entries must be objects");
                }
                $this->validateVisibility($branch, $depth + 1);
            }

            return;
        }

        if (array_key_exists('signal', $json)) {
            $this->rejectUnknownKeys($json, self::CONDITION_LEAF_KEYS, 'visibility');

            $signal = $json['signal'] ?? null;
            if (! is_string($signal) || $signal === '') {
                throw new SchemaFormatException('missing_field', 'visibility.signal must be a non-empty string');
            }
            $operator = $json['operator'] ?? null;
            if (! is_string($operator) || $operator === '') {
                throw new SchemaFormatException('missing_field', 'visibility.operator must be a non-empty string');
            }
            if (array_key_exists('value', $json)) {
                $this->validateVisibilityValue($json['value']);
            }

            return;
        }

        throw new SchemaFormatException('missing_field', 'visibility must declare exactly one of: all, any, signal');
    }

    /** `value` سكالر JSON آمن، أو قائمة مسطّحة من سكالرات (لِـ`in`) — أبداً كائن متداخل. */
    private function validateVisibilityValue(mixed $value): void
    {
        if ($value === null || is_string($value) || is_int($value) || is_float($value) || is_bool($value)) {
            return;
        }
        if (is_array($value) && array_is_list($value)) {
            if (count($value) > self::MAX_PROPS_COLLECTION_LENGTH) {
                throw new SchemaFormatException('too_many_nodes', 'visibility.value list too long');
            }
            foreach ($value as $item) {
                if (! (is_string($item) || is_int($item) || is_float($item) || is_bool($item))) {
                    throw new SchemaFormatException('invalid_type', 'visibility.value list entries must be scalars');
                }
            }

            return;
        }
        throw new SchemaFormatException('invalid_type', 'visibility.value must be a scalar or a flat list of scalars');
    }

    /**
     * تحقّق بنيوي بحت من شكل `binding` — لا يتحقق من هوية المورد نفسها ولا من
     * صحة أسماء حقوله (ذلك عمل `CompatibilityResolver` وقت النشر، تماماً
     * كتمييز هوية المكوّن/الإجراء أعلاه). القيمة المسموحة الوحيدة: كائن JSON
     * آمن — لا تعبير، لا استعلام SQL، لا رابط HTTP حرّ (`ADR-01`).
     *
     * **`collect`** (`APP-BUILDER-17` slice 3): مفتاح اختياري إضافي — مسار
     * منقوط (نفس اصطلاح `itemProps`) إلى حقل **من نوع `LIST`** على المورد
     * المحلول تُكرَّر عليه شجرة ابن العقدة الوحيد قالباً واحداً لكل عنصر. تحقّق
     * بنيوي فقط هنا (نص غير فارغ) — صحة الحقل واسمه ونوعه ضد
     * `DataResourceRegistry`، ووجود ابن واحد بالضبط، من عمل `CompatibilityResolver`
     * وقت النشر، تماماً كبقية مفاتيح `binding`.
     */
    private function validateBinding(array $json): void
    {
        $this->rejectUnknownKeys($json, self::BINDING_KEYS, 'binding');

        $resource = $json['resource'] ?? null;
        if (! is_string($resource) || $resource === '') {
            throw new SchemaFormatException('missing_field', 'binding.resource must be a non-empty string');
        }

        $query = $json['query'] ?? null;
        if ($query !== null) {
            if (! $this->isObjectLike($query)) {
                throw new SchemaFormatException('invalid_type', 'binding.query must be an object');
            }
            $this->validateJsonSafeMap($query, 'binding.query');
        }

        $itemProps = $json['itemProps'] ?? null;
        if ($itemProps !== null) {
            if (! $this->isObjectLike($itemProps)) {
                throw new SchemaFormatException('invalid_type', 'binding.itemProps must be an object');
            }
            foreach ($itemProps as $propKey => $fieldPath) {
                if (! is_string($propKey) || $propKey === '' || ! is_string($fieldPath) || $fieldPath === '') {
                    throw new SchemaFormatException('invalid_type', 'binding.itemProps entries must be non-empty string:string');
                }
            }
        }

        $collect = $json['collect'] ?? null;
        if ($collect !== null && (! is_string($collect) || $collect === '')) {
            throw new SchemaFormatException('invalid_type', 'binding.collect must be a non-empty string');
        }
    }

    private function validateActionRef(array $json): void
    {
        $this->rejectUnknownKeys($json, self::ACTION_KEYS, 'action');

        $type = $json['type'] ?? null;
        if (! is_string($type) || $type === '') {
            throw new SchemaFormatException('invalid_type', 'action.type must be a non-empty string');
        }
        $params = $json['params'] ?? null;
        if ($params !== null && ! $this->isObjectLike($params)) {
            throw new SchemaFormatException('invalid_type', 'action.params must be an object');
        }
        $this->validateJsonSafeMap($params, 'action.params');
    }

    /**
     * تحقّق تكراري بأن قيمة JSON مُفكَّكة تحتوي فقط سكالر/مجموعات آمنة، ضمن
     * حجم/عمق محدود — الطبقة التي تجعل «لا كود قابل للتنفيذ... لا تعابير
     * عن بُعد بدلالة برمجية عامة» (معمارية App Builder، مرجع MR-04) حقيقةً
     * بنيوية: أي شيء غير قيمة JSON لا ينجو من فكّ الترميز أصلاً، وهذا المرور
     * يحدّ الحجم إضافياً.
     */
    private function validateJsonSafeMap(mixed $raw, string $context, int $depth = 0): void
    {
        if ($raw === null) {
            return;
        }
        if ($depth > self::MAX_PROPS_NESTING_DEPTH) {
            throw new SchemaFormatException('too_deep', "{$context} nesting too deep");
        }
        if (count($raw) > self::MAX_PROPS_COLLECTION_LENGTH) {
            throw new SchemaFormatException('too_many_nodes', "{$context} has too many entries");
        }
        foreach ($raw as $key => $value) {
            $this->validateJsonSafeValue($value, "{$context}.{$key}", $depth);
        }
    }

    private function validateJsonSafeValue(mixed $value, string $context, int $depth = 0): void
    {
        if ($value === null || is_string($value) || is_int($value) || is_float($value) || is_bool($value)) {
            return;
        }
        if (is_array($value) && array_is_list($value)) {
            if ($depth > self::MAX_PROPS_NESTING_DEPTH) {
                throw new SchemaFormatException('too_deep', "{$context} nesting too deep");
            }
            if (count($value) > self::MAX_PROPS_COLLECTION_LENGTH) {
                throw new SchemaFormatException('too_many_nodes', "{$context} list too long");
            }
            foreach ($value as $item) {
                $this->validateJsonSafeValue($item, "{$context}[]", $depth + 1);
            }

            return;
        }
        if (is_array($value)) {
            $this->validateJsonSafeMap($value, $context, $depth + 1);

            return;
        }
        throw new SchemaFormatException('invalid_type', "{$context} has an unsupported value type");
    }

    /** @param array<int, string> $allowed */
    private function rejectUnknownKeys(array $json, array $allowed, string $context): void
    {
        foreach (array_keys($json) as $key) {
            if (! is_string($key) || ! in_array($key, $allowed, true)) {
                throw new SchemaFormatException('unknown_field', "unknown field \"{$key}\" in {$context}");
            }
        }
    }

    /** يميّز «كائن JSON» (خرائطي) عن «قائمة JSON» بعد فكّ الترميز إلى مصفوفة PHP. */
    private function isObjectLike(mixed $value): bool
    {
        return is_array($value) && ($value === [] || ! array_is_list($value));
    }
}
