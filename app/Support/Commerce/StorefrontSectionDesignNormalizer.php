<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V5b — عقد التصميم البصري للقسم `section.design` (V0 §3.1–§3.4). السلطة
 * (PHP) لتوأمَي TS (`section-design.ts` في web وstorefront، متطابقان حرفياً)، وثلاثتها
 * على `tests/Fixtures/presentation/section-design.json`.
 *
 * مجموعات مكتوبة ومعدودة — لا «حقيبة أنماط». كل نوع قسم يعلن المجموعات (والحقول داخل
 * المجموعة) التي يستطيع رسمها؛ المجموعة/الحقل غير المسموح أو غير المعروف يُسقط، والقيمة
 * غير الصالحة تُسقط وحدها، والنتيجة الفارغة تُحذف. **غياب `design` ⇒ مخرجات القسم
 * بلا أي تغيير** (§3.1).
 *
 * خارج هذا الملف عمداً (كلٌّ يدخل مع الشريحة التي تستطيع رسمه وإثباته): `layout`، و`overlap`/`mediaTreatment`.
 * تُسقط الآن fail-closed فلا يتسلل خلفية غير مُثبتة. (V5e-3 أضاف `separator` و`motion.reveal`.)
 */
final class StorefrontSectionDesignNormalizer
{
    public const COLOR_ROLES = ['brand', 'accent', 'surface', 'surfaceAlt', 'text', 'heading', 'link', 'border', 'overlay'];

    public const STEPS = ['none', 'xs', 'sm', 'md', 'lg', 'xl'];

    public const DIRECTIONS = ['to-end', 'to-start', 'to-bottom', 'to-top', 'to-bottom-end', 'to-bottom-start', 'to-top-end', 'to-top-start'];

    public const ALIGNS = ['start', 'center', 'end'];

    public const HEADING_SCALES = ['sm', 'md', 'lg', 'xl'];

    public const BODY_SCALES = ['sm', 'md', 'lg'];

    public const HEADING_WEIGHTS = [400, 500, 700, 800];

    public const LINE_HEIGHTS = ['tight', 'normal', 'relaxed'];

    public const HEADING_STYLES = ['bar', 'plain', 'centered', 'underline'];

    public const WIDTH_MODES = ['contained', 'wide', 'full'];

    public const WIDTH_MAXES = ['narrow', 'standard', 'wide'];

    public const BORDER_WIDTHS = ['none', 'hairline', 'medium'];

    public const RADII = ['none', 'sm', 'md', 'lg', 'pill'];

    public const SHADOWS = ['none', 'soft', 'medium', 'strong'];

    /** V5e-3 — فاصل حافّة القسم (V0 §6.4). */
    public const SEPARATOR_KINDS = ['none', 'line', 'band', 'wave', 'angle', 'curve'];

    public const SEPARATOR_HEIGHTS = ['sm', 'md', 'lg'];

    /** V5e-3 — كشف لمرّة واحدة (V0 §6.6): `fade-up` فقط، اختياري لكل قسم. */
    public const REVEALS = ['none', 'fade-up'];

    /** V6b-2 — أنواع الخلفية المتاحة لكل الأقسام؛ `media` للبطل واللافتة وحدهما. */
    public const BACKGROUND_KINDS = ['solid', 'gradient'];

    /** V6b-2 — تعتيم تراكب الصورة: نسبة مئوية بخطوات 5، حدّها 90 (V0 §8.1) فلا تُخفى الصورة كلياً. */
    public const OVERLAY_ALPHAS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];

    private const FULL_TEXT = ['heading', 'body', 'link', 'align'];

    private const FULL_TYPO = ['headingScale', 'bodyScale', 'headingWeight', 'lineHeight', 'headingStyle'];

    /**
     * سجل القدرات لكل نوع (V0 §3.4، المرجع): مجموعة ← `true` (كلّها) أو قائمة الحقول.
     *
     * @return array<string, array<string, true|list<string>>>
     */
    public static function capabilities(): array
    {
        // V5e-3 — `separator` لكل الأنواع القابلة للتصميم؛ `motion.reveal` للبطل واللافتة فقط (V0 §3.4).
        $rich = ['background' => self::BACKGROUND_KINDS, 'text' => self::FULL_TEXT, 'typography' => self::FULL_TYPO, 'width' => true, 'spacing' => true, 'align' => true, 'border' => true, 'radius' => true, 'shadow' => true, 'separator' => true];
        // V6b-2 — خلفية الوسائط للبطل واللافتة وحدهما (V0 §8.1)؛ كل نوعٍ آخر `solid|gradient` فقط.
        $hero = ['background' => [...self::BACKGROUND_KINDS, 'media']] + $rich + ['motion' => ['reveal']];
        $shelf = ['background' => self::BACKGROUND_KINDS, 'text' => ['heading'], 'typography' => ['headingStyle'], 'width' => true, 'spacing' => true, 'separator' => true];

        return [
            'hero' => $hero,
            'banner' => $hero,
            'categories' => ['background' => self::BACKGROUND_KINDS, 'text' => ['heading'], 'typography' => ['headingStyle'], 'width' => true, 'spacing' => true, 'border' => true, 'radius' => true, 'separator' => true],
            'newArrivals' => $shelf,
            'featured' => $shelf,
            'offers' => $shelf,
            'productShelf' => $shelf,
            'discovery' => ['background' => self::BACKGROUND_KINDS, 'text' => ['heading'], 'spacing' => true, 'separator' => true],
            'benefits' => ['background' => self::BACKGROUND_KINDS, 'text' => self::FULL_TEXT, 'typography' => self::FULL_TYPO, 'spacing' => true, 'align' => true, 'border' => true, 'radius' => true, 'shadow' => true, 'separator' => true],
            'customContent' => ['background' => self::BACKGROUND_KINDS, 'text' => self::FULL_TEXT, 'typography' => self::FULL_TYPO, 'width' => ['max'], 'spacing' => true, 'align' => true, 'separator' => true],
            'appPromo' => ['background' => self::BACKGROUND_KINDS, 'text' => self::FULL_TEXT, 'spacing' => true, 'border' => true, 'radius' => true, 'separator' => true],
            'deliveryPromise' => ['background' => self::BACKGROUND_KINDS, 'spacing' => true, 'separator' => true],
            'wholesale' => ['background' => self::BACKGROUND_KINDS, 'spacing' => true, 'separator' => true],
        ];
    }

    /**
     * @return array<string,mixed>|null `null` = لا تصميم (يُحذف المفتاح فتبقى الوثائق بلا تغيير)
     */
    public static function normalize(string $type, mixed $raw): ?array
    {
        $capability = self::capabilities()[$type] ?? null;
        if ($capability === null || ! self::isObject($raw)) {
            return null;
        }

        $out = [];
        if (isset($capability['background'])) {
            $background = self::background($raw['background'] ?? null, $capability['background']);
            if ($background !== null) {
                $out['background'] = $background;
            }
        }
        if (isset($capability['text'])) {
            $text = self::text($raw['text'] ?? null, $capability['text']);
            if ($text !== null) {
                $out['text'] = $text;
            }
        }
        if (isset($capability['typography'])) {
            $typography = self::typography($raw['typography'] ?? null, $capability['typography']);
            if ($typography !== null) {
                $out['typography'] = $typography;
            }
        }
        if (isset($capability['width'])) {
            $width = self::width($raw['width'] ?? null, $capability['width'] === true ? ['mode', 'max'] : $capability['width']);
            if ($width !== null) {
                $out['width'] = $width;
            }
        }
        if (isset($capability['spacing'])) {
            $spacing = self::spacing($raw['spacing'] ?? null);
            if ($spacing !== null) {
                $out['spacing'] = $spacing;
            }
        }
        if (isset($capability['align'])) {
            $align = self::pick($raw['align'] ?? null, self::ALIGNS);
            if ($align !== null) {
                $out['align'] = $align;
            }
        }
        if (isset($capability['border'])) {
            $border = self::border($raw['border'] ?? null);
            if ($border !== null) {
                $out['border'] = $border;
            }
        }
        if (isset($capability['radius'])) {
            $radius = self::pick($raw['radius'] ?? null, self::RADII);
            if ($radius !== null) {
                $out['radius'] = $radius;
            }
        }
        if (isset($capability['shadow'])) {
            $shadow = self::pick($raw['shadow'] ?? null, self::SHADOWS);
            if ($shadow !== null) {
                $out['shadow'] = $shadow;
            }
        }
        if (isset($capability['separator'])) {
            $separator = self::separator($raw['separator'] ?? null);
            if ($separator !== null) {
                $out['separator'] = $separator;
            }
        }
        if (isset($capability['motion'])) {
            $reveal = self::isObject($raw['motion'] ?? null) ? self::pick($raw['motion']['reveal'] ?? null, self::REVEALS) : null;
            if ($reveal !== null) {
                $out['motion'] = ['reveal' => $reveal];
            }
        }

        return $out === [] ? null : $out;
    }

    /** `{role}` يغلب `{hex}` إن اجتمعا (حتمي)؛ hex بحروف صغيرة؛ وما عداهما يُسقط. */
    public static function colorRef(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $role = self::pick($raw['role'] ?? null, self::COLOR_ROLES);
        if ($role !== null) {
            return ['role' => $role];
        }
        $hex = is_string($raw['hex'] ?? null) ? trim($raw['hex']) : '';
        if (preg_match('/^#[0-9a-fA-F]{6}$/', $hex) === 1) {
            return ['hex' => strtolower($hex)];
        }

        return null;
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

    /** @param true|list<string> $allowance */
    private static function background(mixed $raw, array|bool $allowance): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $kind = $raw['kind'] ?? null;
        if (! is_string($kind) || ! self::allows($allowance, $kind)) {
            return null; // نوعٌ غير معروف أو غير مسموح لهذا القسم — fail-closed
        }
        if ($kind === 'solid') {
            $color = self::colorRef($raw['color'] ?? null);

            return $color === null ? null : ['kind' => 'solid', 'color' => $color];
        }
        if ($kind === 'gradient') {
            $from = self::colorRef($raw['from'] ?? null);
            $to = self::colorRef($raw['to'] ?? null);
            $direction = self::pick($raw['direction'] ?? null, self::DIRECTIONS);

            return $from !== null && $to !== null && $direction !== null
                ? ['kind' => 'gradient', 'from' => $from, 'to' => $to, 'direction' => $direction]
                : null;
        }
        if ($kind === 'media') {
            return self::mediaBackground($raw);
        }

        return null;
    }

    /**
     * V6b-2 — خلفية صورة: `media` إلزامية (وإلا سقطت الخلفية كلها)، و`mobile` بديلٌ اختياري
     * لشاشات الجوال، و`overlay` تراكب لونٍ اختياري. الصورة خلفيةٌ زخرفية دائماً فلا alt لها،
     * و`cover` دائماً (إطارٌ لا يغطّي كل المساحة يكشف خلفيةً لا يشملها دليل التباين).
     *
     * @param  array<string,mixed>  $raw
     * @return array<string,mixed>|null
     */
    private static function mediaBackground(array $raw): ?array
    {
        $media = self::backgroundRef($raw['media'] ?? null);
        if ($media === null) {
            return null;
        }
        $out = ['kind' => 'media', 'media' => $media];
        $mobile = self::backgroundRef($raw['mobile'] ?? null);
        if ($mobile !== null) {
            $out['mobile'] = $mobile;
        }
        $overlay = self::overlay($raw['overlay'] ?? null);
        if ($overlay !== null) {
            $out['overlay'] = $overlay;
        }

        return $out;
    }

    /** @return array<string,mixed>|null */
    private static function backgroundRef(mixed $raw): ?array
    {
        $ref = StorefrontMediaRefNormalizer::normalize($raw);
        if ($ref === null) {
            return null;
        }
        unset($ref['fit'], $ref['alt']);
        $ref['decorative'] = true;

        return $ref;
    }

    /** @return array{color:array<string,string>,alpha:int}|null */
    private static function overlay(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $alpha = self::pick($raw['alpha'] ?? null, self::OVERLAY_ALPHAS);
        if (! is_int($alpha)) {
            return null;
        }

        return ['color' => self::colorRef($raw['color'] ?? null) ?? ['role' => 'overlay'], 'alpha' => $alpha];
    }

    /** @param true|list<string> $allowance */
    private static function text(mixed $raw, array|bool $allowance): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $out = [];
        foreach (['heading', 'body', 'link'] as $key) {
            if (! self::allows($allowance, $key)) {
                continue;
            }
            $ref = self::colorRef($raw[$key] ?? null);
            if ($ref !== null) {
                $out[$key] = $ref;
            }
        }
        if (self::allows($allowance, 'align')) {
            $align = self::pick($raw['align'] ?? null, self::ALIGNS);
            if ($align !== null) {
                $out['align'] = $align;
            }
        }

        return $out === [] ? null : $out;
    }

    /** @param true|list<string> $allowance */
    private static function typography(mixed $raw, array|bool $allowance): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $out = [];
        $fields = [
            'headingScale' => self::HEADING_SCALES,
            'bodyScale' => self::BODY_SCALES,
            'headingWeight' => self::HEADING_WEIGHTS,
            'lineHeight' => self::LINE_HEIGHTS,
            'headingStyle' => self::HEADING_STYLES,
        ];
        foreach ($fields as $field => $allowed) {
            if (! self::allows($allowance, $field)) {
                continue;
            }
            $value = self::pick($raw[$field] ?? null, $allowed);
            if ($value !== null) {
                $out[$field] = $value;
            }
        }

        return $out === [] ? null : $out;
    }

    /** @param true|list<string> $allowance */
    private static function width(mixed $raw, array|bool $allowance): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $out = [];
        if (self::allows($allowance, 'mode')) {
            $mode = self::pick($raw['mode'] ?? null, self::WIDTH_MODES);
            if ($mode !== null) {
                $out['mode'] = $mode;
            }
        }
        if (self::allows($allowance, 'max')) {
            $max = self::pick($raw['max'] ?? null, self::WIDTH_MAXES);
            if ($max !== null) {
                $out['max'] = $max;
            }
        }

        return $out === [] ? null : $out;
    }

    private static function spacing(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $out = [];
        foreach (['top', 'bottom', 'inner'] as $key) {
            $step = self::pick($raw[$key] ?? null, self::STEPS);
            if ($step !== null) {
                $out[$key] = $step;
            }
        }

        return $out === [] ? null : $out;
    }

    private static function border(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $width = self::pick($raw['width'] ?? null, self::BORDER_WIDTHS);
        if ($width === null) {
            return null;
        }
        $out = ['width' => $width];
        $color = self::colorRef($raw['color'] ?? null);
        if ($color !== null && $width !== 'none') {
            $out['color'] = $color;
        }

        return $out;
    }

    /** فاصل حافّتَي القسم: النوع لكل حافّة، واللون (دور/hex) والارتفاع مشتركان. */
    private static function separator(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $out = [];
        foreach (['top', 'bottom'] as $edge) {
            $kind = self::pick($raw[$edge] ?? null, self::SEPARATOR_KINDS);
            if ($kind !== null) {
                $out[$edge] = $kind;
            }
        }
        // Colour and height only style an edge: without a top or bottom edge that renders, they
        // are inert, invisible and uneditable metadata — the group is dropped altogether.
        $active = array_filter($out, static fn (string $kind): bool => $kind !== 'none');
        if ($active === []) {
            return null;
        }
        $color = self::colorRef($raw['color'] ?? null);
        if ($color !== null) {
            $out['color'] = $color;
        }
        $height = self::pick($raw['height'] ?? null, self::SEPARATOR_HEIGHTS);
        if ($height !== null) {
            $out['height'] = $height;
        }

        return $out;
    }

    /** @param true|list<string>|null $allowance */
    private static function allows(array|bool|null $allowance, string $field): bool
    {
        if ($allowance === null) {
            return false;
        }

        return $allowance === true || in_array($field, $allowance, true);
    }
}
