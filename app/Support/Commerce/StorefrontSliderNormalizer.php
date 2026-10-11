<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V8a — محتوى قسم الشرائح `slider` (V0 §13.1، D-16). السلطة PHP؛ توأماها `…/presentation/slider-content.ts`
 * (متطابقان حرفياً في web وstorefront) بنفس الفيكستشر `tests/Fixtures/presentation/slider.json`.
 *
 * ```
 * content = { slides: Slide[2-8 في النشر، حتى 8 في المسودة], behaviour?: Behaviour }
 * Slide   = { id, media: MediaRef, mobile?: MediaRef, heading?, sub?, cta?: {label, href}, overlay?, text?: ColorRef, align? }
 * ```
 *
 * قرارات AWJ (ما تركه V0 مفتوحاً — ليست تغييراً لعقد):
 *  - **صورة الشريحة** تحتفظ بـ`alt`/`decorative` (قد تكون صورةً ذات معنى) وتُسقط `fit` دائماً: تأطير `contain` يكشف سطحاً لا يغطّيه
 *    دليل لمعان الصورة فيُبطل إثبات التباين (كخلفية البطل). صورة `mobile` تشاركها نصّها البديل (نفس المحتوى، فن إخراج لا محتوى
 *    ثانٍ) فتُوسَم `decorative` وبلا `alt`/`fit` فلا تطلب البوابة نصّاً بديلاً ثانياً.
 *  - **لا مفاتيح خارج القائمة** (url/style/…)؛ كل حقل يسقط وحده، وشريحة بلا مرجع صورة صالح تسقط كلّها.
 *  - **السلوك** لا يُخزَّن منه إلا ما يخالف الافتراضي (autoplay=false، interval=6، transition=slide، duration=base، arrows=true،
 *    dots=true، loop=false) فتتطابق الوثائق المتكافئة حرفياً. `interval` لا معنى له بلا `autoplay` فيسقط.
 *  - النص يُحفظ كما كُتب (قصٌّ بنقاط الترميز فقط؛ المحرّر يعيد التطبيع عند كل ضغطة) والفراغ وحده يُختزل إلى غياب.
 *  - زرّ الشريحة تسمية + رابط فقط: شكله دائماً الزرّ الأساسي المصمَّت (تسميته تُحسب فوق تعبئته فتمرّ بالبناء)، فلا
 *    `style`/`colour` لكل شريحة بعد (مؤجَّل).
 */
final class StorefrontSliderNormalizer
{
    public const MAX_SLIDES = 8;

    public const MIN_SLIDES_TO_PUBLISH = 2;

    public const MAX_HEADING = 120;

    public const MAX_SUB = 200;

    public const MAX_CTA_LABEL = 80;

    public const INTERVALS = [5, 6, 8, 10];

    public const DEFAULT_INTERVAL = 6;

    public const TRANSITIONS = ['slide', 'fade', 'none'];

    public const DURATIONS = ['fast', 'base', 'slow'];

    /**
     * @param  \Closure(string):string  $sanitizeHref  قواعد روابط المحتوى المشتركة (`sanitizeContentHref`)
     * @return array{slides: list<array<string,mixed>>, behaviour?: array<string,mixed>}|null
     */
    public static function normalize(mixed $raw, \Closure $sanitizeHref): ?array
    {
        if (! is_array($raw) || ($raw !== [] && array_is_list($raw))) {
            return null;
        }

        $slides = [];
        $seen = [];
        foreach (array_values(is_array($raw['slides'] ?? null) ? $raw['slides'] : []) as $index => $slide) {
            if (! is_array($slide) || array_is_list($slide)) {
                continue;
            }
            $normalized = self::slide($slide, $index, $sanitizeHref);
            if ($normalized === null || isset($seen[$normalized['id']])) {
                continue;
            }
            $seen[$normalized['id']] = true;
            $slides[] = $normalized;
            if (count($slides) >= self::MAX_SLIDES) {
                break;
            }
        }
        if ($slides === []) {
            return null;
        }

        $content = ['slides' => $slides];
        $behaviour = self::behaviour($raw['behaviour'] ?? null);
        if ($behaviour !== []) {
            $content['behaviour'] = $behaviour;
        }

        return $content;
    }

    /**
     * @param  array<string,mixed>  $raw
     * @return array<string,mixed>|null
     */
    private static function slide(array $raw, int $index, \Closure $sanitizeHref): ?array
    {
        $media = StorefrontMediaRefNormalizer::normalize($raw['media'] ?? null);
        if ($media === null) {
            return null;
        }
        unset($media['fit']);

        $id = is_string($raw['id'] ?? null) ? self::phpTrim($raw['id']) : '';
        if (preg_match('/\A[a-zA-Z0-9_-]{1,64}\z/', $id) !== 1) {
            $id = 'slide-'.$index;
        }

        $slide = ['id' => $id, 'media' => $media];

        $mobile = StorefrontSectionDesignNormalizer::backgroundRef($raw['mobile'] ?? null);
        if ($mobile !== null) {
            $slide['mobile'] = $mobile;
        }
        $heading = self::text($raw['heading'] ?? null, self::MAX_HEADING);
        if ($heading !== '') {
            $slide['heading'] = $heading;
        }
        $sub = self::text($raw['sub'] ?? null, self::MAX_SUB);
        if ($sub !== '') {
            $slide['sub'] = $sub;
        }
        $cta = self::cta($raw['cta'] ?? null, $sanitizeHref);
        if ($cta !== null) {
            $slide['cta'] = $cta;
        }
        $overlay = StorefrontSectionDesignNormalizer::overlay($raw['overlay'] ?? null);
        if ($overlay !== null) {
            $slide['overlay'] = $overlay;
        }
        $text = StorefrontSectionDesignNormalizer::colorRef($raw['text'] ?? null);
        if ($text !== null) {
            $slide['text'] = $text;
        }
        if (is_string($raw['align'] ?? null) && in_array($raw['align'], StorefrontSectionDesignNormalizer::ALIGNS, true)) {
            $slide['align'] = $raw['align'];
        }

        return $slide;
    }

    /** @return array{label: string, href: string}|null */
    private static function cta(mixed $raw, \Closure $sanitizeHref): ?array
    {
        if (! is_array($raw) || array_is_list($raw)) {
            return null;
        }
        $label = self::text($raw['label'] ?? null, self::MAX_CTA_LABEL);
        $href = $sanitizeHref(is_string($raw['href'] ?? null) ? $raw['href'] : '');
        // المسودة الناقصة تُحفظ (يُعرض المكتمل فقط)؛ الفارغ كلياً يسقط.
        if ($label === '' && $href === '') {
            return null;
        }

        return ['label' => $label, 'href' => $href];
    }

    /** @return array<string,mixed> */
    private static function behaviour(mixed $raw): array
    {
        if (! is_array($raw) || ($raw !== [] && array_is_list($raw))) {
            return [];
        }

        $out = [];
        $autoplay = ($raw['autoplay'] ?? null) === true;
        if ($autoplay) {
            $out['autoplay'] = true;
            $interval = $raw['interval'] ?? null;
            if (is_float($interval) && is_finite($interval) && floor($interval) === $interval) {
                $interval = (int) $interval;
            }
            if (is_int($interval) && in_array($interval, self::INTERVALS, true) && $interval !== self::DEFAULT_INTERVAL) {
                $out['interval'] = $interval;
            }
        }
        if (in_array($raw['transition'] ?? null, ['fade', 'none'], true)) {
            $out['transition'] = $raw['transition'];
        }
        if (in_array($raw['duration'] ?? null, ['fast', 'slow'], true)) {
            $out['duration'] = $raw['duration'];
        }
        if (($raw['arrows'] ?? null) === false) {
            $out['arrows'] = false;
        }
        if (($raw['dots'] ?? null) === false) {
            $out['dots'] = false;
        }
        if (($raw['loop'] ?? null) === true) {
            $out['loop'] = true;
        }

        return $out;
    }

    private static function text(mixed $value, int $max): string
    {
        if (! is_string($value) || trim($value) === '') {
            return '';
        }

        return mb_substr($value, 0, $max);
    }

    private static function phpTrim(string $value): string
    {
        return trim($value);
    }
}
