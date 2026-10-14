<?php

namespace App\Support\Commerce;

/**
 * AWJ-VD-H1 / VD-1a — حلّ الهوية المرئية الفعلية للقيمة وللبُعد (§3.6، D-08).
 *
 * **كل خاصية تُحلّ بسلسلتها المستقلة**؛ لا «حزمة» تُورث أو تُلغى معاً. فتخصيص الصورة على قيمة لا يمسّ
 * وراثة الشكل أو الحجم أو الاسم أو الأيقونة الاحتياطية. السلاسل (الأول المُعرَّف يفوز):
 *
 * - `shape` / `size` / `showLabel`: القسم (صريح) → القيمة → افتراضات البُعد → قالب القسم → النظام.
 * - `content`: القيمة (صريح) → ضمني من وسائط القيمة (صورة ⇒ image، وإلا أيقونة ⇒ icon) → افتراضات البُعد → `none`.
 * - `icon`: القيمة → افتراضات البُعد. `iconColor` / `background`: القيمة → افتراضات البُعد → رموز السمة (غياب).
 * - `image`: القيمة فقط (**لا تُورث**). `image.fit`: القيمة → افتراضات البُعد → `cover`.
 *
 * ثم **السقوط وقت العرض** (منفصل عن الوراثة ولا يغيّر المخزَّن): `image` بلا صورة صالحة → الأيقونة المحلولة →
 * `none`؛ `icon` بلا أيقونة → `none`. الشكل والحجم والاسم المحلولة تبقى كما هي في كل مرحلة. وحين يُعرض `image` تُرفَق
 * `fallbackIcon` (ولونها) إن وُجدت أيقونة محلولة، ليسقط العارض إليها إن فشل تحميل الصورة في المتصفح.
 *
 * دالة نقيّة: لا قاعدة بيانات. صلاحية الصور تُمرَّر في `$context['usableMediaIds']` (قائمة المعرّفات الجاهزة
 * المملوكة للمستأجر؛ `null` = افترض الصلاحية، للمعاينة). توأمها `resolveFacetValueVisual` /
 * `resolveFacetSelfVisual` في `facet-visual.ts` بالفيكستشر `tests/Fixtures/presentation/facet-visual-inheritance.json`.
 *
 * @phpstan-type Context array{section?: array<string,mixed>, template?: array<string,mixed>, usableMediaIds?: list<string>|null}
 */
final class CommerceFacetVisualResolver
{
    /** الخصائص الهندسية التي يملك القسم والقالب رأياً فيها. */
    private const LAYOUT_KEYS = ['shape', 'size', 'showLabel'];

    /**
     * @param  array<string,mixed>  $facetVisual  هوية البُعد (تُطبَّع هنا دفاعياً)
     * @param  array<string,mixed>  $valueVisual  هوية القيمة (تُطبَّع هنا دفاعياً)
     * @param  Context  $context
     * @return array{visual: array<string,mixed>, sources: array<string,string|null>}
     */
    public static function resolveValue(array $facetVisual, array $valueVisual, array $context = []): array
    {
        $facet = CommerceFacetVisualNormalizer::normalizeFacet($facetVisual);
        $value = CommerceFacetVisualNormalizer::normalizeValue($valueVisual);
        $defaults = $facet['defaults'] ?? [];

        return self::resolve(
            own: $value,
            inherited: $defaults,
            section: self::layout($context['section'] ?? null),
            template: self::layout($context['template'] ?? null),
            usable: $context['usableMediaIds'] ?? null,
        );
    }

    /**
     * مظهر البُعد نفسه (بطاقته/غلافه): `self` → القالب → النظام. مستقل تماماً عن `defaults`.
     *
     * @param  array<string,mixed>  $facetVisual
     * @param  Context  $context
     * @return array{visual: array<string,mixed>, sources: array<string,string|null>}
     */
    public static function resolveFacetSelf(array $facetVisual, array $context = []): array
    {
        $facet = CommerceFacetVisualNormalizer::normalizeFacet($facetVisual);

        return self::resolve(
            own: $facet['self'] ?? [],
            inherited: [],
            section: [],
            template: self::layout($context['template'] ?? null),
            usable: $context['usableMediaIds'] ?? null,
        );
    }

    /**
     * @param  array<string,mixed>  $own
     * @param  array<string,mixed>  $inherited
     * @param  array<string,mixed>  $section
     * @param  array<string,mixed>  $template
     * @param  list<string>|null  $usable
     * @return array{visual: array<string,mixed>, sources: array<string,string|null>}
     */
    private static function resolve(array $own, array $inherited, array $section, array $template, ?array $usable): array
    {
        $sources = [];

        // ── المحتوى المطلوب (قبل السقوط) ──
        if (isset($own['content'])) {
            [$requested, $sources['content']] = [$own['content'], 'value'];
        } elseif (isset($own['image'])) {
            [$requested, $sources['content']] = ['image', 'implicit'];
        } elseif (isset($own['icon'])) {
            [$requested, $sources['content']] = ['icon', 'implicit'];
        } elseif (isset($inherited['content'])) {
            [$requested, $sources['content']] = [$inherited['content'], 'facet'];
        } else {
            [$requested, $sources['content']] = [FacetVisualRegistry::DEFAULT_CONTENT, 'system'];
        }

        [$icon, $sources['icon']] = self::pick('icon', $own, $inherited);
        [$iconColor, $sources['iconColor']] = self::pick('iconColor', $own, $inherited);
        [$background, $sources['background']] = self::pick('background', $own, $inherited);

        // ── السقوط وقت العرض ──
        $image = $own['image'] ?? null;
        // المعرّفات المخزَّنة مطبَّعة بحروف صغيرة؛ القائمة الواردة تُطبَّع مثلها فلا يسقط وسيطٌ صالح بسبب حالة الأحرف.
        $imageUsable = $image !== null && ($usable === null
            || in_array($image['mediaId'], array_map(static fn ($id) => is_string($id) ? strtolower(trim($id)) : $id, $usable), true));
        $content = $requested;
        if ($content === 'image' && ! $imageUsable) {
            $content = 'icon';
        }
        if ($content === 'icon' && $icon === null) {
            $content = 'none';
        }
        $sources['fallback'] = $content === $requested ? null : $requested;

        $visual = ['content' => $content];

        if ($content === 'image') {
            $fit = $image['fit'] ?? $inherited['fit'] ?? FacetVisualRegistry::DEFAULT_FIT;
            $sources['fit'] = isset($image['fit']) ? 'value' : (isset($inherited['fit']) ? 'facet' : 'system');
            $visual['image'] = array_filter([
                'mediaId' => $image['mediaId'],
                'fit' => $fit,
                'focal' => $image['focal'] ?? null,
                'zoom' => $image['zoom'] ?? null,
                'alt' => $image['alt'] ?? null,
                'decorative' => $image['decorative'] ?? null,
            ], static fn ($v) => $v !== null);
        } else {
            $sources['fit'] = null;
        }
        if ($content === 'image' && $icon !== null) {
            // VD-2: احتياطي العرض إن فشل تحميل الصورة في المتصفح (صورة ← أيقونة ← نص)؛ الخادم وحده يعرف الأيقونة المحلولة.
            $visual['fallbackIcon'] = $icon;
        }
        if ($content === 'icon') {
            $visual['icon'] = $icon;
        }
        if ($iconColor !== null && ($content === 'icon' || isset($visual['fallbackIcon']))) {
            $visual['iconColor'] = $iconColor;
        }
        // الخلفية تظهر خلف الأيقونة والنص وخلف الصورة عند `contain`، وهي أيضاً العنصر النائب خلف أي صورة حتى تُحمَّل؛
        // لذلك تُخرَج كلما عُرِّفت، والعارض يقرّر ما يظهر. غيابها = رموز السمة.
        if ($background !== null) {
            $visual['background'] = $background;
        }

        foreach (self::LAYOUT_KEYS as $key) {
            if (array_key_exists($key, $section)) {
                [$visual[$key], $sources[$key]] = [$section[$key], 'section'];
            } elseif (array_key_exists($key, $own)) {
                [$visual[$key], $sources[$key]] = [$own[$key], 'value'];
            } elseif (array_key_exists($key, $inherited)) {
                [$visual[$key], $sources[$key]] = [$inherited[$key], 'facet'];
            } elseif (array_key_exists($key, $template)) {
                [$visual[$key], $sources[$key]] = [$template[$key], 'template'];
            } else {
                [$visual[$key], $sources[$key]] = [self::systemDefault($key), 'system'];
            }
        }

        return ['visual' => $visual, 'sources' => $sources];
    }

    /**
     * @param  array<string,mixed>  $own
     * @param  array<string,mixed>  $inherited
     * @return array{0:mixed,1:string|null}
     */
    private static function pick(string $key, array $own, array $inherited): array
    {
        if (array_key_exists($key, $own)) {
            return [$own[$key], 'value'];
        }
        if (array_key_exists($key, $inherited)) {
            return [$inherited[$key], 'facet'];
        }

        return [null, null];
    }

    /**
     * يقبل من القسم أو القالب `shape`/`size`/`showLabel` الصالحة فقط (عبر قواعد التطبيع نفسها).
     *
     * @return array<string,mixed>
     */
    private static function layout(mixed $raw): array
    {
        if (! is_array($raw)) {
            return [];
        }
        $normalized = CommerceFacetVisualNormalizer::normalizeValue(array_intersect_key($raw, array_flip(self::LAYOUT_KEYS)));

        return array_intersect_key($normalized, array_flip(self::LAYOUT_KEYS));
    }

    private static function systemDefault(string $key): string|bool
    {
        return match ($key) {
            'shape' => FacetVisualRegistry::DEFAULT_SHAPE,
            'size' => FacetVisualRegistry::DEFAULT_SIZE,
            default => FacetVisualRegistry::DEFAULT_SHOW_LABEL,
        };
    }
}
