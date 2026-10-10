<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V6c-6 — بوّابة تباين لون زرّ الـCTA عند النشر (V0 §6.1 «تباين التسمية يتبع §4.5»).
 *
 * **السلطة (PHP)** لتوأم TS (`ctaColourIssues` في `cta-colour.ts`)، وكلاهما على
 * `tests/Fixtures/presentation/cta-colour.json`.
 *
 * ما يحتاج إثباتاً: زرّ **outline** أو **link** له `colour` صريح — تسميته بلون الدور نفسه مباشرةً فوق خلفية
 * القسم، فيُقاس مقابل مدى لمعان **ما سيُرسم خلفه** (خلفية التصميم صلبةً أو تدرّجاً أو صورةً مُثبَتة بتراكبها؛ وبلا
 * خلفية: تدرّج العلامة للبطل وسطح البانر الأبيض/سطح اللوحة). نمطا **solid** و**soft** يُحسب لتسميتهما لونٌ فوق
 * ملئهما المعتم فيمرّان بالبناء. زرٌّ بلا `colour` يتبع ألوان القسم المُثبَتة أصلاً. غير المُثبَت = غير مطابق.
 * يُحكم فقط على الزرّ الذي سيُرسم (تسمية ورابط)، وعلى نمطه الفعلي (الغائب = بالموضع بين المرسومة: الأول solid والثاني outline).
 */
final class CtaColourContrast
{
    public const BANNER_SURFACE = '#ffffff';

    /** كما `heroGradientInterval` في TS: تدرّج العلامة 700 ← 600 ← 500 للبطل بلا خلفية تصميم. */
    public static function heroGradientInterval(string $brand): ?array
    {
        $c = ContrastEngine::parseHex($brand);
        $dark = ContrastEngine::parseHex(SectionDesignContrast::mixHex($brand, '#000000', 0.18));
        $light = ContrastEngine::parseHex(SectionDesignContrast::mixHex($brand, '#ffffff', 0.18));
        if ($c === null || $dark === null || $light === null) {
            return null;
        }
        $a = ContrastEngine::gradientInterval($dark, $c);
        $b = ContrastEngine::gradientInterval($c, $light);

        return ['min' => min($a['min'], $b['min']), 'max' => max($a['max'], $b['max'])];
    }

    /**
     * ما خلف الزرّ: قائمة مدىً (يُحكَم على أسوأها)، أو `null` = غير مُثبَت.
     *
     * @param  array<string,mixed>|null  $design
     * @param  array<string,mixed>  $config
     * @return list<array{min:float,max:float}>|null
     */
    public static function backdrops(string $type, ?array $design, array $config, ?\Closure $media = null): ?array
    {
        if (is_array($design) && is_array($design['background'] ?? null)) {
            $background = SectionDesignContrast::effectiveText($design, $config, $type, $media)['background'];

            return $background === null ? null : [$background];
        }
        if ($type === 'hero') {
            $gradient = self::heroGradientInterval(is_string($config['primaryColor'] ?? null) ? $config['primaryColor'] : '#12372a');

            return $gradient === null ? null : [$gradient];
        }
        $hexes = [self::BANNER_SURFACE];
        $palette = is_array($config['palette'] ?? null) ? $config['palette'] : [];
        if (is_string($palette['surface'] ?? null) && ContrastEngine::parseHex($palette['surface']) !== null) {
            $hexes[] = $palette['surface'];
        }

        return array_map(static fn (string $hex): array => ContrastEngine::solidInterval(ContrastEngine::parseHex($hex)), $hexes);
    }

    /**
     * @param  list<array<string,mixed>>  $ctas
     * @param  array<string,mixed>|null  $design
     * @param  array<string,mixed>  $config  primaryColor / accentColor / palette
     * @return list<array{index:int,code:string,ratio:float}>
     */
    public static function issues(string $type, array $ctas, ?array $design, array $config, ?\Closure $media = null): array
    {
        if (! in_array($type, ['hero', 'banner'], true)) {
            return [];
        }
        $out = [];
        $backdrops = false; // كسول: تُحسب مرةً عند أول زرٍّ يُحكَم عليه
        $position = -1; // ترتيب الزرّ بين **المرسومة** (كما يفعل العرض): الأول solid والثاني outline
        foreach (array_values($ctas) as $index => $cta) {
            if (! is_array($cta)) {
                continue;
            }
            if (trim((string) ($cta['label'] ?? '')) === '' || ($cta['href'] ?? '') === '') {
                continue; // مسودة ناقصة لا تُرسم ولا تأخذ موضعاً
            }
            $position++;
            if (! is_string($cta['colour'] ?? null)) {
                continue;
            }
            $style = is_string($cta['style'] ?? null) ? $cta['style'] : ($position === 0 ? 'solid' : 'outline');
            if ($style !== 'outline' && $style !== 'link') {
                continue;
            }
            if ($backdrops === false) {
                $backdrops = self::backdrops($type, $design, $config, $media);
            }
            if ($backdrops === null) {
                $out[] = ['index' => $index, 'code' => 'contrast_unprovable', 'ratio' => 1.0];

                continue;
            }
            $hex = SectionDesignContrast::roleHex($cta['colour'], $config);
            $worst = null;
            foreach ($backdrops as $interval) {
                $ratio = ContrastEngine::worstRatioForHex($hex, $interval);
                $worst = $worst === null ? $ratio : min($worst, $ratio);
            }
            if (! ContrastEngine::passes((float) $worst)) {
                $out[] = ['index' => $index, 'code' => 'contrast_insufficient', 'ratio' => round((float) $worst, 4)];
            }
        }

        return $out;
    }

    /**
     * @param  array<string,mixed>  $normalized  وثيقة معيّرة
     * @param  \Closure|null  $media  حدود لمعان مرجع صورة (كما `SectionDesignContrast::errors`)
     * @return array<string, array{code:string,message:string}>
     */
    public static function errors(array $normalized, ?\Closure $media = null): array
    {
        $sections = $normalized['homepage']['sections'] ?? null;
        if (! is_array($sections)) {
            return [];
        }
        $config = [
            'primaryColor' => $normalized['primaryColor'] ?? '#12372a',
            'accentColor' => $normalized['accentColor'] ?? null,
            'palette' => $normalized['palette'] ?? [],
        ];
        $errors = [];
        foreach (array_values($sections) as $i => $section) {
            if (! is_array($section) || ($section['visible'] ?? false) !== true || ! is_array($section['content']['ctas'] ?? null)) {
                continue; // قسمٌ مخفي لا يُنشر فلا يُحجَب به النشر.
            }
            $type = is_string($section['type'] ?? null) ? $section['type'] : '';
            $design = is_array($section['design'] ?? null) ? $section['design'] : null;
            foreach (self::issues($type, $section['content']['ctas'], $design, $config, $media) as $issue) {
                $errors["homepage.sections[{$i}].content.ctas[{$issue['index']}].colour"] = [
                    'code' => $issue['code'],
                    'message' => $issue['code'] === 'contrast_unprovable'
                        ? 'لا يمكن إثبات وضوح لون هذا الزرّ فوق خلفية القسم — غيّر الخلفية أو اختر نمط «مملوء».'
                        : 'تباين لون الزرّ مع خلفية القسم أقل من 4.5:1 ولا يمكن نشره — اختر لوناً آخر أو نمط «مملوء».',
                ];
            }
        }

        return $errors;
    }
}
