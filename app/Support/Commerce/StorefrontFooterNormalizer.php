<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V7e-1 + payment logos — تذييل المتجر: `footer.layout` و`footer.groups` و`footer.design` و`footer.paymentLogos`.
 * السلطة (PHP) لتوأمَي TS
 * (`footer-design.ts` في web وstorefront، متطابقان حرفياً)، وثلاثتها على `tests/Fixtures/presentation/footer-design.json`.
 *
 * مفاتيح اختيارية إضافية بحتة داخل `footer`. الغياب = لا مفتاح، فيبقى مخرج الوثيقة القديمة **بلا أي تغيير** (V0 §2.2) و
 * `PRESENTATION_CONFIG_VERSION` = 3، ويظل التذييل الحالي (روابط ثابتة + أعمدة الثقة) يُرسم كما هو حين لا `layout` ولا `groups`.
 * قيمة خارج المجموعة المعدودة تُسقط وحدها، والمجموعات الفارغة تُحذف، والترتيب قانوني ثابت.
 *
 *  - `layout` ∈ compact · columns · centered · editorial · minimal · brand-heavy.
 *  - `groups` ≤ 6 × ≤ 8 رابطاً: لكل مجموعة `id` و`title` (≤ 40) و`menu?` (معرّف قائمة من `navigation.menus` — مرجعٌ يتدهور عند
 *    غيابه) و`links?` (عناصر التنقّل المُصنَّفة الهدف، بلا أبناء) و`span?` ∈ 1|2. روابط المجموعة تعيد استعمال نموذج التنقّل ومنتقياته (§10.3).
 *  - `design` : `surface.background` (ColorRef) · `text` · `heading` · `link` (ColorRef) · `divider.color` · `spacing.top|bottom` ∈ sm|md|lg ·
 *    `logo.size` ∈ sm|md|lg · `align` ∈ start|center|end. تباين الصريح منها يحرسه `FooterDesignContrast` عند النشر.
 *  - `paymentLogos`: عرض بصري Beta فقط، مستقل عن Checkout: تشغيل، ترتيب العلامات الأربع، النمط، الحجم، وإظهار العنوان.
 *
 * مؤجَّل صراحةً (يُسقط fail-closed): خلفية وسائط/تدرّج/`alpha`، `divider.kind/height`، `border`، `logo.treatment`، `linkHover` — يرث الحومُ لون العنوان.
 */
final class StorefrontFooterNormalizer
{
    public const LAYOUTS = ['compact', 'columns', 'centered', 'editorial', 'minimal', 'brand-heavy'];

    public const MAX_GROUPS = 6;

    public const MAX_LINKS = 8;

    public const TITLE_MAX = 40;

    public const SPANS = [1, 2];

    public const SPACING = ['sm', 'md', 'lg'];

    public const LOGO_SIZES = ['sm', 'md', 'lg'];

    public const ALIGNS = ['start', 'center', 'end'];

    public const PAYMENT_LOGO_KEYS = ['mada', 'visa', 'mastercard', 'apple_pay'];

    public const PAYMENT_LOGO_STYLES = ['inline', 'cards', 'strip'];

    public const PAYMENT_LOGO_SIZES = ['sm', 'md', 'lg'];

    /**
     * @param  callable(string):?string  $sanitizeExternalUrl
     * @return array<string,mixed> المفاتيح الصالحة فقط (layout, groups, design, paymentLogos) بهذا الترتيب؛ فارغ عند الغياب
     */
    public static function normalize(mixed $footerRaw, callable $sanitizeExternalUrl): array
    {
        if (! self::isObject($footerRaw)) {
            return [];
        }
        $out = [];

        $layout = $footerRaw['layout'] ?? null;
        if (is_string($layout) && in_array($layout, self::LAYOUTS, true)) {
            $out['layout'] = $layout;
        }

        $groups = self::groups($footerRaw['groups'] ?? null, $sanitizeExternalUrl);
        if ($groups !== []) {
            $out['groups'] = $groups;
        }

        $design = self::design($footerRaw['design'] ?? null);
        if ($design !== null) {
            $out['design'] = $design;
        }

        $paymentLogos = self::paymentLogos($footerRaw['paymentLogos'] ?? null);
        if ($paymentLogos !== null) {
            $out['paymentLogos'] = $paymentLogos;
        }

        return $out;
    }

    /** @return array{enabled:bool,brands:list<string>,style:string,size:string,showTitle:bool}|null */
    private static function paymentLogos(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }

        $brands = self::PAYMENT_LOGO_KEYS;
        if (is_array($raw['brands'] ?? null) && array_is_list($raw['brands'])) {
            $brands = [];
            foreach ($raw['brands'] as $brand) {
                if (
                    is_string($brand)
                    && in_array($brand, self::PAYMENT_LOGO_KEYS, true)
                    && ! in_array($brand, $brands, true)
                ) {
                    $brands[] = $brand;
                }
            }
        }

        $style = $raw['style'] ?? null;
        $size = $raw['size'] ?? null;

        return [
            'enabled' => is_bool($raw['enabled'] ?? null) ? $raw['enabled'] : false,
            'brands' => $brands,
            'style' => is_string($style) && in_array($style, self::PAYMENT_LOGO_STYLES, true) ? $style : 'cards',
            'size' => is_string($size) && in_array($size, self::PAYMENT_LOGO_SIZES, true) ? $size : 'md',
            'showTitle' => is_bool($raw['showTitle'] ?? null) ? $raw['showTitle'] : true,
        ];
    }

    /** @return list<array<string,mixed>> */
    private static function groups(mixed $raw, callable $sanitize): array
    {
        if (! is_array($raw) || ! array_is_list($raw)) {
            return [];
        }
        $seen = [];
        $groups = [];
        foreach ($raw as $index => $group) {
            if (! self::isObject($group)) {
                continue;
            }
            $normalized = [
                'id' => self::uniqueId(self::safeId($group['id'] ?? null, 'group-'.$index), $seen),
                'title' => mb_substr(self::str($group['title'] ?? null), 0, self::TITLE_MAX),
            ];
            $menu = trim(self::str($group['menu'] ?? null));
            if (preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $menu) === 1) {
                $normalized['menu'] = $menu;
            }
            $links = StorefrontNavigationNormalizer::normalizeFlatItems($group['links'] ?? null, self::MAX_LINKS, $sanitize);
            if ($links !== []) {
                $normalized['links'] = $links;
            }
            $span = $group['span'] ?? null;
            if (is_int($span) && in_array($span, self::SPANS, true)) {
                $normalized['span'] = $span;
            }
            $groups[] = $normalized;
            if (count($groups) >= self::MAX_GROUPS) {
                break;
            }
        }

        return $groups;
    }

    /** @return array<string,mixed>|null */
    private static function design(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $out = [];

        if (self::isObject($raw['surface'] ?? null)) {
            $background = StorefrontSectionDesignNormalizer::colorRef($raw['surface']['background'] ?? null);
            if ($background !== null) {
                $out['surface'] = ['background' => $background];
            }
        }
        foreach (['text', 'heading', 'link'] as $field) {
            $ref = StorefrontSectionDesignNormalizer::colorRef($raw[$field] ?? null);
            if ($ref !== null) {
                $out[$field] = $ref;
            }
        }
        if (self::isObject($raw['divider'] ?? null)) {
            $color = StorefrontSectionDesignNormalizer::colorRef($raw['divider']['color'] ?? null);
            if ($color !== null) {
                $out['divider'] = ['color' => $color];
            }
        }
        if (self::isObject($raw['spacing'] ?? null)) {
            $spacing = [];
            foreach (['top', 'bottom'] as $side) {
                $step = $raw['spacing'][$side] ?? null;
                if (is_string($step) && in_array($step, self::SPACING, true)) {
                    $spacing[$side] = $step;
                }
            }
            if ($spacing !== []) {
                $out['spacing'] = $spacing;
            }
        }
        if (self::isObject($raw['logo'] ?? null)) {
            $size = $raw['logo']['size'] ?? null;
            if (is_string($size) && in_array($size, self::LOGO_SIZES, true)) {
                $out['logo'] = ['size' => $size];
            }
        }
        $align = $raw['align'] ?? null;
        if (is_string($align) && in_array($align, self::ALIGNS, true)) {
            $out['align'] = $align;
        }

        return $out === [] ? null : $out;
    }

    /** @param array<string,bool> $seen */
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
