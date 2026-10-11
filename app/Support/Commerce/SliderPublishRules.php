<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V8a — قواعد نشر قسم الشرائح (V0 §13.1 + §4.5). السلطة هنا؛ المحرّر يعرض نتيجةً استشاريةً بتوأم TS
 * (`sliderPublishIssues` في `slider-content.ts`) على الحساب نفسه، والتكافؤ محروس بفيكستشر مشترك.
 *
 *  1. شريحتان على الأقل (V0: 2–8) لكل قسمٍ ظاهر — واحدةٌ هي بطلٌ لا شرائح. المسودة تقبل ما دون ذلك.
 *  2. **التباين**: لكل شريحةٍ ظاهرة تحمل نصاً (عنوان/فرعي/زرّ مكتمل) يُحكَم لون نصّها (الصريح أو التلقائي: الأبيض/الأسود
 *     الأفضل إثباتاً) على **مدى** لمعان صورتها (الافتراضية + الجوّال) تحت تراكبها — بالخوارزمية ذاتها لخلفية البطل
 *     (`SectionDesignContrast::issues` على تصميمٍ افتراضي)، فلا خوارزمية ثانية. «غير مُثبَت» = «غير مطابق».
 *     شريحةٌ بلا نصٍّ لا تُحكَم (لا شيء يُقرأ فوقها).
 */
final class SliderPublishRules
{
    /**
     * @param  array<string,mixed>  $normalized
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
            if (! is_array($section) || ($section['type'] ?? null) !== 'slider' || ($section['visible'] ?? false) !== true) {
                continue; // قسمٌ مخفي لا يُعرض فلا يحجب النشر.
            }
            $slides = is_array($section['content']['slides'] ?? null) ? array_values($section['content']['slides']) : [];
            $base = "homepage.sections[{$i}].content.slides";
            if (count($slides) < StorefrontSliderNormalizer::MIN_SLIDES_TO_PUBLISH) {
                $errors[$base] = [
                    'code' => 'slider_slides_min',
                    'message' => 'يتطلب قسم الشرائح شريحتين على الأقل قبل النشر.',
                ];

                continue;
            }
            foreach ($slides as $j => $slide) {
                if (! is_array($slide) || ! self::hasText($slide)) {
                    continue;
                }
                foreach (SectionDesignContrast::issues(self::pseudoDesign($slide), $config, null, $media) as $issue) {
                    $path = $issue['field'] === 'background' ? "{$base}[{$j}].media" : "{$base}[{$j}].text";
                    $errors[$path] = [
                        'code' => $issue['code'],
                        'message' => $issue['code'] === 'contrast_unprovable'
                            ? 'لا يمكن إثبات وضوح النص فوق صورة هذه الشريحة — أضف تراكباً أغمق أو اختر صورة أخرى.'
                            : 'التباين بين لون النص وصورة الشريحة أقل من 4.5:1 ولا يمكن نشره.',
                    ];
                }
            }
        }

        return $errors;
    }

    /**
     * ما يقرؤه الزائر فوق الصورة: عنوان أو فرعي أو زرّ مكتمل (تسمية + رابط). مسودة الزرّ الناقصة لا تُعرض فلا تُحكَم.
     *
     * @param  array<string,mixed>  $slide
     */
    public static function hasText(array $slide): bool
    {
        $cta = $slide['cta'] ?? null;

        return (is_string($slide['heading'] ?? null) && trim($slide['heading']) !== '')
            || (is_string($slide['sub'] ?? null) && trim($slide['sub']) !== '')
            || (is_array($cta) && trim((string) ($cta['label'] ?? '')) !== '' && trim((string) ($cta['href'] ?? '')) !== '');
    }

    /**
     * @param  array<string,mixed>  $slide
     * @return array<string,mixed>
     */
    public static function pseudoDesign(array $slide): array
    {
        $background = ['kind' => 'media', 'media' => $slide['media'] ?? null];
        if (isset($slide['mobile'])) {
            $background['mobile'] = $slide['mobile'];
        }
        if (isset($slide['overlay'])) {
            $background['overlay'] = $slide['overlay'];
        }
        $design = ['background' => $background];
        if (isset($slide['text'])) {
            $design['text'] = ['body' => $slide['text']];
        }

        return $design;
    }
}
