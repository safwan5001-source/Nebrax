<?php

namespace App\Support\Commerce;

/**
 * P3-A-06 — publish-time contrast policy for the document-level global background (`background`, P3-A-02).
 *
 * **Why a separate policy.** `SectionDesignContrast` judges a section's text against the section's own surface, or — with
 * no surface — against the legacy `backgroundColor`. It never looks at the document-level `background`, so text over a
 * global gradient or picture was unproven. This class judges the *actual paint* of the page, with the same engine
 * (`ContrastEngine`) and the same convention: the whole luminance range, never an average or the two ends alone; an
 * unproven result is a failed one.
 *
 * **What is judged.** The page foregrounds that render directly on the page paint (no surface of their own):
 *  - `text`  — `--store-foreground` `#111827`: page headings, body text, account/cart text (64 storefront files);
 *  - `muted` — `--store-muted-foreground` `#636a78`: breadcrumbs, captions, secondary text (62 files);
 *  - `brand` — the merchant's primary colour, used for links on the page;
 *  - plus every *explicit* text colour of a visible section that has no surface of its own.
 * Header, footer, announcement bar, category rail, mobile nav and product cards own an opaque surface and are not
 * depending on the page paint. The foreground tokens are fixed (the storefront has no dark page tokens), so the paint
 * must keep all of them above {@see ContrastEngine::TEXT_NORMAL}: in practice a light page.
 *
 * **Gradient.** `gradientInterval` over the two resolved colours: samples the whole line and widens the range by a proven
 * bound, so an interior dip (luminance is convex along a line) is caught even when both ends pass. The direction (and so
 * RTL/LTR) does not enter: where the text sits is unknown, so the whole range is judged.
 *
 * **Picture.** Worst-case pixel evidence of every picture that can be shown (desktop and phone, unioned) composited
 * with the overlay ({@see SectionDesignContrast::mediaInterval}) — plus the `backgroundColor` fallback that shows while a
 * picture loads or if it fails. Evidence absent, stale, translucent or unmeasured (animation) ⇒ unproven ⇒ rejected.
 *
 * Solid backgrounds (legacy `backgroundColor`, or an authored solid object) are outside this policy by design: they keep
 * their existing behaviour, so published and legacy documents are unchanged.
 */
final class GlobalBackgroundContrast
{
    /** `--store-foreground` in `storefront/src/app/globals.css`. */
    public const FOREGROUND_TEXT = '#111827';

    /** `--store-muted-foreground`. */
    public const FOREGROUND_MUTED = '#636a78';

    public const CODE_GRADIENT_INSUFFICIENT = 'global_gradient_contrast_insufficient';

    public const CODE_GRADIENT_UNRESOLVED = 'global_gradient_colour_unresolved';

    public const CODE_MEDIA_INSUFFICIENT = 'global_media_contrast_insufficient';

    public const CODE_MEDIA_UNPROVEN = 'global_media_contrast_unproven';

    public const CODE_MEDIA_ANIMATED = 'global_media_animated_unsupported';

    public const CODE_SECTION_TEXT = 'global_background_text_contrast_insufficient';

    /**
     * Page foregrounds by role.
     *
     * @param  array<string,mixed>  $normalized
     * @return array<string,string> role ⇒ `#rrggbb`
     */
    public static function foregrounds(array $normalized): array
    {
        $brand = is_string($normalized['primaryColor'] ?? null) && ContrastEngine::parseHex($normalized['primaryColor']) !== null
            ? $normalized['primaryColor']
            : '#12372a';

        return ['text' => self::FOREGROUND_TEXT, 'muted' => self::FOREGROUND_MUTED, 'brand' => $brand];
    }

    /**
     * The luminance range the page can paint, or why it cannot be proven. `interval` and `reason` are both null when the
     * document has no global gradient/picture (nothing to judge).
     *
     * @param  array<string,mixed>  $normalized
     * @return array{kind:?string, interval:?array{min:float,max:float}, reason:?string}
     */
    public static function paint(array $normalized, ?\Closure $media = null): array
    {
        $background = $normalized['background'] ?? null;
        $kind = is_array($background) ? ($background['kind'] ?? null) : null;
        $config = self::config($normalized);

        if ($kind === 'gradient') {
            $from = self::colour($background['from'] ?? null, $config);
            $to = self::colour($background['to'] ?? null, $config);
            if ($from === null || $to === null) {
                return ['kind' => 'gradient', 'interval' => null, 'reason' => 'colour_unresolved'];
            }

            return ['kind' => 'gradient', 'interval' => ContrastEngine::gradientInterval($from, $to), 'reason' => null];
        }

        if ($kind === 'media') {
            $picture = SectionDesignContrast::mediaInterval($background, $config, $media);
            if ($picture === null) {
                return ['kind' => 'media', 'interval' => null, 'reason' => 'unproven'];
            }
            // The fallback colour is what shows while the picture loads or if it never does.
            $fallback = ContrastEngine::parseHex((string) ($normalized['backgroundColor'] ?? ''))
                ?? ContrastEngine::parseHex(SectionDesignContrast::PAGE_BACKGROUND);
            $under = ContrastEngine::solidInterval($fallback);

            return [
                'kind' => 'media',
                'interval' => ['min' => min($picture['min'], $under['min']), 'max' => max($picture['max'], $under['max'])],
                'reason' => null,
            ];
        }

        return ['kind' => null, 'interval' => null, 'reason' => null];
    }

    /**
     * Foreground roles whose contrast is not proven over the paint.
     *
     * @param  array<string,string>  $foregrounds
     * @param  array{min:float,max:float}  $interval
     * @return list<string>
     */
    public static function failing(array $foregrounds, array $interval): array
    {
        $failing = [];
        foreach ($foregrounds as $role => $hex) {
            if (! ContrastEngine::passes(ContrastEngine::worstRatioForHex($hex, $interval))) {
                $failing[] = $role;
            }
        }

        return $failing;
    }

    /**
     * @param  array<string,mixed>  $normalized
     * @param  \Closure|null  $media  `MediaRef` ⇒ worst-case channel bounds, or null (= unproven)
     * @param  \Closure|null  $animated  `MediaRef` ⇒ whether the asset is animated (tenant-scoped lookup by the caller)
     * @return array<string, array{code: string, message: string}> path ⇒ error
     */
    public static function errors(array $normalized, ?\Closure $media = null, ?\Closure $animated = null): array
    {
        $background = $normalized['background'] ?? null;
        if (is_array($background) && ($background['kind'] ?? null) === 'media' && $animated !== null) {
            foreach ([$background['media'] ?? null, $background['mobile'] ?? null] as $ref) {
                if (is_array($ref) && $animated($ref) === true) {
                    // The global layer shows a still only, and an animation's later frames have no pixel evidence
                    // (full range): there is nothing to prove, so say so plainly instead of "overlay too weak".
                    return ['background' => [
                        'code' => self::CODE_MEDIA_ANIMATED,
                        'message' => 'الصور المتحركة لا تُستخدم كخلفية عامة للمتجر؛ اختر صورة ثابتة.',
                    ]];
                }
            }
        }

        $paint = self::paint($normalized, $media);
        if ($paint['kind'] === null) {
            return [];
        }

        if ($paint['interval'] === null) {
            return ['background' => $paint['kind'] === 'gradient'
                ? [
                    'code' => self::CODE_GRADIENT_UNRESOLVED,
                    'message' => 'تعذّر تحديد ألوان التدرج لإثبات التباين؛ اختر لونين صالحين.',
                ]
                : [
                    'code' => self::CODE_MEDIA_UNPROVEN,
                    'message' => 'تعذّر إثبات التباين فوق هذه الصورة (لا دليل بكسل صالح لها أو أنها متحركة أو شفافة أو غير جاهزة)؛ اختر صورة ثابتة معالَجة أو استخدم لوناً ثابتاً.',
                ]];
        }

        $errors = [];
        if (self::failing(self::foregrounds($normalized), $paint['interval']) !== []) {
            $errors['background'] = $paint['kind'] === 'gradient'
                ? [
                    'code' => self::CODE_GRADIENT_INSUFFICIENT,
                    'message' => 'نصوص المتجر لا تُقرأ بوضوح مؤكَّد فوق هذا التدرج على كامل مداه؛ اجعل لونيه أفتح.',
                ]
                : [
                    'code' => self::CODE_MEDIA_INSUFFICIENT,
                    'message' => 'نصوص المتجر لا تُقرأ بوضوح مؤكَّد فوق هذه الصورة؛ أضف تراكباً فاتحاً أقوى أو استخدم صورة أفتح.',
                ];
        }

        return $errors + self::sectionTextErrors($normalized, $paint['interval']);
    }

    /**
     * Explicit text colours of visible sections that sit directly on the page (no surface of their own) — judged against the
     * real paint instead of the legacy `backgroundColor`. Sections with their own background stay independent.
     *
     * @param  array<string,mixed>  $normalized
     * @param  array{min:float,max:float}  $interval
     * @return array<string, array{code: string, message: string}>
     */
    private static function sectionTextErrors(array $normalized, array $interval): array
    {
        $sections = $normalized['homepage']['sections'] ?? null;
        if (! is_array($sections)) {
            return [];
        }
        $config = self::config($normalized);
        $errors = [];
        foreach (array_values($sections) as $i => $section) {
            if (! is_array($section) || ($section['visible'] ?? false) !== true || ! is_array($section['design'] ?? null)) {
                continue;
            }
            $type = (string) ($section['type'] ?? '');
            $design = $section['design'];
            if (is_array($design['background'] ?? null)
                || in_array($type, SectionDesignContrast::SURFACE_OWNING_TYPES, true)
                || isset(SectionDesignContrast::LEGACY_SURFACE[$type])) {
                continue; // its text sits on a surface of its own
            }
            foreach (['body', 'heading', 'link'] as $field) {
                $rgb = self::colour($design['text'][$field] ?? null, $config);
                if ($rgb === null) {
                    continue;
                }
                $hex = sprintf('#%02x%02x%02x', $rgb[0], $rgb[1], $rgb[2]);
                if (! ContrastEngine::passes(ContrastEngine::worstRatioForHex($hex, $interval))) {
                    $errors["homepage.sections[{$i}].design.text.{$field}"] = [
                        'code' => self::CODE_SECTION_TEXT,
                        'message' => 'لون هذا النص لا يُقرأ بوضوح مؤكَّد فوق خلفية المتجر العامة؛ اختر لوناً أغمق.',
                    ];
                }
            }
        }

        return $errors;
    }

    /**
     * @param  array<string,mixed>  $normalized
     * @return array<string,mixed>
     */
    private static function config(array $normalized): array
    {
        return [
            'primaryColor' => $normalized['primaryColor'] ?? '#12372a',
            'accentColor' => $normalized['accentColor'] ?? null,
            'palette' => $normalized['palette'] ?? [],
        ];
    }

    /**
     * A `ColorRef` resolved against the approved palette; anything that cannot be resolved to a valid `#rrggbb` is `null`.
     *
     * @param  array<string,mixed>  $config
     * @return array{0:int,1:int,2:int}|null
     */
    private static function colour(mixed $ref, array $config): ?array
    {
        if (! is_array($ref)) {
            return null;
        }
        if (isset($ref['role']) && is_string($ref['role'])) {
            return ContrastEngine::parseHex(SectionDesignContrast::roleHex($ref['role'], $config));
        }

        return is_string($ref['hex'] ?? null) ? ContrastEngine::parseHex($ref['hex']) : null;
    }
}
