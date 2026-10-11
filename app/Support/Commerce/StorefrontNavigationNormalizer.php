<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V7d-2 — وثيقة التنقّل `navigation: { menus }` (V0 §11، D-18). السلطة (PHP) لتوأمَي TS
 * (`navigation.ts` في web وstorefront، متطابقان حرفياً)، وثلاثتها على `tests/Fixtures/presentation/navigation.json`.
 *
 * مفتاح اختياري إضافي بحت. الغياب (أو لا قائمة صالحة) = لا مفتاح، فتبقى مخرجات الوثيقة القديمة **بلا أي تغيير**
 * و`PRESENTATION_CONFIG_VERSION` = 3. روابط `header.links` القديمة تعمل كما هي؛ وحين توجد قائمة بالمعرّف `main`
 * فهي تحلّ محلها في الترويسة فقط (V0 §11.1).
 *
 * الشكل: ≤ 6 قوائم × ≤ 24 عنصراً؛ للعنصر ≤ 12 ابناً (`MAX_NAV_DEPTH = 1` ثابتٌ لا شكل، فمستوى ثانٍ أو لوحة mega
 * لاحقاً تغيير قدرة لا كسر مخطط). **الهدف مُصنَّف لا مسار حرّ**: `home` · `category {id}` · `product {id}` ·
 * `content {slug ∈ CONTENT_PAGE_SLUGS}` · `external {https، newTab?}`. العارض يحلّ الرابط، فالتصنيف/المنتج المحذوف
 * عنصرٌ يُحذف لا رابطٌ ميّت. عنصر بهدفٍ غير صالح يُسقط، وحقلٌ اختياريّ غير صالح يُسقط وحده، والمعرّفات المكرّرة
 * تُعاد تسميتها قطعياً، وما حُجز للتوسعة (`presentation.kind = mega`, `meta`) يُسقط fail-closed.
 */
final class StorefrontNavigationNormalizer
{
    public const MAX_MENUS = 6;

    public const MAX_ITEMS = 24;

    public const MAX_CHILDREN = 12;

    /** مستويات الأبناء تحت العنصر الأعلى. 1 ⇒ للعنصر أبناء، ولا أبناء للأبناء. */
    public const MAX_DEPTH = 1;

    public const LABEL_MAX = 80;

    public const BADGE_TEXT_MAX = 12;

    public const BADGE_TONES = ['brand', 'accent'];

    public const PRESENTATIONS = ['link', 'dropdown'];

    public const MAIN_MENU_ID = 'main';

    /**
     * @param  callable(string):?string  $sanitizeExternalUrl  نفس مطهّر الروابط الخارجية للمُطبِّع الرئيسي
     * @return array{menus: list<array<string,mixed>>}|null
     */
    public static function normalize(mixed $raw, callable $sanitizeExternalUrl): ?array
    {
        if (! self::isObject($raw) || ! is_array($raw['menus'] ?? null) || ! array_is_list($raw['menus'])) {
            return null;
        }
        $seen = [];
        $menus = [];
        foreach ($raw['menus'] as $index => $menu) {
            $normalized = self::normalizeMenu($menu, $index, $seen, $sanitizeExternalUrl);
            if ($normalized !== null) {
                $menus[] = $normalized;
            }
            if (count($menus) >= self::MAX_MENUS) {
                break;
            }
        }

        return $menus === [] ? null : ['menus' => $menus];
    }

    /**
     * @param  array<string,bool>  $seen
     * @return array<string,mixed>|null
     */
    private static function normalizeMenu(mixed $raw, int $index, array &$seen, callable $sanitize): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $itemIds = [];
        $items = [];
        if (is_array($raw['items'] ?? null) && array_is_list($raw['items'])) {
            foreach ($raw['items'] as $i => $item) {
                $normalized = self::normalizeItem($item, $i, 0, $itemIds, $sanitize);
                if ($normalized !== null) {
                    $items[] = $normalized;
                }
                if (count($items) >= self::MAX_ITEMS) {
                    break;
                }
            }
        }

        return [
            'id' => self::uniqueId(self::safeId($raw['id'] ?? null, 'menu-'.$index), $seen),
            'name' => mb_substr(self::str($raw['name'] ?? null), 0, self::LABEL_MAX),
            'items' => $items,
        ];
    }

    /**
     * @param  array<string,bool>  $seen
     * @return array<string,mixed>|null
     */
    private static function normalizeItem(mixed $raw, int $index, int $depth, array &$seen, callable $sanitize): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $target = self::normalizeTarget($raw['target'] ?? null, $sanitize);
        if ($target === null) {
            return null;
        }

        $item = [
            'id' => self::uniqueId(self::safeId($raw['id'] ?? null, 'nav-'.$index), $seen),
            'label' => mb_substr(self::str($raw['label'] ?? null), 0, self::LABEL_MAX),
            'target' => $target,
            'enabled' => is_bool($raw['enabled'] ?? null) ? $raw['enabled'] : true,
        ];
        $icon = $raw['icon'] ?? null;
        if (is_string($icon) && in_array($icon, IconRegistry::KEYS, true)) {
            $item['icon'] = $icon;
        }
        $badge = self::normalizeBadge($raw['badge'] ?? null);
        if ($badge !== null) {
            $item['badge'] = $badge;
        }

        if ($depth < self::MAX_DEPTH && is_array($raw['children'] ?? null) && array_is_list($raw['children'])) {
            $children = [];
            foreach ($raw['children'] as $i => $child) {
                $normalized = self::normalizeItem($child, $i, $depth + 1, $seen, $sanitize);
                if ($normalized !== null) {
                    $children[] = $normalized;
                }
                if (count($children) >= self::MAX_CHILDREN) {
                    break;
                }
            }
            if ($children !== []) {
                $item['children'] = $children;
            }
        }

        if (self::isObject($raw['presentation'] ?? null)) {
            $kind = $raw['presentation']['kind'] ?? null;
            if (is_string($kind) && in_array($kind, self::PRESENTATIONS, true)) {
                $item['presentation'] = ['kind' => $kind];
            }
        }

        return $item;
    }

    /** @return array<string,mixed>|null */
    public static function normalizeTarget(mixed $raw, callable $sanitize): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $kind = $raw['kind'] ?? null;
        switch ($kind) {
            case 'home':
                return ['kind' => 'home'];
            case 'category':
            case 'product':
                $id = trim(self::str($raw['id'] ?? null));

                return preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $id) === 1 ? ['kind' => $kind, 'id' => $id] : null;
            case 'content':
                $slug = $raw['slug'] ?? null;

                return is_string($slug) && in_array($slug, StorefrontPresentationNormalizer::CONTENT_PAGE_SLUGS, true)
                    ? ['kind' => 'content', 'slug' => $slug]
                    : null;
            case 'external':
                $href = $sanitize(self::str($raw['href'] ?? null));
                if ($href === null || $href === '') {
                    return null;
                }

                return ($raw['newTab'] ?? null) === true
                    ? ['kind' => 'external', 'href' => $href, 'newTab' => true]
                    : ['kind' => 'external', 'href' => $href];
            default:
                return null;
        }
    }

    /** @return array<string,mixed>|null */
    private static function normalizeBadge(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $text = mb_substr(trim(self::str($raw['text'] ?? null)), 0, self::BADGE_TEXT_MAX);
        if ($text === '') {
            return null;
        }
        $tone = $raw['tone'] ?? null;

        return is_string($tone) && in_array($tone, self::BADGE_TONES, true)
            ? ['text' => $text, 'tone' => $tone]
            : ['text' => $text];
    }

    /** @param  array<string,bool>  $seen */
    private static function uniqueId(string $base, array &$seen): string
    {
        $id = $base;
        for ($n = 2; isset($seen[$id]); $n++) {
            $suffix = '-'.$n;
            $id = substr($base, 0, 64 - strlen($suffix)).$suffix;
        }
        $seen[$id] = true;

        return $id;
    }

    private static function safeId(mixed $value, string $fallback): string
    {
        $text = trim(self::str($value));

        return preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $text) === 1 ? $text : $fallback;
    }

    private static function str(mixed $value): string
    {
        return is_string($value) ? $value : '';
    }

    private static function isObject(mixed $value): bool
    {
        return is_array($value) && ($value === [] || ! array_is_list($value));
    }
}
