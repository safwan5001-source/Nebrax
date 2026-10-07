<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V5e-2a — الرموز العامة على مستوى الوثيقة (V0 §5.1 الطباعة، §6.2 الأسطح،
 * §6.3 عرض المحتوى، §6.6 الحركة). السلطة (PHP) لتوأمَي TS (`global-tokens.ts` في web
 * وstorefront، متطابقان حرفياً)، وثلاثتها على `tests/Fixtures/presentation/global-tokens.json`.
 *
 * مفاتيح اختيارية إضافية بحتة: `typography` · `surfaces` · `layout` · `motion`. الغياب
 * (أو كل الحقول غير صالحة) = لا مفتاح، فتبقى مخرجات الوثيقة القديمة **بلا أي تغيير**.
 * قيمة خارج المجموعة المعدودة تُسقط وحدها (لا قيمة افتراضية مرئية)، والمجموعة الفارغة
 * تُحذف، والترتيب قانوني ثابت. خارج هذه الشريحة عمداً: عائلات الخطوط (V5e-2c: كتالوج
 * مستضاف ذاتياً) و`buttons`/`buttonText` (V5e-2b: يحتاج إثبات تباين التسمية) ولون حدّ
 * الأسطح؛ كلها تُسقط الآن fail-closed.
 */
final class StorefrontGlobalTokensNormalizer
{
    public const HEADING_SCALES = ['sm', 'md', 'lg'];

    public const BODY_SCALES = ['sm', 'md', 'lg'];

    public const HEADING_WEIGHTS = [400, 500, 700, 800];

    public const BODY_WEIGHTS = [400, 500, 700];

    public const LINE_HEIGHTS = ['tight', 'normal', 'relaxed'];

    public const SECTION_HEADINGS = ['bar', 'plain', 'centered', 'underline'];

    public const RADII = ['none', 'sm', 'md', 'lg', 'pill'];

    public const BORDER_WIDTHS = ['none', 'hairline', 'medium'];

    public const SHADOWS = ['none', 'soft', 'medium', 'strong'];

    public const CONTENT_WIDTHS = ['narrow', 'standard', 'wide'];

    public const DURATIONS = ['instant', 'fast', 'base', 'slow'];

    public const EASINGS = ['standard', 'emphasized'];

    /**
     * @param  array<string,mixed>  $input  الوثيقة الخام (يُقرأ منها المفاتيح الأربعة فقط)
     * @return array<string,array<string,mixed>> المفاتيح الموجودة فقط، بترتيب ثابت
     */
    public static function normalize(array $input): array
    {
        $out = [];

        $typography = self::pickFields($input['typography'] ?? null, [
            'headingScale' => self::HEADING_SCALES,
            'bodyScale' => self::BODY_SCALES,
            'headingWeight' => self::HEADING_WEIGHTS,
            'bodyWeight' => self::BODY_WEIGHTS,
            'lineHeight' => self::LINE_HEIGHTS,
            'sectionHeading' => self::SECTION_HEADINGS,
        ]);
        if ($typography !== null) {
            $out['typography'] = $typography;
        }

        $surfaces = self::pickFields($input['surfaces'] ?? null, [
            'radius' => self::RADII,
            'shadow' => self::SHADOWS,
        ]) ?? [];
        $surfaceRaw = $input['surfaces'] ?? null;
        $border = self::isObject($surfaceRaw) && self::isObject($surfaceRaw['border'] ?? null)
            ? self::pick($surfaceRaw['border']['width'] ?? null, self::BORDER_WIDTHS)
            : null;
        if ($border !== null) {
            $surfaces['border'] = ['width' => $border];
        }
        if ($surfaces !== []) {
            // ترتيب قانوني: radius → border → shadow
            $ordered = [];
            foreach (['radius', 'border', 'shadow'] as $key) {
                if (isset($surfaces[$key])) {
                    $ordered[$key] = $surfaces[$key];
                }
            }
            $out['surfaces'] = $ordered;
        }

        $layout = self::pickFields($input['layout'] ?? null, ['contentWidth' => self::CONTENT_WIDTHS]);
        if ($layout !== null) {
            $out['layout'] = $layout;
        }

        $motion = self::pickFields($input['motion'] ?? null, [
            'duration' => self::DURATIONS,
            'easing' => self::EASINGS,
        ]);
        if ($motion !== null) {
            $out['motion'] = $motion;
        }

        return $out;
    }

    /**
     * @param  array<string,list<int|string>>  $fields
     * @return array<string,int|string>|null
     */
    private static function pickFields(mixed $raw, array $fields): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $out = [];
        foreach ($fields as $field => $allowed) {
            $value = self::pick($raw[$field] ?? null, $allowed);
            if ($value !== null) {
                $out[$field] = $value;
            }
        }

        return $out === [] ? null : $out;
    }

    /** @param list<int|string> $allowed */
    private static function pick(mixed $value, array $allowed): int|string|null
    {
        if (is_float($value) && floor($value) === $value && abs($value) < 1e9) {
            $value = (int) $value;
        }
        if (! is_string($value) && ! is_int($value)) {
            return null;
        }

        return in_array($value, $allowed, true) ? $value : null;
    }

    private static function isObject(mixed $value): bool
    {
        return is_array($value) && ($value === [] || ! array_is_list($value));
    }
}
