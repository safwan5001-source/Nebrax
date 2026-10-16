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
 * خارج هذا الملف عمداً (كلٌّ يدخل مع الشريحة التي تستطيع رسمه وإثباته): `layout` للأنواع غير البطل واللافتة (V8/V9)، و`mediaTreatment.aspect/fit`.
 * تُسقط الآن fail-closed فلا يتسلل خلفية غير مُثبتة. (V5e-3 أضاف `separator` و`motion.reveal`؛ V6c-7 أضاف `layout` للبطل واللافتة.)
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

    /** V6c-4 (V0 §6.5، D-13) — تداخل البطل مع القسم التالي: إعدادات مسبقة فقط (`none` = غياب، لا يُخزَّن أبداً). */
    public const OVERLAPS = ['none', 'sm', 'md'];

    /**
     * V6c-7 (V0 §3.4) — أنماط التخطيط (`layout`) لكل نوع: قائمة مغلقة، والغياب هو النمط الافتراضي (البطل: نص فوق الصورة؛ اللافتة: بطاقة)
     * فلا يُخزَّن أبداً. `full-bleed` للافتة لا يُضاف: `width.mode = full` (V5) يؤدّي المعنى نفسه.
     */
    public const LAYOUTS = [
        'hero' => ['centered', 'split', 'minimal'],
        'banner' => ['split', 'text-band'],
        // CUST-HV V8d (V0 §3.4، D-24) — المعرض: الشبكة هي الافتراضي (غياب)، و`carousel` وحده يُخزَّن.
        'gallery' => ['carousel'],
        // CUST-HV V9b (V0 §3.4) — مزايا المتجر: البطاقات بأعمدة تلقائية هي الافتراضي (غياب)؛ `flat` بلا إطار بطاقة،
        // و`columns-N` بطاقات بعدد أعمدة ثابت على الشاشات الواسعة (الهاتف عمود واحد دائماً، اللوح عمودان).
        'benefits' => ['flat', 'columns-2', 'columns-3', 'columns-4'],
        // CUST-HV V9d-2 (V0 §14.2) — رفوف المنتجات: الغياب = شكل القالب (شبكة في Modern، شريط في Market)، فكلتا القيمتين تُخزَّنان.
        // العروض لا شريط لها بعد (لا مكوّن شريطٍ للعروض) فلا `layout` لها.
        'shelf' => ['grid', 'rail'],
    ];

    /** CUST-HV V9d-2 — عدد الأعمدة على الشاشات الواسعة لرفوف المنتجات والعروض (الهاتف عمودان دائماً). */
    public const SHELF_COLUMNS = [2, 3, 4];

    /** V6c-3 (V0 §8.3) — ارتفاع القسم المُعدّ مسبقاً للبطل واللافتة (حدّ أدنى فقط؛ المحتوى لا يُقصّ أبداً). */
    public const HEIGHT_PRESETS = ['compact', 'standard', 'tall', 'screen'];

    /** V6b-2 — أنواع الخلفية المتاحة لكل الأقسام؛ `media` للبطل واللافتة وحدهما. */
    public const BACKGROUND_KINDS = ['solid', 'gradient'];

    /**
     * AWJ-STORE-CAT-DESIGN-01 — `design.display` لقسم `categories` وحده: عرض بطاقات التصنيفات (نمط العرض، البطاقة، الصورة، الاسم،
     * التجاوب). **الغياب = المظهر الكلاسيكي الحالي حرفياً**؛ و`layout` شرط المجموعة (بدونه تُحذف المجموعة كلّها فلا تبقى بيانات
     * خاملة). الأعداد الصحيحة تتبع قاعدة `productShelf.limit`/VD-4a: عدد صحيح (`6` أو `6.0`) يُقصّ إلى مداه، وما عداه يُسقط المفتاح
     * فيرث الافتراضي (الحفظ لا يُرجع 422 على المحتوى أبداً). ألوان البطاقة رموزُ سمة المتجر فقط — لا hex حرّ — فلا تحتاج بوابة تباين.
     */
    public const DISPLAY_LAYOUTS = ['grid', 'horizontal_scroll', 'circles', 'image_tiles', 'compact_list'];

    /** @var array<string, array{0: int, 1: int}> device => [min, max] */
    public const DISPLAY_COLUMN_RANGES = ['mobile' => [1, 4], 'tablet' => [2, 6], 'desktop' => [2, 8]];

    public const DISPLAY_DEVICES = ['mobile', 'tablet', 'desktop'];

    public const DISPLAY_GAP_RANGE = [4, 32];

    public const DISPLAY_ITEM_WIDTH_RANGE = [64, 320];

    public const DISPLAY_CARD_STYLES = ['none', 'border', 'shadow', 'filled'];

    public const DISPLAY_CARD_BACKGROUNDS = ['surface', 'muted', 'transparent'];

    public const DISPLAY_CARD_BORDER_COLORS = ['border', 'strong', 'primary', 'accent'];

    public const DISPLAY_CARD_BORDER_WIDTH_RANGE = [0, 4];

    public const DISPLAY_CARD_RADIUS_RANGE = [0, 32];

    public const DISPLAY_CARD_PADDING_RANGE = [0, 32];

    public const DISPLAY_CARD_HOVERS = ['none', 'subtle'];

    public const DISPLAY_IMAGE_SHAPES = ['rect', 'square', 'circle'];

    public const DISPLAY_IMAGE_ASPECTS = ['1:1', '4:3', '3:2', '16:9'];

    public const DISPLAY_IMAGE_FITS = ['cover', 'contain'];

    public const DISPLAY_IMAGE_POSITIONS = ['center', 'top', 'bottom', 'start', 'end'];

    public const DISPLAY_IMAGE_HEIGHT_RANGE = [48, 400];

    public const DISPLAY_NAME_PLACEMENTS = ['below', 'above', 'overlay', 'beside'];

    public const DISPLAY_NAME_SIZE_RANGE = [12, 32];

    public const DISPLAY_NAME_WEIGHTS = [400, 500, 600, 700, 800];

    public const DISPLAY_NAME_COLORS = ['foreground', 'muted', 'primary'];

    public const DISPLAY_NAME_LINES = [1, 2, 'natural'];

    public const DISPLAY_NAME_BACKGROUNDS = ['none', 'scrim', 'surface'];

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
        // V6c-3 (V0 §8.3) — موضع المحتوى الرأسي (`valign`، نصف شبكة 3×3 التي نصفها الأفقي `align`) وارتفاع القسم
        // (`mediaTreatment.height`) للبطل واللافتة وحدهما. الترتيب القانوني: … align، valign، border … separator، mediaTreatment، motion.
        // V6b-2 — خلفية الوسائط للبطل واللافتة وحدهما (V0 §8.1)؛ كل نوعٍ آخر `solid|gradient` فقط.
        $hero = [
            'background' => [...self::BACKGROUND_KINDS, 'media'],
            'text' => self::FULL_TEXT,
            'typography' => self::FULL_TYPO,
            'width' => true,
            'spacing' => true,
            'align' => true,
            'valign' => true,
            'border' => true,
            'radius' => true,
            'shadow' => true,
            // V5e-3 — `separator` لكل الأنواع القابلة للتصميم؛ `motion.reveal` للبطل واللافتة فقط (V0 §3.4).
            'separator' => true,
            'mediaTreatment' => ['height'],
            'motion' => ['reveal'],
        ];
        // V6c-4 — `overlap` للبطل وحده (V0 §6.5: «hero→next only»)؛ الترتيب القانوني: separator، overlap، mediaTreatment، motion.
        // V6c-7 — `layout` (قائمة أنماط كل نوع) بعد `valign` (V0 §3.3: … align، layout، border …).
        $heroOnly = [];
        $banner = [];
        foreach ($hero as $group => $allowance) {
            $heroOnly[$group] = $allowance;
            $banner[$group] = $allowance;
            if ($group === 'valign') {
                $heroOnly['layout'] = self::LAYOUTS['hero'];
                $banner['layout'] = self::LAYOUTS['banner'];
            }
            if ($group === 'separator') {
                $heroOnly['overlap'] = true;
            }
        }
        $shelf = ['background' => self::BACKGROUND_KINDS, 'text' => ['heading'], 'typography' => ['headingStyle'], 'width' => true, 'spacing' => true, 'layout' => self::LAYOUTS['shelf'], 'columns' => self::SHELF_COLUMNS, 'cards' => true, 'separator' => true];
        $offers = ['background' => self::BACKGROUND_KINDS, 'text' => ['heading'], 'typography' => ['headingStyle'], 'width' => true, 'spacing' => true, 'columns' => self::SHELF_COLUMNS, 'cards' => true, 'separator' => true];

        return [
            'hero' => $heroOnly,
            'banner' => $banner,
            'categories' => ['background' => self::BACKGROUND_KINDS, 'text' => ['heading'], 'typography' => ['headingStyle'], 'width' => true, 'spacing' => true, 'border' => true, 'radius' => true, 'display' => true, 'separator' => true],
            // CUST-HV V8a (V0 §3.4) — الشرائح: خلفية القسم (صلبة/تدرّج) والعرض والتباعد والحدّ والاستدارة والظل والفاصل
            // وارتفاعٌ مُعدّ مسبقاً. لا مجموعة `text`: ألوان النص **لكل شريحة** (محتوى الشريحة) لأنها تقع فوق صورتها. ولا `layout`
            // (`split` يضع النص على سطح القسم لا الصورة — إثبات تباينه شريحةٌ لاحقة). الحركة (`transition`) سلوكٌ في المحتوى.
            'slider' => ['background' => self::BACKGROUND_KINDS, 'width' => true, 'spacing' => true, 'border' => true, 'radius' => true, 'shadow' => true, 'separator' => true, 'mediaTreatment' => ['height']],
            // CUST-HV V8d (V0 §3.4) — المعرض: خلفية القسم (صلبة/تدرّج) والعرض والتباعد والحدّ والاستدارة والظل والفاصل و`layout`
            // (`carousel`). لا `text` (التعليق على سطح القسم بلونٍ تلقائي مُثبَت) ولا `mediaTreatment` (النسبة في المحتوى `options.aspect`).
            'gallery' => ['background' => self::BACKGROUND_KINDS, 'width' => true, 'spacing' => true, 'layout' => self::LAYOUTS['gallery'], 'border' => true, 'radius' => true, 'shadow' => true, 'separator' => true],
            'newArrivals' => $shelf,
            'featured' => $shelf,
            'offers' => $offers,
            'productShelf' => $shelf,
            'discovery' => ['background' => self::BACKGROUND_KINDS, 'text' => ['heading'], 'spacing' => true, 'separator' => true],
            'benefits' => ['background' => self::BACKGROUND_KINDS, 'text' => self::FULL_TEXT, 'typography' => self::FULL_TYPO, 'spacing' => true, 'align' => true, 'layout' => self::LAYOUTS['benefits'], 'border' => true, 'radius' => true, 'shadow' => true, 'separator' => true],
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
        if (isset($capability['valign'])) {
            $valign = self::pick($raw['valign'] ?? null, self::ALIGNS);
            if ($valign !== null) {
                $out['valign'] = $valign;
            }
        }
        if (isset($capability['layout'])) {
            $layout = self::pick($raw['layout'] ?? null, $capability['layout']);
            if ($layout !== null) {
                $out['layout'] = $layout;
            }
        }
        if (isset($capability['columns'])) {
            $columns = self::pick($raw['columns'] ?? null, $capability['columns']);
            if ($columns !== null) {
                $out['columns'] = $columns;
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
        if (isset($capability['cards'])) {
            // CUST-HV V9d-2 (V0 §14.1) — تجاوز رموز البطاقة لهذا القسم: القوائم المغلقة نفسها للوثيقة.
            $cards = StorefrontGlobalTokensNormalizer::cards($raw['cards'] ?? null);
            if ($cards !== null) {
                $out['cards'] = $cards;
            }
        }
        if (isset($capability['display'])) {
            // AWJ-STORE-CAT-DESIGN-01 — عرض بطاقات التصنيفات؛ الترتيب القانوني: … cards، display، separator …
            $display = self::display($raw['display'] ?? null);
            if ($display !== null) {
                $out['display'] = $display;
            }
        }
        if (isset($capability['separator'])) {
            $separator = self::separator($raw['separator'] ?? null);
            if ($separator !== null) {
                $out['separator'] = $separator;
            }
        }
        if (isset($capability['overlap'])) {
            $overlap = self::pick($raw['overlap'] ?? null, self::OVERLAPS);
            // `none` يساوي الغياب: القيمة الافتراضية لا تُخزَّن (وثيقة بلا الحقل = وثيقة `none`).
            if ($overlap !== null && $overlap !== 'none') {
                $out['overlap'] = $overlap;
            }
        }
        if (isset($capability['mediaTreatment']) && self::isObject($raw['mediaTreatment'] ?? null)
            && self::allows($capability['mediaTreatment'], 'height')) {
            $height = self::pick($raw['mediaTreatment']['height'] ?? null, self::HEIGHT_PRESETS);
            if ($height !== null) {
                $out['mediaTreatment'] = ['height' => $height];
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

    /** عدد صحيح JSON (`6` أو `6.0` — PHP يفكّ الثانية float) يُقصّ إلى [min, max]؛ وما عداه null (يُسقط المفتاح). */
    private static function clampedInt(mixed $value, int $min, int $max): ?int
    {
        $integral = is_int($value) || (is_float($value) && is_finite($value) && floor($value) === $value);

        return $integral ? (int) max($min, min($max, $value)) : null;
    }

    /**
     * جهاز ← عدد صحيح مقصوص. يعيد null إن لم يبقَ جهاز صالح (المجموعة الفارغة تُحذف).
     *
     * @param  array<string, array{0: int, 1: int}>  $ranges
     * @return array<string, int>|null
     */
    private static function perDevice(mixed $raw, array $ranges): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $out = [];
        foreach ($ranges as $device => [$min, $max]) {
            $value = self::clampedInt($raw[$device] ?? null, $min, $max);
            if ($value !== null) {
                $out[$device] = $value;
            }
        }

        return $out === [] ? null : $out;
    }

    /** @return array<string, array{0: int, 1: int}> */
    private static function uniformRange(array $range): array
    {
        return array_fill_keys(self::DISPLAY_DEVICES, $range);
    }

    /**
     * AWJ-STORE-CAT-DESIGN-01 — `design.display` (قسم `categories`). `layout` شرط المجموعة؛ ترتيب المفاتيح القانوني:
     * layout، columns، gap، itemWidth، card، image، name. `image.show`/`name.show` لا يُخزَّنان إلا `false` (الافتراضي ظاهر).
     *
     * @return array<string,mixed>|null
     */
    private static function display(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $layout = self::pick($raw['layout'] ?? null, self::DISPLAY_LAYOUTS);
        if ($layout === null) {
            return null; // بلا نمطٍ لا مجموعة: المظهر الكلاسيكي
        }
        $out = ['layout' => $layout];

        $columns = self::perDevice($raw['columns'] ?? null, self::DISPLAY_COLUMN_RANGES);
        if ($columns !== null) {
            $out['columns'] = $columns;
        }
        $gap = self::perDevice($raw['gap'] ?? null, self::uniformRange(self::DISPLAY_GAP_RANGE));
        if ($gap !== null) {
            $out['gap'] = $gap;
        }
        $itemWidth = self::perDevice($raw['itemWidth'] ?? null, self::uniformRange(self::DISPLAY_ITEM_WIDTH_RANGE));
        if ($itemWidth !== null) {
            $out['itemWidth'] = $itemWidth;
        }

        $card = self::displayCard($raw['card'] ?? null);
        if ($card !== null) {
            $out['card'] = $card;
        }
        $image = self::displayImage($raw['image'] ?? null);
        if ($image !== null) {
            $out['image'] = $image;
        }
        $name = self::displayName($raw['name'] ?? null);
        if ($name !== null) {
            $out['name'] = $name;
        }

        return $out;
    }

    /** @return array<string,mixed>|null */
    private static function displayCard(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $out = [];
        foreach ([
            'style' => self::DISPLAY_CARD_STYLES,
            'background' => self::DISPLAY_CARD_BACKGROUNDS,
            'borderColor' => self::DISPLAY_CARD_BORDER_COLORS,
        ] as $key => $list) {
            $value = self::pick($raw[$key] ?? null, $list);
            if ($value !== null) {
                $out[$key] = $value;
            }
        }
        foreach ([
            'borderWidth' => self::DISPLAY_CARD_BORDER_WIDTH_RANGE,
            'radius' => self::DISPLAY_CARD_RADIUS_RANGE,
            'padding' => self::DISPLAY_CARD_PADDING_RANGE,
        ] as $key => [$min, $max]) {
            $value = self::clampedInt($raw[$key] ?? null, $min, $max);
            if ($value !== null) {
                $out[$key] = $value;
            }
        }
        $hover = self::pick($raw['hover'] ?? null, self::DISPLAY_CARD_HOVERS);
        if ($hover !== null) {
            $out['hover'] = $hover;
        }

        return $out === [] ? null : $out;
    }

    /** @return array<string,mixed>|null */
    private static function displayImage(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $out = [];
        if (($raw['show'] ?? null) === false) {
            $out['show'] = false;
        }
        foreach ([
            'shape' => self::DISPLAY_IMAGE_SHAPES,
            'aspect' => self::DISPLAY_IMAGE_ASPECTS,
            'fit' => self::DISPLAY_IMAGE_FITS,
            'position' => self::DISPLAY_IMAGE_POSITIONS,
        ] as $key => $list) {
            $value = self::pick($raw[$key] ?? null, $list);
            if ($value !== null) {
                $out[$key] = $value;
            }
        }
        $height = self::perDevice($raw['height'] ?? null, self::uniformRange(self::DISPLAY_IMAGE_HEIGHT_RANGE));
        if ($height !== null) {
            $out['height'] = $height;
        }

        return $out === [] ? null : $out;
    }

    /** @return array<string,mixed>|null */
    private static function displayName(mixed $raw): ?array
    {
        if (! self::isObject($raw)) {
            return null;
        }
        $out = [];
        if (($raw['show'] ?? null) === false) {
            $out['show'] = false;
        }
        $placement = self::pick($raw['placement'] ?? null, self::DISPLAY_NAME_PLACEMENTS);
        if ($placement !== null) {
            $out['placement'] = $placement;
        }
        $align = self::pick($raw['align'] ?? null, self::ALIGNS);
        if ($align !== null) {
            $out['align'] = $align;
        }
        $size = self::clampedInt($raw['size'] ?? null, self::DISPLAY_NAME_SIZE_RANGE[0], self::DISPLAY_NAME_SIZE_RANGE[1]);
        if ($size !== null) {
            $out['size'] = $size;
        }
        $weight = self::pick($raw['weight'] ?? null, self::DISPLAY_NAME_WEIGHTS);
        if ($weight !== null) {
            $out['weight'] = $weight;
        }
        $color = self::pick($raw['color'] ?? null, self::DISPLAY_NAME_COLORS);
        if ($color !== null) {
            $out['color'] = $color;
        }
        $lines = self::pick($raw['lines'] ?? null, self::DISPLAY_NAME_LINES);
        if ($lines !== null) {
            $out['lines'] = $lines;
        }
        $background = self::pick($raw['background'] ?? null, self::DISPLAY_NAME_BACKGROUNDS);
        if ($background !== null) {
            $out['background'] = $background;
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
    public static function backgroundRef(mixed $raw): ?array
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
    public static function overlay(mixed $raw): ?array
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
