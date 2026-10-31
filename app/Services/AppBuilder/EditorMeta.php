<?php

namespace App\Services\AppBuilder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  بيانات المحرر (AD-05 / S20a) — مستقلة عن المخطط المنشور
 * ═══════════════════════════════════════════════════════════════
 *
 * شكل v1 (JSON، `builder_draft_experiences.editor_meta`):
 *
 *   { "v": 1,
 *     "nodes": { "<pageId>": { "<nodeId>": { "name"?: string 1..80, "hidden"?: true, "preset"?: string } } },
 *     "pages": { "<pageId>": { "title"?: string 1..80 } } }
 *
 * - **العقد مقيَّدة بصفحتها:** فرادة `component.id` مفروضة داخل الصفحة وحدها (تكرارها عبر صفحات مسموح)، فمفتاح الإخفاء
 *   `(pageId, nodeId)` لا `nodeId` وحده — وإلا أخفى إخفاءُ عقدة في صفحة عقدةً تحمل معرّفها في صفحة أخرى.

 * - **لا يدخل ما يُنشر أو يُعاين:** `project()` يُسقط العقد المخفية من المخطط، فالنسخة المنشورة وجلسات المعاينة وفاحصة العقد
 *   كلها ترى الناتج بلا المخفي؛ المخفي يبقى في المسودة وحدها ويُظهره المحرر. أسماء الأقسام وعناوين الصفحات لا تغادر المسودة.
 * - **`normalize()` يتحقق ثم ينظّف:** الشكل والأنواع والأطوال والحجم صارمة (ترفض 422 برمز)، وإدخالات العقد/الصفحات التي لم تعد
 *   موجودة في المخطط المحفوظ **تُنظَّف** (حذف عقدة في المحرر لا يُفشل الحفظ التالي). جذر الصفحة لا يُخفى أبداً.
 * - دالة نقية (لا قاعدة بيانات ولا مستأجر).
 */
final class EditorMeta
{
    public const VERSION = 1;

    public const DEFAULT_MAX_BYTES = 65536;

    private const MAX_ENTRIES = 2000;

    private const MAX_TEXT = 80;

    private const NODE_KEYS = ['name', 'hidden', 'preset'];

    private const PAGE_KEYS = ['title'];

    /**
     * @param  array<string, mixed>|null  $meta
     * @param  array<string, mixed>  $schema  المخطط المحفوظ (مرجع المعرّفات الموجودة)
     * @return array<string, mixed>|null  البيانات المنظَّفة، أو null إن لم يبق شيء
     *
     * @throws SchemaFormatException
     */
    public function normalize(?array $meta, array $schema): ?array
    {
        if ($meta === null || $meta === []) {
            return null;
        }

        $max = (int) config('app_builder.max_editor_meta_bytes', self::DEFAULT_MAX_BYTES);
        if (strlen((string) json_encode($meta, JSON_UNESCAPED_UNICODE)) > $max) {
            throw new SchemaFormatException('editor_meta_too_large', "بيانات المحرر تتجاوز الحد المسموح ({$max} بايت).");
        }
        $unknown = array_diff(array_keys($meta), ['v', 'nodes', 'pages']);
        if ($unknown !== []) {
            throw new SchemaFormatException('editor_meta_invalid', 'مفتاح غير معروف في بيانات المحرر: '.implode('، ', array_map('strval', $unknown)).'.');
        }
        if (array_key_exists('v', $meta) && $meta['v'] !== self::VERSION) {
            throw new SchemaFormatException('editor_meta_invalid', 'إصدار بيانات المحرر غير مدعوم.');
        }

        $pages = is_array($schema['pages'] ?? null) ? $schema['pages'] : [];
        $roots = [];
        $nodeIds = [];
        foreach ($pages as $pageId => $root) {
            if (is_array($root)) {
                $roots[(string) $pageId] = (string) ($root['id'] ?? '');
                $ids = [];
                $this->collectIds($root, $ids);
                $nodeIds[(string) $pageId] = $ids;
            }
        }

        $nodesByPage = $this->entries($meta['nodes'] ?? [], 'nodes');
        $pagesMeta = $this->entries($meta['pages'] ?? [], 'pages');
        $total = count($pagesMeta);
        foreach ($nodesByPage as $pageId => $perPage) {
            $total += count($this->entries($perPage, "nodes.{$pageId}"));
        }
        if ($total > self::MAX_ENTRIES) {
            throw new SchemaFormatException('editor_meta_too_large', 'عدد إدخالات بيانات المحرر يتجاوز الحد.');
        }

        $outNodes = [];
        foreach ($nodesByPage as $pageId => $perPage) {
            $pageId = (string) $pageId;
            $kept = [];
            foreach ($this->entries($perPage, "nodes.{$pageId}") as $id => $entry) {
                $clean = $this->cleanEntry($entry, self::NODE_KEYS, "nodes.{$pageId}.{$id}");
                if (($clean['hidden'] ?? false) === true && ($roots[$pageId] ?? null) === (string) $id) {
                    throw new SchemaFormatException('editor_meta_hidden_root', 'لا يمكن إخفاء جذر الصفحة.');
                }
                if ($clean !== [] && isset($nodeIds[$pageId][(string) $id])) {
                    $kept[(string) $id] = $clean;
                }
            }
            if ($kept !== []) {
                $outNodes[$pageId] = $kept;
            }
        }
        $outPages = [];
        foreach ($pagesMeta as $id => $entry) {
            $clean = $this->cleanEntry($entry, self::PAGE_KEYS, "pages.{$id}");
            if ($clean !== [] && array_key_exists($id, $pages)) {
                $outPages[$id] = $clean;
            }
        }

        if ($outNodes === [] && $outPages === []) {
            return null;
        }

        return ['v' => self::VERSION, 'nodes' => $outNodes, 'pages' => $outPages];
    }

    /**
     * المخطط كما يُنشر/يُعاين: بلا العقد المخفية (وأبنائها). لا يُحوِّر المدخل.
     *
     * @param  array<string, mixed>  $schema
     * @param  array<string, mixed>|null  $meta
     * @return array<string, mixed>
     */
    public function project(array $schema, ?array $meta): array
    {
        $hiddenByPage = [];
        foreach (($meta['nodes'] ?? []) as $pageId => $perPage) {
            foreach ((is_array($perPage) ? $perPage : []) as $id => $entry) {
                if (is_array($entry) && ($entry['hidden'] ?? false) === true) {
                    $hiddenByPage[(string) $pageId][(string) $id] = true;
                }
            }
        }
        if ($hiddenByPage === [] || ! is_array($schema['pages'] ?? null)) {
            return $schema;
        }

        foreach ($schema['pages'] as $pageId => $root) {
            if (is_array($root) && isset($hiddenByPage[(string) $pageId])) {
                $schema['pages'][$pageId] = $this->prune($root, $hiddenByPage[(string) $pageId]);
            }
        }

        return $schema;
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  array<string, true>  $hidden
     * @return array<string, mixed>
     */
    private function prune(array $node, array $hidden): array
    {
        if (! is_array($node['children'] ?? null)) {
            return $node;
        }
        $kept = [];
        foreach ($node['children'] as $child) {
            if (! is_array($child) || isset($hidden[(string) ($child['id'] ?? '')])) {
                continue;
            }
            $kept[] = $this->prune($child, $hidden);
        }
        $node['children'] = $kept;

        return $node;
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  array<string, true>  $ids
     */
    private function collectIds(array $node, array &$ids): void
    {
        $id = (string) ($node['id'] ?? '');
        if ($id !== '') {
            $ids[$id] = true;
        }
        foreach (($node['children'] ?? []) as $child) {
            if (is_array($child)) {
                $this->collectIds($child, $ids);
            }
        }
    }

    /** @return array<string, mixed> */
    private function entries(mixed $raw, string $field): array
    {
        if ($raw === null || $raw === []) {
            return [];
        }
        if (! is_array($raw) || array_is_list($raw)) {
            throw new SchemaFormatException('editor_meta_invalid', "الحقل {$field} في بيانات المحرر يجب أن يكون كائناً.");
        }
        foreach (array_keys($raw) as $id) {
            $id = (string) $id;
            if ($id === '' || strlen($id) > 128) {
                throw new SchemaFormatException('editor_meta_invalid', "معرّف غير صالح في {$field}.");
            }
        }

        return $raw;
    }

    /**
     * @param  list<string>  $allowed
     * @return array<string, mixed>
     */
    private function cleanEntry(mixed $entry, array $allowed, string $path): array
    {
        if (! is_array($entry) || ($entry !== [] && array_is_list($entry))) {
            throw new SchemaFormatException('editor_meta_invalid', "الإدخال {$path} يجب أن يكون كائناً.");
        }
        $unknown = array_diff(array_keys($entry), $allowed);
        if ($unknown !== []) {
            throw new SchemaFormatException('editor_meta_invalid', "مفتاح غير معروف في {$path}: ".implode('، ', array_map('strval', $unknown)).'.');
        }

        $out = [];
        foreach (['name', 'title'] as $textKey) {
            if (array_key_exists($textKey, $entry)) {
                $text = $entry[$textKey];
                if ($text !== null && ! is_string($text)) {
                    throw new SchemaFormatException('editor_meta_invalid', "{$path}.{$textKey} يجب أن يكون نصاً.");
                }
                $text = trim((string) $text);
                if (mb_strlen($text) > self::MAX_TEXT) {
                    throw new SchemaFormatException('editor_meta_invalid', "{$path}.{$textKey} يتجاوز ".self::MAX_TEXT.' حرفاً.');
                }
                if ($text !== '') {
                    $out[$textKey] = $text;
                }
            }
        }
        if (array_key_exists('hidden', $entry)) {
            if (! is_bool($entry['hidden'])) {
                throw new SchemaFormatException('editor_meta_invalid', "{$path}.hidden يجب أن يكون منطقياً.");
            }
            if ($entry['hidden'] === true) {
                $out['hidden'] = true;
            }
        }
        if (array_key_exists('preset', $entry) && $entry['preset'] !== null) {
            if (! is_string($entry['preset']) || preg_match('/^[a-zA-Z][A-Za-z0-9]{0,39}$/', $entry['preset']) !== 1) {
                throw new SchemaFormatException('editor_meta_invalid', "{$path}.preset غير صالح.");
            }
            $out['preset'] = $entry['preset'];
        }

        return $out;
    }
}
