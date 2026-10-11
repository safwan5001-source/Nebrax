<?php

namespace App\Support\Commerce;

/**
 * CUST-HV V9c-1 — مفردات كتل المحتوى المشتركة (V0 §15، D-21) لقسم `customContent`. السلطة PHP؛ توأماها `…/presentation/content-blocks.ts`
 * (متطابقان حرفياً في web وstorefront) بنفس الفيكستشر `tests/Fixtures/presentation/content-blocks.json`.
 *
 * ```
 * content = { blocks: Block[≤12] }
 * Block   = heading   { id, kind, text≤120, level?: 3, align?: 'center'|'end' }
 *         | paragraph { id, kind, text≤600, align?: 'center'|'end' }
 *         | image     { id, kind, media: MediaRef, caption?≤120, link? }
 *         | button    { id, kind, label≤80, href, style?: 'outline'|'link' }
 *         | divider   { id, kind, style?: 'dots' }
 *         | spacer    { id, kind, size?: 'sm'|'lg' }
 *         | callout   { id, kind, text≤300, tone?: 'success'|'warning', icon?: IconKey }
 *         | columns   { id, kind, columns: [Block[≤4], Block[≤4]] }      // لا columns داخل columns
 * ```
 *
 * قرارات AWJ (ما تركه V0 مفتوحاً — ليست تغييراً لعقد):
 *  - **المستند القديم لا يتغيّر**: كتلتا `heading`/`paragraph` بلا حقول جديدة تُطبَّعان إلى الشكل نفسه `{id, kind, text}`؛
 *    الحدّ الأعلى للكتل صار 12 (كان 8) فكل وثيقة قائمة تبقى صالحة. القيم الافتراضية (مستوى 2، محاذاة البداية، فاصل خطّي،
 *    مباعدة md، نبرة info، زرّ solid) هي **الغياب** ولا تُخزَّن فتتطابق الوثائق المتكافئة حرفياً.
 *  - المحاذاة منطقية (`center`/`end`) لا يمين/يسار؛ `start` هو الغياب. العنوان `h2` أو `h3` (لا `h1` — البطل وحده).
 *  - **الصورة** تحتفظ بـ`MediaRef` كاملاً وتسقط كلّها إن لم يكن صالحاً؛ النص البديل لكل لغة والملكية تحرسهما بوابة الوسائط العامة
 *    (الماسح يمشي على كل `mediaId` فيشمل ما داخل الأعمدة بلا مسارٍ جديد). التعليق يُحفظ دائماً، والرابط بقواعد روابط المحتوى.
 *  - **الزرّ** `{label, href, style?}` على قواعد CTA نفسها (تسمية بلا رابط أو العكس مسودة تُحفظ ولا تُعرض؛ الفارغ كلياً يسقط).
 *    **لا `colour` بعد**: لونٌ صريح لـoutline/link يحتاج بوّابة تباين على خلفية القسم (`CtaColourContrast`)، وهي شريحةٌ مستقلة؛
 *    الزرّ بلا لون يتبع ألوان القسم المُثبَتة أصلاً فلا خطر تباين.
 *  - **callout**: النص ≤ 300؛ الأيقونة من السجلّ المنتقى فقط. **columns**: عمودان بالضبط (مصفوفتان، تُكمَّل الناقصة فارغة)،
 *    ≤ 4 كتل لكل عمود، لا تعشيش؛ والتكديس تحت `md` ثابتٌ في العرض لا خيارٌ للتاجر.
 *  - كتلة نصية فارغة تُحفظ (المحرّر ينشئ كتلةً ثم يكتب) ولا تُعرض؛ والمعرّفات فريدة على القسم كلّه (بما فيه الأعمدة).
 *    المعرّف غير الصالح يُستبدل بـ`block-{موضعه}` (وفي عمود `col-{موضع الأعمدة}-{العمود}-{موضعه}`) فيبقى قابلاً للتكرار حرفياً.
 */
final class StorefrontContentBlocksNormalizer
{
    public const MAX_BLOCKS = 12;

    public const MAX_COLUMN_BLOCKS = 4;

    public const MAX_HEADING = 120;

    public const MAX_PARAGRAPH = 600;

    public const MAX_CALLOUT = 300;

    public const MAX_CAPTION = 120;

    public const MAX_BUTTON_LABEL = 80;

    public const KINDS = ['heading', 'paragraph', 'image', 'button', 'divider', 'spacer', 'callout', 'columns'];

    /** @var list<string> نوعا الكتلة النصية القديمان */
    public const LEGACY_KINDS = ['heading', 'paragraph'];

    public const ALIGNS = ['center', 'end'];

    public const BUTTON_STYLES = ['outline', 'link'];

    public const DIVIDER_STYLES = ['dots'];

    public const SPACER_SIZES = ['sm', 'lg'];

    public const CALLOUT_TONES = ['success', 'warning'];

    /**
     * @param  \Closure(string):string  $sanitizeHref  قواعد روابط المحتوى المشتركة (`sanitizeContentHref`)
     * @return array{blocks: list<array<string,mixed>>}|null
     */
    public static function normalize(mixed $raw, \Closure $sanitizeHref): ?array
    {
        if (! is_array($raw) || ($raw !== [] && array_is_list($raw))) {
            return null;
        }

        $seen = [];
        $blocks = self::list($raw['blocks'] ?? null, self::MAX_BLOCKS, true, $seen, $sanitizeHref, 'block-');

        return $blocks === [] ? null : ['blocks' => $blocks];
    }

    /**
     * @param  array<string,true>  $seen
     * @return list<array<string,mixed>>
     */
    private static function list(mixed $raw, int $max, bool $allowColumns, array &$seen, \Closure $sanitizeHref, string $prefix): array
    {
        $out = [];
        foreach (array_values(is_array($raw) ? $raw : []) as $index => $block) {
            if (! is_array($block) || array_is_list($block)) {
                continue;
            }
            $kind = $block['kind'] ?? null;
            if (! is_string($kind) || ! in_array($kind, self::KINDS, true) || ($kind === 'columns' && ! $allowColumns)) {
                continue;
            }
            $id = self::id($block['id'] ?? null, $prefix.$index);
            if (isset($seen[$id])) {
                continue;
            }
            // الأعمدة تُحجَز معرّفها قبل أبنائها فيبقى ترتيب الأولوية = ترتيب القراءة.
            $seen[$id] = true;
            $normalized = self::block($kind, $id, $index, $block, $seen, $sanitizeHref);
            if ($normalized === null) {
                unset($seen[$id]);

                continue;
            }
            $out[] = $normalized;
            if (count($out) >= $max) {
                break;
            }
        }

        return $out;
    }

    /**
     * @param  array<string,mixed>  $raw
     * @param  array<string,true>  $seen
     * @return array<string,mixed>|null
     */
    private static function block(string $kind, string $id, int $index, array $raw, array &$seen, \Closure $sanitizeHref): ?array
    {
        $block = ['id' => $id, 'kind' => $kind];

        switch ($kind) {
            case 'heading':
                $block['text'] = self::legacyText($raw['text'] ?? null, self::MAX_HEADING);
                $level = $raw['level'] ?? null;
                if (is_float($level) && is_finite($level) && floor($level) === $level) {
                    $level = (int) $level; // JSON `3.0` وJS `3` عددٌ واحد
                }
                if ($level === 3) {
                    $block['level'] = 3;
                }
                self::align($block, $raw);

                return $block;

            case 'paragraph':
                $block['text'] = self::legacyText($raw['text'] ?? null, self::MAX_PARAGRAPH);
                self::align($block, $raw);

                return $block;

            case 'image':
                $media = StorefrontMediaRefNormalizer::normalize($raw['media'] ?? null);
                if ($media === null) {
                    return null;
                }
                $block['media'] = $media;
                $caption = self::text($raw['caption'] ?? null, self::MAX_CAPTION);
                if ($caption !== '') {
                    $block['caption'] = $caption;
                }
                $link = $sanitizeHref(is_string($raw['link'] ?? null) ? $raw['link'] : '');
                if ($link !== '') {
                    $block['link'] = $link;
                }

                return $block;

            case 'button':
                $label = self::text($raw['label'] ?? null, self::MAX_BUTTON_LABEL);
                $href = $sanitizeHref(is_string($raw['href'] ?? null) ? $raw['href'] : '');
                if ($label === '' && $href === '') {
                    return null;
                }
                $block['label'] = $label;
                $block['href'] = $href;
                if (is_string($raw['style'] ?? null) && in_array($raw['style'], self::BUTTON_STYLES, true)) {
                    $block['style'] = $raw['style'];
                }

                return $block;

            case 'divider':
                if (is_string($raw['style'] ?? null) && in_array($raw['style'], self::DIVIDER_STYLES, true)) {
                    $block['style'] = $raw['style'];
                }

                return $block;

            case 'spacer':
                if (is_string($raw['size'] ?? null) && in_array($raw['size'], self::SPACER_SIZES, true)) {
                    $block['size'] = $raw['size'];
                }

                return $block;

            case 'callout':
                $block['text'] = self::text($raw['text'] ?? null, self::MAX_CALLOUT);
                if (is_string($raw['tone'] ?? null) && in_array($raw['tone'], self::CALLOUT_TONES, true)) {
                    $block['tone'] = $raw['tone'];
                }
                if (is_string($raw['icon'] ?? null) && in_array($raw['icon'], IconRegistry::KEYS, true)) {
                    $block['icon'] = $raw['icon'];
                }

                return $block;

            case 'columns':
                $source = is_array($raw['columns'] ?? null) && array_is_list($raw['columns']) ? $raw['columns'] : [];
                $columns = [];
                for ($column = 0; $column < 2; $column++) {
                    $columns[] = self::list($source[$column] ?? null, self::MAX_COLUMN_BLOCKS, false, $seen, $sanitizeHref, 'col-'.$index.'-'.$column.'-');
                }
                $block['columns'] = $columns;

                return $block;
        }

        return null;
    }

    /** @param  array<string,mixed>  $block */
    private static function align(array &$block, array $raw): void
    {
        if (is_string($raw['align'] ?? null) && in_array($raw['align'], self::ALIGNS, true)) {
            $block['align'] = $raw['align'];
        }
    }

    private static function id(mixed $value, string $fallback): string
    {
        $id = is_string($value) ? trim($value) : '';

        return preg_match('/\A[a-zA-Z0-9_-]{1,64}\z/', $id) === 1 ? $id : $fallback;
    }

    /** النص القديم للعنوان والفقرة: يُقصّ الطرفان ثم يُقتطع بنقاط الترميز (كما كان، فلا يتغيّر مستندٌ قائم). */
    private static function legacyText(mixed $value, int $max): string
    {
        return mb_substr(trim(is_string($value) ? $value : ''), 0, $max);
    }

    /** النص الجديد: يُحفظ كما كُتب بقصّ نقاط الترميز، والفراغ وحده غياب. */
    private static function text(mixed $value, int $max): string
    {
        if (! is_string($value) || trim($value) === '') {
            return '';
        }

        return mb_substr($value, 0, $max);
    }
}
