<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V7a — تصميم الترويسة البنيوي (V0 §9.1). السلطة (PHP) لتوأمَي TS (`header-design.ts`
 * في web وstorefront، متطابقان حرفياً)، وثلاثتها على `tests/Fixtures/presentation/header-design.json`.
 *
 * مفتاح اختياري إضافي بحت داخل `header`: `header.design`. الغياب (أو كل الحقول غير صالحة) = لا
 * مفتاح، فتبقى مخرجات الوثيقة القديمة **بلا أي تغيير** (V0 §2.2) و`PRESENTATION_CONFIG_VERSION` = 3.
 * قيمة خارج المجموعة المعدودة تُسقط وحدها، والمجموعات الفارغة تُحذف، والترتيب قانوني ثابت.
 *
 * V7a بنيوي: `layout` · `mobileLayout` · `height` · `logo.size` · `sticky` (always|off) ·
 * `border.width` · `shadow`. V7b يضيف الألوان: `surface.background` (ColorRef: دور لوحة أو hex)
 * و`text` و`icon` (ColorRef)؛ تباين الصريح منها يحرسه `HeaderDesignContrast` عند النشر، ولون النص
 * التلقائي فوق خلفية مصمَّمة (الأبيض/الأسود الأفضل إثباتاً) يمرّ بالبناء. مؤجَّل صراحةً إلى V7c
 * وتُسقط fail-closed حتى ذلك الحين: `surface.alpha`/التدرّج، `mode`، و`search/categoryNav`
 * الصريحان، و`logo.align/treatment`. V7c-1 يضيف `sticky: on-scroll-up` (تظهر الترويسة عند التمرير للأعلى).
 */
final class StorefrontHeaderDesignNormalizer
{
    public const LAYOUTS = ['standard', 'compact', 'centered', 'two-row'];

    public const MOBILE_LAYOUTS = ['logo-centre', 'logo-start'];

    public const HEIGHTS = ['compact', 'standard', 'tall'];

    public const LOGO_SIZES = ['sm', 'md', 'lg', 'xl'];

    public const STICKY = ['always', 'on-scroll-up', 'off'];

    public const BORDER_WIDTHS = ['none', 'hairline', 'medium'];

    public const SHADOWS = ['none', 'soft', 'medium'];

    /**
     * @return array<string,mixed>|null الحقول الصالحة بترتيب قانوني، أو null عند الغياب
     */
    public static function normalize(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }

        $out = [];
        self::put($out, 'layout', $raw['layout'] ?? null, self::LAYOUTS);
        self::put($out, 'mobileLayout', $raw['mobileLayout'] ?? null, self::MOBILE_LAYOUTS);
        self::put($out, 'height', $raw['height'] ?? null, self::HEIGHTS);

        if (self::isObject($raw['logo'] ?? null)) {
            $size = self::pick($raw['logo']['size'] ?? null, self::LOGO_SIZES);
            if ($size !== null) {
                $out['logo'] = ['size' => $size];
            }
        }

        if (self::isObject($raw['surface'] ?? null)) {
            $background = StorefrontSectionDesignNormalizer::colorRef($raw['surface']['background'] ?? null);
            if ($background !== null) {
                $out['surface'] = ['background' => $background];
            }
        }
        $text = StorefrontSectionDesignNormalizer::colorRef($raw['text'] ?? null);
        if ($text !== null) {
            $out['text'] = $text;
        }
        $icon = StorefrontSectionDesignNormalizer::colorRef($raw['icon'] ?? null);
        if ($icon !== null) {
            $out['icon'] = $icon;
        }

        self::put($out, 'sticky', $raw['sticky'] ?? null, self::STICKY);

        if (self::isObject($raw['border'] ?? null)) {
            $width = self::pick($raw['border']['width'] ?? null, self::BORDER_WIDTHS);
            if ($width !== null) {
                $out['border'] = ['width' => $width];
            }
        }

        self::put($out, 'shadow', $raw['shadow'] ?? null, self::SHADOWS);

        return $out === [] ? null : $out;
    }

    /** @param list<string> $allowed */
    private static function put(array &$out, string $key, mixed $value, array $allowed): void
    {
        $picked = self::pick($value, $allowed);
        if ($picked !== null) {
            $out[$key] = $picked;
        }
    }

    /** @param list<string> $allowed */
    private static function pick(mixed $value, array $allowed): ?string
    {
        return is_string($value) && in_array($value, $allowed, true) ? $value : null;
    }

    private static function isObject(mixed $value): bool
    {
        return is_array($value) && ($value === [] || ! array_is_list($value));
    }
}
