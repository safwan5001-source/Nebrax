<?php

namespace App\Support\Commerce;

use App\Services\Commerce\StorefrontMediaTransform;
use InvalidArgumentException;

/**
 * AWJ-VD-H1 / VD-1a — وثيقة الهوية المرئية للبُعد والقيمة (§3.3، D-01، D-09، D-11).
 *
 * طريقتان لعقدٍ واحد:
 *
 * - `normalizeValue()` / `normalizeFacet()` — تطبيعٌ **متسامح حتمي** للقراءة: ما لا يصلح يسقط حقلاً
 *   حقلاً، والمفتاح الغائب يعني «ورِّث» (§3.6). الناتج نقطة ثابتة (idempotent) بترتيب مفاتيح ثابت.
 *   توأماه `normalizeFacetValueVisual` / `normalizeFacetVisual` في `facet-visual.ts` (web وstorefront)
 *   بالفيكستشر المشترك `tests/Fixtures/presentation/facet-visual.json`.
 * - `errors()` — تحقّقٌ **صارم** لمسار الكتابة: يعيد أخطاءً حقلية بدل الإسقاط الصامت (D-11). لا يلمس
 *   قاعدة البيانات؛ ملكية الوسيط وحالته تُفحص في الخدمة (VD-1b).
 *
 * الصورة مرجعٌ إلى مكتبة `storefront_media` (D-02) بمجموعة جزئية من `MediaRef`:
 * `mediaId · fit · focal · zoom · alt · decorative`. القصّ والتدوير **ممنوعان** هنا (D-09): الشكل قناع
 * عرض فوق المصغّرات الأساسية، لا بكسلات مخبوزة. و`fit` يُحفظ صريحاً حتى لو كان `cover` لأن غيابه
 * يعني الوراثة من افتراضات البُعد، بخلاف `MediaRef` العام الذي يُسقط `cover` بوصفه افتراضاً.
 */
final class CommerceFacetVisualNormalizer
{
    /** مفاتيح هوية القيمة، وهي نفسها مفاتيح `self` في هوية البُعد — بالترتيب القانوني. */
    public const VALUE_KEYS = ['content', 'image', 'icon', 'iconColor', 'background', 'shape', 'size', 'showLabel'];

    /** ما ترثه القيم من البُعد (`defaults`) — بالترتيب القانوني. لا صورة: الصورة لا تُورث (D-08). */
    public const DEFAULTS_KEYS = ['content', 'icon', 'iconColor', 'background', 'shape', 'size', 'fit', 'showLabel'];

    public const IMAGE_KEYS = ['mediaId', 'fit', 'focal', 'zoom', 'alt', 'decorative'];

    private const FACET_KEYS = ['self', 'defaults'];

    private const HEX = '/\A#[0-9a-f]{6}\z/';

    // ───────────────────────────── التطبيع المتسامح ─────────────────────────────

    /** @return array<string,mixed> هوية قيمة مطبَّعة؛ `[]` = لا تخصيص (ورِّث كل شيء). */
    public static function normalizeValue(mixed $raw): array
    {
        return self::object($raw) ? self::appearance($raw, self::VALUE_KEYS) : [];
    }

    /** @return array<string,mixed> هوية بُعد مطبَّعة `{self?, defaults?}`؛ `[]` = لا تخصيص. */
    public static function normalizeFacet(mixed $raw): array
    {
        if (! self::object($raw)) {
            return [];
        }

        $out = [];
        $self = self::object($raw['self'] ?? null) ? self::appearance($raw['self'], self::VALUE_KEYS) : [];
        if ($self !== []) {
            $out['self'] = $self;
        }
        $defaults = self::object($raw['defaults'] ?? null) ? self::appearance($raw['defaults'], self::DEFAULTS_KEYS) : [];
        if ($defaults !== []) {
            $out['defaults'] = $defaults;
        }

        return $out;
    }

    /**
     * @param  list<string>  $keys
     * @return array<string,mixed>
     */
    private static function appearance(array $raw, array $keys): array
    {
        $out = [];
        foreach ($keys as $key) {
            $value = self::field($key, $raw[$key] ?? null);
            if ($value !== null) {
                $out[$key] = $value;
            }
        }

        return $out;
    }

    private static function field(string $key, mixed $value): mixed
    {
        return match ($key) {
            'content' => self::inList($value, FacetVisualRegistry::CONTENTS),
            'image' => self::image($value),
            'icon' => is_string($value) && in_array($value, IconRegistry::KEYS, true) ? $value : null,
            'iconColor', 'background' => self::hex($value),
            'shape' => self::inList($value, FacetVisualRegistry::SHAPES),
            'size' => self::inList($value, FacetVisualRegistry::SIZES),
            'fit' => self::inList($value, FacetVisualRegistry::FITS),
            'showLabel' => is_bool($value) ? $value : null,
            default => null,
        };
    }

    /** @return array<string,mixed>|null */
    private static function image(mixed $raw): ?array
    {
        if (! self::object($raw)) {
            return null;
        }

        // المعرّف والتركيز والنص البديل والزخرفية من المطبِّع القائم نفسه (لا نسخة ثانية من قواعده)؛
        // القصّ والتدوير لا يمرّان إليه أصلاً فلا يمكن أن يظهرا في الناتج.
        $ref = StorefrontMediaRefNormalizer::normalize(array_intersect_key($raw, array_flip(['mediaId', 'focal', 'alt', 'decorative'])));
        if ($ref === null) {
            return null;
        }

        $image = ['mediaId' => $ref['mediaId']];
        $fit = self::inList($raw['fit'] ?? null, FacetVisualRegistry::FITS);
        if ($fit !== null) {
            $image['fit'] = $fit;
        }
        if (isset($ref['focal'])) {
            $image['focal'] = $ref['focal'];
        }
        $zoom = self::zoom($raw['zoom'] ?? null);
        if ($zoom !== null) {
            $image['zoom'] = $zoom;
        }
        if (isset($ref['alt'])) {
            $image['alt'] = $ref['alt'];
        }
        if (isset($ref['decorative'])) {
            $image['decorative'] = true;
        }

        return $image;
    }

    /** يُقصّ إلى [1، 3] ويُقرَّب لمنزلتين؛ 1 هو الافتراضي فلا يُخزَّن. */
    private static function zoom(mixed $value): int|float|null
    {
        if ((! is_int($value) && ! is_float($value)) || ! is_finite((float) $value)) {
            return null;
        }
        $zoom = round(min(FacetVisualRegistry::ZOOM_MAX, max(FacetVisualRegistry::ZOOM_MIN, (float) $value)), 2);
        if ($zoom === FacetVisualRegistry::ZOOM_MIN) {
            return null;
        }

        // 2.0 يُخزَّن 2 (لا 2.0) فيتطابق الترميز مع JSON في TS بايتاً ببايت.
        return floor($zoom) === $zoom ? (int) $zoom : $zoom;
    }

    // ───────────────────────────── التحقق الصارم (مسار الكتابة) ─────────────────────────────

    /**
     * أخطاء حقلية بترتيب ثابت. `null` لأي مفتاح يعني «ورِّث» وهو صالح دائماً.
     *
     * @param  'value'|'facet'  $kind
     * @return list<array{field:string,code:string}>
     */
    public static function errors(mixed $raw, string $kind): array
    {
        if (! self::object($raw)) {
            return [['field' => 'visual', 'code' => 'invalid_object']];
        }

        if ($kind === 'value') {
            return self::appearanceErrors($raw, self::VALUE_KEYS, '');
        }

        $errors = self::unknownKeys($raw, self::FACET_KEYS, '');
        foreach (['self' => self::VALUE_KEYS, 'defaults' => self::DEFAULTS_KEYS] as $part => $keys) {
            $value = $raw[$part] ?? null;
            if ($value === null) {
                continue;
            }
            if (! self::object($value)) {
                $errors[] = ['field' => $part, 'code' => 'invalid_object'];

                continue;
            }
            array_push($errors, ...self::appearanceErrors($value, $keys, $part.'.'));
        }

        return $errors;
    }

    /**
     * @param  list<string>  $keys
     * @return list<array{field:string,code:string}>
     */
    private static function appearanceErrors(array $raw, array $keys, string $prefix): array
    {
        $errors = self::unknownKeys($raw, $keys, $prefix);
        foreach ($keys as $key) {
            $value = $raw[$key] ?? null;
            if ($value === null) {
                continue;
            }
            if ($key === 'image') {
                array_push($errors, ...self::imageErrors($value, $prefix.'image'));

                continue;
            }
            if (self::field($key, $value) === null) {
                $errors[] = ['field' => $prefix.$key, 'code' => match ($key) {
                    'icon' => 'unknown_icon',
                    'shape' => 'unknown_shape',
                    'iconColor', 'background' => 'invalid_color',
                    default => 'invalid_value',
                }];
            }
        }

        return $errors;
    }

    /** @return list<array{field:string,code:string}> */
    private static function imageErrors(mixed $raw, string $field): array
    {
        if (! self::object($raw)) {
            return [['field' => $field, 'code' => 'invalid_object']];
        }

        $errors = [];
        foreach (['crop', 'rotate'] as $forbidden) {
            if (array_key_exists($forbidden, $raw)) {
                $errors[] = ['field' => $field.'.'.$forbidden, 'code' => 'forbidden'];
            }
        }
        foreach (array_keys($raw) as $key) {
            if (! in_array($key, self::IMAGE_KEYS, true) && ! in_array($key, ['crop', 'rotate'], true)) {
                $errors[] = ['field' => $field.'.'.$key, 'code' => 'unknown_field'];
            }
        }

        $id = $raw['mediaId'] ?? null;
        if (! is_string($id) || StorefrontMediaRefNormalizer::normalize(['mediaId' => $id]) === null) {
            $errors[] = ['field' => $field.'.mediaId', 'code' => 'invalid_media_id'];
        }
        if (($raw['fit'] ?? null) !== null && self::inList($raw['fit'], FacetVisualRegistry::FITS) === null) {
            $errors[] = ['field' => $field.'.fit', 'code' => 'invalid_value'];
        }
        if (($raw['focal'] ?? null) !== null) {
            try {
                StorefrontMediaTransform::fromInput(['focal' => $raw['focal']]);
            } catch (InvalidArgumentException) {
                $errors[] = ['field' => $field.'.focal', 'code' => 'invalid_value'];
            }
        }
        $zoom = $raw['zoom'] ?? null;
        if ($zoom !== null && ((! is_int($zoom) && ! is_float($zoom)) || ! is_finite((float) $zoom)
            || $zoom < FacetVisualRegistry::ZOOM_MIN || $zoom > FacetVisualRegistry::ZOOM_MAX)) {
            $errors[] = ['field' => $field.'.zoom', 'code' => 'out_of_range'];
        }
        $alt = $raw['alt'] ?? null;
        if ($alt !== null) {
            $valid = self::object($alt) && array_diff(array_keys($alt), ['ar', 'en']) === [];
            foreach ($valid ? ['ar', 'en'] : [] as $locale) {
                $text = $alt[$locale] ?? null;
                if ($text !== null && (! is_string($text) || mb_strlen($text) > StorefrontMediaRefNormalizer::ALT_MAX)) {
                    $valid = false;
                }
            }
            if (! $valid) {
                $errors[] = ['field' => $field.'.alt', 'code' => 'invalid_value'];
            }
        }
        if (($raw['decorative'] ?? null) !== null && ! is_bool($raw['decorative'])) {
            $errors[] = ['field' => $field.'.decorative', 'code' => 'invalid_value'];
        }

        return $errors;
    }

    /**
     * @param  list<string>  $allowed
     * @return list<array{field:string,code:string}>
     */
    private static function unknownKeys(array $raw, array $allowed, string $prefix): array
    {
        $errors = [];
        foreach (array_keys($raw) as $key) {
            if (! in_array($key, $allowed, true)) {
                $errors[] = ['field' => $prefix.$key, 'code' => 'unknown_field'];
            }
        }

        return $errors;
    }

    // ───────────────────────────── مساعدات ─────────────────────────────

    /** كائن JSON: مصفوفة ترابطية (الفارغة مقبولة)، لا قائمة. */
    private static function object(mixed $value): bool
    {
        return is_array($value) && ($value === [] || ! array_is_list($value));
    }

    /** @param  list<string>  $list */
    private static function inList(mixed $value, array $list): ?string
    {
        return is_string($value) && in_array($value, $list, true) ? $value : null;
    }

    /** `#RRGGBB` فقط، ويُخزَّن بحروف صغيرة فتتطابق الوثائق المتكافئة. */
    private static function hex(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $value = strtolower($value);

        return preg_match(self::HEX, $value) === 1 ? $value : null;
    }
}
