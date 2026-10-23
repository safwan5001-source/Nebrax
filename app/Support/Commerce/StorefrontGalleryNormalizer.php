<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V8d — محتوى قسم المعرض `gallery` (V0 §13.2، D-24). السلطة PHP؛ توأماها `…/presentation/gallery-content.ts`
 * (متطابقان حرفياً في web وstorefront) بنفس الفيكستشر `tests/Fixtures/presentation/gallery.json`.
 *
 * ```
 * content = { images: Image[2-24 في النشر، حتى 24 في المسودة], options?: Options }
 * Image   = { id, media: MediaRef, caption?: string, link?: string }
 * Options = { columns?: 2|4|6, aspect?: '4:3'|'16:9'|'4:5', gap?: 'none'|'xs'|'sm'|'lg'|'xl', captions?: true, lightbox?: true, showMotionControls?: true }
 * ```
 * والتخطيط `grid | carousel` يعيش في `design.layout` (V0 §3.4: الغياب = شبكة، `carousel` وحده يُخزَّن).
 *
 * قرارات AWJ (ما تركه V0 مفتوحاً — ليست تغييراً لعقد):
 *  - **صورة المعرض** تحتفظ بـ`MediaRef` كاملاً (alt/decorative/تأطير/`fit`): لا نصّ فوقها فلا دليل لمعان يُبطله `contain`،
 *    والنص البديل لكل لغة تحرسه بوابة الوسائط العامة (AMEND-10/14) بلا مسارٍ جديد.
 *  - **الإعدادات** لا يُخزَّن منها إلا ما يخالف الافتراضي (3 أعمدة، 1:1، فجوة md، بلا تعليقات، بلا lightbox) فتتطابق الوثائق
 *    المتكافئة حرفياً. المفاتيح خارج القائمة تسقط واحداً واحداً؛ وصورةٌ بلا مرجع صالح تسقط كلّها.
 *  - **`showMotionControls`** (AWJ-ANIMATED-MEDIA، يخصّ المعرض وحده): يُخزَّن `true` فقط حين يختاره التاجر، فلا يدخل مفتاحٌ جديد وثيقةً قديمة
 *    ولا يتغيّر بايت منشور. الغياب = بلا زرّ إيقاف ظاهر، وعندها يقصر المتجر الحركة على مهلة تشغيل محدودة (WCAG 2.2.2)؛ وتفعيله
 *    يُظهر زرّ إيقاف/تشغيل واحداً للمعرض. لا أثر له على معرضٍ بلا صورة متحركة.
 *  - **التعليق** نصٌّ بلغة المتجر (كعناوين الشرائح): يُحفظ كما كُتب بقصٍّ بنقاط الترميز، والفراغ وحده غياب. يُعرض فقط حين
 *    `captions` مفعّل، لكنه يُحفظ دائماً فلا يضيع بتبديل الخيار.
 *  - **الرابط** per-image عبر قواعد روابط المحتوى المشتركة (`sanitizeContentHref`) فلا `javascript:` ولا مضيف خارجي غير آمن.
 *    حين يجتمع رابطٌ مع `lightbox`، الصورة ذات الرابط تبقى رابطاً (اختيارٌ صريح من التاجر) وغيرها تفتح العارض.
 *  - لا masonry بأعمدة CSS ولا collage (مؤجَّلان في V0) — لا مفتاح لهما في العقد.
 */
final class StorefrontGalleryNormalizer
{
    public const MAX_IMAGES = 24;

    public const MIN_IMAGES_TO_PUBLISH = 2;

    public const MAX_CAPTION = 120;

    public const COLUMNS = [2, 3, 4, 6];

    public const DEFAULT_COLUMNS = 3;

    public const ASPECTS = ['1:1', '4:3', '16:9', '4:5'];

    public const DEFAULT_ASPECT = '1:1';

    public const GAPS = ['none', 'xs', 'sm', 'md', 'lg', 'xl'];

    public const DEFAULT_GAP = 'md';

    /**
     * @param  \Closure(string):string  $sanitizeHref  قواعد روابط المحتوى المشتركة (`sanitizeContentHref`)
     * @return array{images: list<array<string,mixed>>, options?: array<string,mixed>}|null
     */
    public static function normalize(mixed $raw, \Closure $sanitizeHref): ?array
    {
        if (! is_array($raw) || ($raw !== [] && array_is_list($raw))) {
            return null;
        }

        $images = [];
        $seen = [];
        foreach (array_values(is_array($raw['images'] ?? null) ? $raw['images'] : []) as $index => $image) {
            if (! is_array($image) || array_is_list($image)) {
                continue;
            }
            $normalized = self::image($image, $index, $sanitizeHref);
            if ($normalized === null || isset($seen[$normalized['id']])) {
                continue;
            }
            $seen[$normalized['id']] = true;
            $images[] = $normalized;
            if (count($images) >= self::MAX_IMAGES) {
                break;
            }
        }
        if ($images === []) {
            return null;
        }

        $content = ['images' => $images];
        $options = self::options($raw['options'] ?? null);
        if ($options !== []) {
            $content['options'] = $options;
        }

        return $content;
    }

    /**
     * @param  array<string,mixed>  $raw
     * @return array<string,mixed>|null
     */
    private static function image(array $raw, int $index, \Closure $sanitizeHref): ?array
    {
        $media = StorefrontMediaRefNormalizer::normalize($raw['media'] ?? null);
        if ($media === null) {
            return null;
        }

        $id = is_string($raw['id'] ?? null) ? trim($raw['id']) : '';
        if (preg_match('/\A[a-zA-Z0-9_-]{1,64}\z/', $id) !== 1) {
            $id = 'image-'.$index;
        }

        $image = ['id' => $id, 'media' => $media];

        $caption = self::text($raw['caption'] ?? null, self::MAX_CAPTION);
        if ($caption !== '') {
            $image['caption'] = $caption;
        }
        $link = $sanitizeHref(is_string($raw['link'] ?? null) ? $raw['link'] : '');
        if ($link !== '') {
            $image['link'] = $link;
        }

        return $image;
    }

    /** @return array<string,mixed> */
    private static function options(mixed $raw): array
    {
        if (! is_array($raw) || ($raw !== [] && array_is_list($raw))) {
            return [];
        }

        $out = [];
        $columns = $raw['columns'] ?? null;
        if (is_float($columns) && is_finite($columns) && floor($columns) === $columns) {
            $columns = (int) $columns;
        }
        if (is_int($columns) && in_array($columns, self::COLUMNS, true) && $columns !== self::DEFAULT_COLUMNS) {
            $out['columns'] = $columns;
        }
        if (is_string($raw['aspect'] ?? null) && in_array($raw['aspect'], self::ASPECTS, true) && $raw['aspect'] !== self::DEFAULT_ASPECT) {
            $out['aspect'] = $raw['aspect'];
        }
        if (is_string($raw['gap'] ?? null) && in_array($raw['gap'], self::GAPS, true) && $raw['gap'] !== self::DEFAULT_GAP) {
            $out['gap'] = $raw['gap'];
        }
        if (($raw['captions'] ?? null) === true) {
            $out['captions'] = true;
        }
        if (($raw['lightbox'] ?? null) === true) {
            $out['lightbox'] = true;
        }
        if (($raw['showMotionControls'] ?? null) === true) {
            $out['showMotionControls'] = true;
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
}
