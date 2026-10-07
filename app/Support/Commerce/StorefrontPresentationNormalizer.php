<?php

namespace App\Support\Commerce;

/**
 * STORE-BACKEND-1 — سلطة تطبيع StorefrontPresentationConfig v1 على الخادم.
 *
 * توأم PHP لـ `normalizePresentationConfig()` في
 * `storefront/src/lib/presentation/config.ts`. العميل قد يطبّع مسبقاً؛
 * الخادم يعيد التطبيع ويخزّن نتيجته فقط. مفاتيح مجهولة تُسقط. قيم غير
 * صالحة تفشل إلى افتراضي الحقل. لا HTML/CSS/JS.
 */
final class StorefrontPresentationNormalizer
{
    /**
     * STORE-CUSTOMIZER-CONTRACT-2 — الإصدار 2: أقسام الصفحة الرئيسية أصبحت
     * instances على الشكل {id, type, visible}. المعرّف محلي داخل الوثيقة
     * وليس global resource id. الترحيل من v1 deterministic: id = key،
     * وأول ورود يكسب عند تكرار المعرّف. دلالات الغياب بالإصدار: وثائق v1
     * تُعاد إلحاق الأقسام الافتراضية الناقصة لها (سلوكها الأصلي)، ووثائق
     * v2 تعتبر الغياب حذفاً حقيقياً دون إحياء. الأنواع المجهولة تُسقط
     * fail-closed في كل الأحوال.
     *
     * CUST-H2-1 — الإصدار 3: مفتاح جديد اختياري `pagePresentation` لعرض
     * صفحتي المنتج والفئة، إضافي بحت — كل حقل موجود يبقى كما هو حرفياً.
     * الغياب يعني «لم تُخصَّص بعد» ولا يُكتب كِياناً فارغاً؛ كل نسخة سابقة
     * على CUST-H2 تُطبَّع طبق الأصل. راجع
     * `docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`.
     */
    public const VERSION = 3;

    public const MAX_HOME_SECTIONS = 30;

    public const MAX_DOCUMENT_BYTES = 1572864; // 1.5 MiB

    public const MAX_LOGO_BYTES = 524288; // 512 KiB

    public const THEME_PRESETS = [
        'awj-modern' => '#12372a',
        'navy' => '#1e3a5f',
        'burgundy' => '#7f1d1d',
        'sand' => '#92400e',
        'slate' => '#334155',
        'awj-market' => '#0f766e',
        // FLOWERS-H15 / ADR-26 — «بلوم»: ملف عرض عام للورد والهدايا. لونٌ فقط هنا؛ الحزمة المبدئية (زوايا…) في المُخصِّص.
        'awj-bloom' => '#9d2449',
    ];

    /**
     * CUST-H3-2 — `tajawal-geist` added after implementation-time verification
     * (Tajawal is in Next.js's bundled Google Fonts metadata with arabic+latin
     * subsets; see `docs/reports/CUST-H3-2-IMPLEMENTATION-REPORT.md`). Adding
     * an allowed value here does not move the default — `normalize()` still
     * falls back to `cairo-geist` for anything else, so every existing stored
     * document keeps rendering exactly as before.
     */
    public const FONT_PRESETS = ['cairo-geist', 'tajawal-geist'];

    public const DENSITY_PRESETS = ['comfortable', 'compact'];

    public const RADIUS_PRESETS = ['default', 'subtle', 'sharp'];

    public const PRODUCT_CARD_PRESETS = ['standard', 'compact'];

    public const HEADER_STYLES = ['standard', 'compact'];

    public const MAX_BENEFIT_ITEMS = 6;

    public const MAX_CUSTOM_BLOCKS = 8;

    public const MAX_FEATURED_PRODUCTS = 8;

    /** CUST-H4-7 — `OffersContent.offerIds`. Twin of MAX_OFFERS in both section-content.ts files. */
    public const MAX_OFFERS = 8;

    /** FLOWERS-H9a / ADR-21 — حدود محتوى الأقسام المرتبطة بالبيانات. توأم الثوابت في ملفَّي section-content.ts. */
    public const MAX_SECTION_TITLE_LENGTH = 80;

    public const MAX_DELIVERY_PROMISE_BODY_LENGTH = 200;

    public const SHELF_LIMIT_MIN = 2;

    public const SHELF_LIMIT_MAX = 12;

    public const SHELF_LIMIT_DEFAULT = 8;

    public const DISCOVERY_DISPLAYS = ['tiles', 'chips'];

    /**
     * محور الاستكشاف: بُعدٌ وصفيّ للتاجر (`facet` + `dimension` = مفتاحه) أو العلامات (`brand`). نوعٌ مُميَّز لا
     * قيمة خاصة داخل `dimension`: بُعدٌ وصفيّ مفتاحه `brand` صالح اليوم ويجب أن يبقى قابلاً للاستهداف.
     */
    public const DISCOVERY_AXES = ['facet', 'brand'];

    /** CUST-H4-4 — banner `imageAlt`. Twin of MAX_BANNER_IMAGE_ALT_LENGTH in both section-content.ts files. */
    public const MAX_BANNER_IMAGE_ALT_LENGTH = 150;

    public const HOME_BUILDER_SECTION_KEYS = [
        'hero',
        'categories',
        'newArrivals',
        'wholesale',
        'banner',
        'featured',
        'offers',
        'benefits',
        'appPromo',
        'customContent',
    ];

    /**
     * FLOWERS-H9 / ADR-21 — أقسام تستهلك بيانات Commerce ولا تملك حقيقة تجارية. **مقبولة للتخزين** (المحتوى مُطبَّع
     * fail-closed) لكنها خارج القائمة الافتراضية للوثيقة حتى يضيفها المُنشئ وواجهة المتجر (H9b/H9c) — فلا تتغيّر
     * الوثيقة الافتراضية ولا توأماها في TS قبل ذلك.
     */
    public const HOME_DATA_SECTION_KEYS = [
        'productShelf',
        'discovery',
        'deliveryPromise',
    ];

    public const IMPLEMENTED_HOME_SECTION_KEYS = [
        'hero',
        'categories',
        'newArrivals',
        'wholesale',
    ];

    public const NAV_KINDS = ['home', 'category', 'product', 'content', 'external'];

    /**
     * CUST-HV V3 — شريط الإعلانات (`announcements`, العقد §12). مفتاح اختياري
     * إضافي بحت: الغياب = لا شريط، ولا يُكتب كياناً فارغاً (نفس قاعدة
     * `pagePresentation`). الإصدار يبقى 3.
     *
     * سجلّ الأيقونات هنا **أصل** السجلّ المنتقى المشترك (V0 §11.4) — V7 يوسّعه،
     * ولا يغيّر مفتاحاً موجوداً. الألوان: `{hex}` صلبة فقط الآن؛ أدوار اللوحة
     * والتدرّجات تأتي مع V5 (محرّك التباين العام) فتُسقط هنا fail-closed.
     */
    /**
     * CUST-HV V5a — أدوار اللوحة الإضافية (V0 §4.1). `brand` = `primaryColor` و`accent`
     * = `accentColor` يبقيان مفتاحَيهما (لا مصدرَي حقيقة)؛ هنا ما عداهما فقط.
     * مفتاح اختياري إضافي بحت: الغياب (أو كل الأدوار غير صالحة) = لا مفتاح، فكل دورٍ
     * غائب يسقط إلى رمزه الثابت اليوم (غياب `palette` ⇒ مخرجات بلا تغيير).
     */
    public const PALETTE_ROLES = ['surface', 'surfaceAlt', 'text', 'heading', 'link', 'border', 'overlay'];

    public const ANNOUNCEMENT_MAX_ITEMS = 5;

    public const ANNOUNCEMENT_TEXT_MAX = 120;

    public const ANNOUNCEMENT_ICONS = [
        'megaphone', 'bell', 'info', 'tag', 'percent', 'truck', 'gift', 'clock', 'star', 'heart', 'sparkles', 'shield-check',
    ];

    public const ANNOUNCEMENT_PAGES = ['home', 'product', 'category', 'all'];

    public const ANNOUNCEMENT_ROTATE_INTERVALS = [6, 8, 10];

    public const ANNOUNCEMENT_DEFAULT_ROTATE_INTERVAL = 8;

    public const ANNOUNCEMENT_TICKER_SPEEDS = ['slow', 'normal', 'fast'];

    public const WHATSAPP_PLACEMENTS = ['floating', 'footer', 'both'];

    public const SOCIAL_NETWORKS = [
        'instagram', 'x', 'tiktok', 'snapchat', 'youtube', 'linkedin', 'facebook',
    ];

    public const CONTENT_PAGE_SLUGS = [
        'about',
        'contact',
        'faq',
        'shipping-policy',
        'privacy-policy',
        'returns-policy',
        'terms-of-service',
    ];

    /**
     * CUST-H2-1 — Page Type Registry. توأم `PageType` في
     * `web/.../presentation/page-regions.ts`.
     */
    public const PAGE_TYPES = ['home', 'product', 'category'];

    /**
     * CUST-H2-1 — Product Page Region Contract (المفاتيح المُنفَّذة فقط؛
     * specifications/related_products/trust_shipping_payment مؤجَّلة —
     * لا نموذج بيانات لها، فليست مفتاحاً هنا أصلاً).
     */
    public const PRODUCT_PAGE_REGION_KEYS = [
        'media_gallery',
        'identity',
        'price',
        'availability',
        'variant_selector',
        'quantity_cta',
        'description',
        'custom_fields',
        'sku_options_details',
    ];

    /**
     * CUST-H2-1 — Category Page Region Contract. لا `pagination` هنا: مذكورة
     * في نوع TS التوضيحي بالمعمارية لكن بلا صفّ قدرة خاص بها في جدول العقد
     * التفصيلي أو ملخص التقرير — كلاهما يصفانها خاصية لـ`product_grid`
     * («نموذج الصفحات infinite-scroll تجاري السلطة لا خياراً تصميمياً في
     * H2 V1»)، لا منطقة مستقلة. مفتاح بلا بيانات قدرة كاملة يخالف عقد هذا
     * السجلّ نفسه.
     */
    public const CATEGORY_PAGE_REGION_KEYS = [
        'breadcrumbs',
        'identity_title',
        'description',
        'subcategories_rail',
        'filter_sort_bar',
        'product_grid',
    ];

    /**
     * مناطق FIXED_REQUIRED تُعاد إلى visible=true عند التطبيع مهما أرسل
     * العميل. `variant_selector` مُستثناة عمداً: شرطها الحقيقي
     * `product.hasVariants` بيانات منتج محدد لا تملكها وثيقة العرض العامة —
     * إنفاذها مسؤولية زمن العرض العام (CUST-H2-5)، لا مطبّع الوثيقة.
     */
    public const FIXED_REQUIRED_PRODUCT_REGION_KEYS = [
        'media_gallery',
        'identity',
        'price',
        'quantity_cta',
    ];

    public const FIXED_REQUIRED_CATEGORY_REGION_KEYS = [
        'breadcrumbs',
        'identity_title',
        'filter_sort_bar',
        'product_grid',
    ];

    /** @return array<string, mixed> */
    public function defaultConfig(): array
    {
        $sections = [];
        foreach (self::HOME_BUILDER_SECTION_KEYS as $key) {
            $sections[] = [
                'id' => $key,
                'type' => $key,
                'visible' => in_array($key, self::IMPLEMENTED_HOME_SECTION_KEYS, true),
            ];
        }

        $pages = [];
        foreach (self::CONTENT_PAGE_SLUGS as $slug) {
            $pages[] = [
                'id' => 'page-'.$slug,
                'slug' => $slug,
                'title' => '',
                'enabled' => $slug !== 'about' && $slug !== 'contact' && $slug !== 'faq',
            ];
        }

        return [
            'version' => self::VERSION,
            'themePreset' => 'awj-modern',
            'primaryColor' => '#12372a',
            'accentColor' => null,
            'fontPreset' => 'cairo-geist',
            'density' => 'comfortable',
            'radius' => 'default',
            'productCard' => 'standard',
            'branding' => [
                'displayName' => '',
                'logoDataUrl' => null,
                'compactLogoDataUrl' => null,
                'faviconDataUrl' => null,
            ],
            'header' => [
                'style' => 'standard',
                'showSearch' => true,
                'showAccount' => true,
                'showCart' => true,
                'showCategoryNav' => true,
                'links' => [
                    [
                        'id' => 'nav-home',
                        'label' => '',
                        'kind' => 'home',
                        'href' => '/',
                        'enabled' => true,
                    ],
                ],
            ],
            'homepage' => [
                'sections' => $sections,
                'heroHeadline' => '',
                'heroSubheadline' => '',
            ],
            'footer' => [
                'tagline' => '',
                'showLogo' => true,
                'copyright' => '',
            ],
            'contact' => [
                'phone' => '',
                'email' => '',
                'address' => '',
                'hours' => '',
            ],
            'whatsapp' => [
                'enabled' => false,
                'phone' => '',
                'message' => '',
                'placement' => 'floating',
            ],
            'social' => [],
            'verification' => [
                'crNumber' => '',
                'licenseNumber' => '',
                'sourceUrl' => '',
                'requestedVerifiedLabel' => false,
            ],
            'sbc' => [
                'authentication_number' => '',
                'seal_token' => '',
                'show_in_storefront' => false,
            ],
            'apps' => [
                'iosUrl' => '',
                'androidUrl' => '',
                'appName' => '',
                'showHomepageSection' => false,
                'showFooterLinks' => false,
            ],
            'pages' => $pages,
        ];
    }

    /**
     * يطبّع مدخلاً مجهولاً إلى وثيقة v2 آمنة مع دعم قراءة وثائق v1
     * المحفوظة. نسخة مخزَّنة بإصدار أمامي تفشل إلى AWJ Modern دون تخمين.
     *
     * @return array<string, mixed>
     */
    public function normalize(mixed $input, ?int $storedSchemaVersion = null): array
    {
        if ($storedSchemaVersion !== null && $storedSchemaVersion > self::VERSION) {
            return $this->defaultConfig();
        }

        if (! is_array($input) || $this->isList($input)) {
            return $this->defaultConfig();
        }

        if (
            $storedSchemaVersion !== null
            && isset($input['version'])
            && is_numeric($input['version'])
            && (int) $input['version'] > self::VERSION
        ) {
            return $this->defaultConfig();
        }

        // وثيقة legacy (v1): لا schema_version مخزّن ≥2 ولا version معلن ≥2.
        // النسخة المخزّنة (من قاعدة البيانات) أسبق؛ إعلان العميل يُستخدم فقط
        // لتمييز دلالات الغياب، وليس سلطةً على الإصدار الأمامي.
        $declaredVersion = isset($input['version']) && is_numeric($input['version'])
            ? (int) $input['version']
            : null;
        $effectiveVersion = $storedSchemaVersion ?? $declaredVersion ?? 1;
        $legacyDocument = $effectiveVersion < 2;

        $defaults = $this->defaultConfig();
        $brandingRaw = $this->object($input['branding'] ?? null);
        $headerRaw = $this->object($input['header'] ?? null);
        $homepageRaw = $this->object($input['homepage'] ?? null);
        $footerRaw = $this->object($input['footer'] ?? null);
        $contactRaw = $this->object($input['contact'] ?? null);
        $whatsappRaw = $this->object($input['whatsapp'] ?? null);
        $verificationRaw = $this->object($input['verification'] ?? null);
        $sbcRaw = $this->object($input['sbc'] ?? null);
        $appsRaw = $this->object($input['apps'] ?? null);

        $themePreset = $this->inList($input['themePreset'] ?? null, array_keys(self::THEME_PRESETS), 'awj-modern');
        $primaryRaw = $this->asString($input['primaryColor'] ?? null);
        $primaryColor = $this->isSafeHexColor($primaryRaw)
            ? trim($primaryRaw)
            : self::THEME_PRESETS[$themePreset];
        $accentRaw = trim($this->asString($input['accentColor'] ?? null));
        $accentColor = $this->isSafeHexColor($accentRaw) ? $accentRaw : null;

        $iosUrl = $this->asString($appsRaw['iosUrl'] ?? null);
        $androidUrl = $this->asString($appsRaw['androidUrl'] ?? null);
        $pagePresentation = $this->normalizePagePresentation($input['pagePresentation'] ?? null);
        $announcements = $this->normalizeAnnouncements($input['announcements'] ?? null);
        $palette = $this->normalizePalette($input['palette'] ?? null);

        $config = [
            'version' => self::VERSION,
            'themePreset' => $themePreset,
            'primaryColor' => $primaryColor,
            'accentColor' => $accentColor,
            'fontPreset' => $this->inList($input['fontPreset'] ?? null, self::FONT_PRESETS, 'cairo-geist'),
            'density' => $this->inList($input['density'] ?? null, self::DENSITY_PRESETS, 'comfortable'),
            'radius' => $this->inList($input['radius'] ?? null, self::RADIUS_PRESETS, 'default'),
            'productCard' => $this->inList($input['productCard'] ?? null, self::PRODUCT_CARD_PRESETS, 'standard'),
            'branding' => [
                'displayName' => mb_substr($this->asString($brandingRaw['displayName'] ?? null), 0, 80),
                'logoDataUrl' => $this->cappedLogo($this->sanitizeLogoUrl($this->asString($brandingRaw['logoDataUrl'] ?? null))),
                'compactLogoDataUrl' => $this->cappedLogo($this->sanitizeLogoUrl($this->asString($brandingRaw['compactLogoDataUrl'] ?? null))),
                'faviconDataUrl' => $this->cappedLogo($this->sanitizeLogoUrl($this->asString($brandingRaw['faviconDataUrl'] ?? null))),
            ] + $this->brandingMedia($brandingRaw),
            'header' => [
                'style' => $this->inList($headerRaw['style'] ?? null, self::HEADER_STYLES, 'standard'),
                'showSearch' => $this->asBoolean($headerRaw['showSearch'] ?? null, true),
                'showAccount' => $this->asBoolean($headerRaw['showAccount'] ?? null, true),
                'showCart' => $this->asBoolean($headerRaw['showCart'] ?? null, true),
                'showCategoryNav' => $this->asBoolean($headerRaw['showCategoryNav'] ?? null, true),
                'links' => $this->normalizeLinks($headerRaw['links'] ?? null, $defaults['header']['links']),
            ],
            'homepage' => [
                'sections' => $this->resolveHomeBuilderSections(
                    $homepageRaw['sections'] ?? null,
                    $defaults['homepage']['sections'],
                    $legacyDocument,
                ),
                'heroHeadline' => mb_substr($this->asString($homepageRaw['heroHeadline'] ?? null), 0, 120),
                'heroSubheadline' => mb_substr($this->asString($homepageRaw['heroSubheadline'] ?? null), 0, 200),
            ],
            'footer' => [
                'tagline' => mb_substr($this->asString($footerRaw['tagline'] ?? null), 0, 200),
                'showLogo' => $this->asBoolean($footerRaw['showLogo'] ?? null, true),
                'copyright' => mb_substr($this->asString($footerRaw['copyright'] ?? null), 0, 120),
            ],
            'contact' => [
                'phone' => mb_substr($this->asString($contactRaw['phone'] ?? null), 0, 40),
                'email' => mb_substr($this->asString($contactRaw['email'] ?? null), 0, 120),
                'address' => mb_substr($this->asString($contactRaw['address'] ?? null), 0, 200),
                'hours' => mb_substr($this->asString($contactRaw['hours'] ?? null), 0, 80),
            ],
            'whatsapp' => [
                'enabled' => $this->asBoolean($whatsappRaw['enabled'] ?? null, false),
                'phone' => mb_substr($this->asString($whatsappRaw['phone'] ?? null), 0, 20),
                'message' => mb_substr($this->asString($whatsappRaw['message'] ?? null), 0, 300),
                'placement' => $this->inList($whatsappRaw['placement'] ?? null, self::WHATSAPP_PLACEMENTS, 'floating'),
            ],
            'social' => $this->normalizeSocial($input['social'] ?? null),
            'verification' => [
                'crNumber' => mb_substr($this->asString($verificationRaw['crNumber'] ?? null), 0, 40),
                'licenseNumber' => mb_substr($this->asString($verificationRaw['licenseNumber'] ?? null), 0, 40),
                'sourceUrl' => $this->sanitizeExternalUrl($this->asString($verificationRaw['sourceUrl'] ?? null)) ?? '',
                // Legacy compatibility only; merchant input cannot mint an official verification claim.
                'requestedVerifiedLabel' => false,
            ],
            'sbc' => [
                'authentication_number' => trim($this->asString($sbcRaw['authentication_number'] ?? null)),
                'seal_token' => trim($this->asString($sbcRaw['seal_token'] ?? null)),
                'show_in_storefront' => $this->asBoolean($sbcRaw['show_in_storefront'] ?? null, false),
            ],
            'apps' => [
                'iosUrl' => $this->isSafeAppStoreUrl($iosUrl) ? ($this->sanitizeExternalUrl($iosUrl) ?? '') : '',
                'androidUrl' => $this->isSafePlayStoreUrl($androidUrl) ? ($this->sanitizeExternalUrl($androidUrl) ?? '') : '',
                'appName' => mb_substr($this->asString($appsRaw['appName'] ?? null), 0, 80),
                'showHomepageSection' => $this->asBoolean($appsRaw['showHomepageSection'] ?? null, false),
                'showFooterLinks' => $this->asBoolean($appsRaw['showFooterLinks'] ?? null, false),
            ],
            'pages' => $this->normalizePages($input['pages'] ?? null, $defaults['pages']),
        ];

        if ($pagePresentation !== null) {
            $config['pagePresentation'] = $pagePresentation;
        }

        if ($announcements !== null) {
            $config['announcements'] = $announcements;
        }

        if ($palette !== null) {
            $config['palette'] = $palette;
        }

        return $config;
    }

    public function encodedSize(array $config): int
    {
        return strlen((string) json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    /**
     * الوسم الفعلي لمستند مخزَّن (مسودة أو منشور، رأس أو نسخة على حدّ سواء):
     * حقل `version` المضمَّن داخل الوثيقة نفسها أولاً (تكتبه `normalize()`
     * عند كل حفظ فعلي، قديماً كان الكاتب أو جديداً، فلا يتخلَّف أبداً عن
     * الشكل الحقيقي للمحتوى)، ثم عمود قاعدة البيانات المنفصل احتياطاً فقط
     * لمستند بلا حقل مضمَّن. عمود كـ`draft_schema_version` قد يتخلَّف عن
     * كاتبٍ قديم لا يعرفه (مثلاً صفّ أُدرج مباشرة بإصدار تطبيق سابق على
     * CUST-H1-1 فحصل على قيمة العمود الافتراضية رغم أن محتواه v2 فعلياً) —
     * الوسم المضمَّن هو مصدر الحقيقة، أياً كان مصدر القراءة أو النسخ.
     *
     * @param  array<string, mixed>  $config
     */
    public static function effectiveSchemaTag(array $config, ?int $columnFallback): int
    {
        if (isset($config['version']) && is_numeric($config['version'])) {
            return (int) $config['version'];
        }

        return $columnFallback ?? 1;
    }

    public function sanitizeExternalUrl(?string $value): ?string
    {
        $trimmed = trim((string) $value);
        if ($trimmed === '') {
            return null;
        }
        if (preg_match('/^(javascript|data|vbscript|file):/i', $trimmed) === 1) {
            return null;
        }
        if (preg_match('/^https:\/\//i', $trimmed) !== 1) {
            return null;
        }

        $parts = parse_url($trimmed);
        if (! is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
            return null;
        }

        $rebuilt = 'https://'.$parts['host'];
        if (isset($parts['port'])) {
            $rebuilt .= ':'.$parts['port'];
        }
        $rebuilt .= $parts['path'] ?? '';
        if (isset($parts['query'])) {
            $rebuilt .= '?'.$parts['query'];
        }
        if (isset($parts['fragment'])) {
            $rebuilt .= '#'.$parts['fragment'];
        }

        return $rebuilt;
    }

    /**
     * CUST-HV V4a — شعار/شعار مصغّر/أيقونة المتصفح كـ`MediaRef` (يحلّ DEF-5: لا Base64
     * مكرّراً في كل نسخة). مفاتيح **إضافية اختيارية** تُصدَر فقط عند وجود مرجعٍ صالح؛
     * وإن وُجد المرجع والحقل القديم معاً فالمرجع هو الأسبق عرضاً. الحقول القديمة
     * (data-URL/https) تُقرأ وتُعرض إلى الأبد؛ الترحيل كسول عند الحفظ التالي لا
     * إعادة كتابة جماعية.
     *
     * @param  array<string,mixed>  $brandingRaw
     * @return array<string,array<string,mixed>>
     */
    private function brandingMedia(array $brandingRaw): array
    {
        $out = [];
        foreach (['logoMedia', 'compactLogoMedia', 'faviconMedia'] as $key) {
            $ref = StorefrontMediaRefNormalizer::normalize($brandingRaw[$key] ?? null);
            if ($ref !== null) {
                $out[$key] = $ref;
            }
        }

        return $out;
    }

    public function sanitizeLogoUrl(?string $value): ?string
    {
        $trimmed = trim((string) $value);
        if ($trimmed === '') {
            return null;
        }
        if (str_starts_with(strtolower($trimmed), 'data:image/svg')) {
            return null;
        }
        if (preg_match('/^(https:\/\/[^\s]+|data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+\/]+=*)$/i', $trimmed) !== 1) {
            return null;
        }
        if (str_starts_with(strtolower($trimmed), 'https://')) {
            return $this->sanitizeExternalUrl($trimmed);
        }

        return $trimmed;
    }

    /**
     * CUST-HV V5a — يطبّع `palette` (V0 §4.1): أدوار hex آمنة فقط، بحروف صغيرة (شكل
     * قانوني واحد)، بترتيب الأدوار الثابت؛ ما عداها يُسقط بمفرده. `null` = غياب.
     *
     * @return array<string,string>|null
     */
    private function normalizePalette(mixed $raw): ?array
    {
        $object = $this->object($raw);
        $palette = [];
        foreach (self::PALETTE_ROLES as $role) {
            $value = trim($this->asString($object[$role] ?? null));
            if ($this->isSafeHexColor($value)) {
                $palette[$role] = strtolower($value);
            }
        }

        return $palette === [] ? null : $palette;
    }

    public function isSafeHexColor(string $value): bool
    {
        return preg_match('/^#([0-9a-fA-F]{6})$/', trim($value)) === 1;
    }

    private function cappedLogo(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (strlen($value) > self::MAX_LOGO_BYTES) {
            return null;
        }

        return $value;
    }

    private function isSafeAppStoreUrl(string $value): bool
    {
        $url = $this->sanitizeExternalUrl($value);
        if ($url === null) {
            return false;
        }
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));

        return $host === 'apps.apple.com';
    }

    private function isSafePlayStoreUrl(string $value): bool
    {
        $url = $this->sanitizeExternalUrl($value);
        if ($url === null) {
            return false;
        }
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));

        return $host === 'play.google.com' || $host === 'play.app.goo.gl';
    }

    /**
     * يحسم أقسام الصفحة المخزّنة إلى instances آمنة.
     *
     * يقبل الشكلين: instance v2 `{id, type, visible}` (الهوية = id)،
     * وlegacy v1 `{key, visible}` الذي يُرحَّل إلى id = key بشكل
     * deterministic (بلا معرّفات عشوائية إطلاقاً). الأنواع المجهولة
     * والمدخلات المشوّهة تُسقط fail-closed، والـids المكررة تنهار إلى
     * أول ورود بشكل deterministic.
     *
     * دلالات الغياب بالإصدار: الوثائق legacy تُعاد إلحاق الأقسام
     * الافتراضية الناقصة لها كما كان v1 يفعل؛ وثائق v2 تعتبر الغياب حذفاً.
     *
     * @param  list<array{id: string, type: string, visible: bool}>  $defaults
     * @return list<array{id: string, type: string, visible: bool}>
     */
    private function resolveHomeBuilderSections(mixed $configured, array $defaults, bool $legacy): array
    {
        if (! is_array($configured) || $configured === []) {
            return $legacy ? $defaults : [];
        }

        $out = [];
        $seenIds = [];
        $seenTypes = [];
        foreach ($configured as $section) {
            if (! is_array($section)) {
                continue;
            }

            if (array_key_exists('id', $section) || array_key_exists('type', $section)) {
                $id = $this->safeId($section['id'] ?? null, '');
                $type = $this->asString($section['type'] ?? null);
                if ($id === '') {
                    continue;
                }
            } else {
                $id = $this->asString($section['key'] ?? null);
                $type = $id;
            }

            if (! in_array($type, self::HOME_BUILDER_SECTION_KEYS, true) && ! in_array($type, self::HOME_DATA_SECTION_KEYS, true)) {
                continue;
            }
            if (isset($seenIds[$id])) {
                continue;
            }

            $seenIds[$id] = true;
            $seenTypes[$type] = true;
            $instance = [
                'id' => $id,
                'type' => $type,
                'visible' => (bool) ($section['visible'] ?? false),
            ];
            $content = $this->normalizeOptionalSectionContent($type, $section['content'] ?? null);
            if ($content !== null) {
                $instance['content'] = $content;
            }
            // CUST-HV V5b — تصميم القسم المكتوب (V0 §3). الغياب = بلا مفتاح ⇒ بلا تغيير.
            $design = StorefrontSectionDesignNormalizer::normalize($type, $section['design'] ?? null);
            if ($design !== null) {
                $instance['design'] = $design;
            }
            $out[] = $instance;
            if (count($out) >= self::MAX_HOME_SECTIONS) {
                break;
            }
        }

        if ($legacy) {
            foreach ($defaults as $fallback) {
                if (! isset($seenTypes[$fallback['type']])) {
                    $out[] = $fallback;
                }
            }
        }

        return $out;
    }

    /**
     * محتوى اختياري لكل instance. الغياب يعني فارغاً، والمحتوى الفارغ
     * لا يُكتب حتى تبقى وثائق {id,type,visible} كما هي. الأنواع التي
     * لا تحمل محتوى تُسقِط أي content يُهرَّب (offers صار يحمل `offerIds` منذ CUST-H4-7).
     *
     * @return array<string, mixed>|null
     */
    private function normalizeOptionalSectionContent(string $type, mixed $raw): ?array
    {
        $source = $this->object($raw);

        if ($type === 'banner') {
            $content = [
                'title' => mb_substr(trim($this->asString($source['title'] ?? null)), 0, 120),
                'subtitle' => mb_substr(trim($this->asString($source['subtitle'] ?? null)), 0, 200),
                'ctaLabel' => mb_substr(trim($this->asString($source['ctaLabel'] ?? null)), 0, 80),
                'ctaHref' => $this->sanitizeContentHref($this->asString($source['ctaHref'] ?? null)),
                'imageUrl' => $this->sanitizeExternalUrl($this->asString($source['imageUrl'] ?? null)),
                // CUST-H4-4 — optional, plain text only. Not part of the
                // emptiness check below: stray alt text with no title,
                // subtitle, CTA, or image is still an empty banner.
                'imageAlt' => mb_substr(trim($this->asString($source['imageAlt'] ?? null)), 0, self::MAX_BANNER_IMAGE_ALT_LENGTH),
            ];
            $empty = $content['title'] === ''
                && $content['subtitle'] === ''
                && $content['ctaLabel'] === ''
                && $content['ctaHref'] === ''
                && $content['imageUrl'] === null;

            return $empty ? null : $content;
        }

        if ($type === 'benefits') {
            $items = [];
            $seen = [];
            foreach (array_values(is_array($source['items'] ?? null) ? $source['items'] : []) as $index => $item) {
                if (! is_array($item) || array_is_list($item)) {
                    continue;
                }
                $title = mb_substr(trim($this->asString($item['title'] ?? null)), 0, 80);
                $body = mb_substr(trim($this->asString($item['body'] ?? null)), 0, 200);
                $id = $this->safeId($item['id'] ?? null, 'benefit-'.$index);
                if ($id === '' || isset($seen[$id])) {
                    continue;
                }
                $seen[$id] = true;
                $items[] = ['id' => $id, 'title' => $title, 'body' => $body];
                if (count($items) >= self::MAX_BENEFIT_ITEMS) {
                    break;
                }
            }

            return $items === [] ? null : ['items' => $items];
        }

        if ($type === 'customContent') {
            $blocks = [];
            $seen = [];
            foreach (array_values(is_array($source['blocks'] ?? null) ? $source['blocks'] : []) as $index => $block) {
                if (! is_array($block) || array_is_list($block)) {
                    continue;
                }
                $kind = $block['kind'] ?? null;
                if ($kind !== 'heading' && $kind !== 'paragraph') {
                    continue;
                }
                $limit = $kind === 'heading' ? 120 : 600;
                $text = mb_substr(trim($this->asString($block['text'] ?? null)), 0, $limit);
                $id = $this->safeId($block['id'] ?? null, 'block-'.$index);
                if ($id === '' || isset($seen[$id])) {
                    continue;
                }
                $seen[$id] = true;
                $blocks[] = ['id' => $id, 'kind' => $kind, 'text' => $text];
                if (count($blocks) >= self::MAX_CUSTOM_BLOCKS) {
                    break;
                }
            }

            return $blocks === [] ? null : ['blocks' => $blocks];
        }

        if ($type === 'featured') {
            $ids = [];
            $seen = [];
            foreach (is_array($source['productIds'] ?? null) ? $source['productIds'] : [] as $value) {
                if (! is_string($value)) {
                    continue;
                }
                $token = trim($value);
                if ($token !== '' && preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $token) !== 1) {
                    continue;
                }
                if (isset($seen[$token])) {
                    continue;
                }
                $seen[$token] = true;
                $ids[] = $token;
                if (count($ids) >= self::MAX_FEATURED_PRODUCTS) {
                    break;
                }
            }

            return $ids === [] ? null : ['productIds' => $ids];
        }

        if ($type === 'offers') {
            // CUST-H4-7 — مراجع `storefront_offers.id` فقط؛ لا منتج ولا اسم ولا
            // سعر ولا نسبة ولا تاريخ ولا حالة حياة (سلطة Commerce). توأم
            // normalizeOffers في ملفَّي section-content.ts.
            $ids = [];
            $seen = [];
            foreach (is_array($source['offerIds'] ?? null) ? $source['offerIds'] : [] as $value) {
                if (! is_string($value)) {
                    continue;
                }
                $token = trim($value);
                if (preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $token) !== 1) {
                    continue;
                }
                if (isset($seen[$token])) {
                    continue;
                }
                $seen[$token] = true;
                $ids[] = $token;
                if (count($ids) >= self::MAX_OFFERS) {
                    break;
                }
            }

            return $ids === [] ? null : ['offerIds' => $ids];
        }

        if ($type === 'productShelf') {
            // FLOWERS-H9 / ADR-21 — رفّ منتجات مرتبط بالبيانات: **مرجع مصدر فقط** (مجموعة أو قيمة بُعد وصفي) ومرشّح
            // «التسليم اليوم». لا معرّفات منتجات ولا أسعار ولا توفر ولا وعد — كلها تُقرأ حيّةً من واجهة المنتجات العامة.
            $title = mb_substr(trim($this->asString($source['title'] ?? null)), 0, self::MAX_SECTION_TITLE_LENGTH);
            $src = $this->object($source['source'] ?? null);
            $kind = $src['kind'] ?? null;
            $normalizedSource = null;
            if ($kind === 'collection') {
                $slug = $this->safeId($src['slug'] ?? null, '');
                $normalizedSource = $slug === '' ? null : ['kind' => 'collection', 'slug' => $slug];
            } elseif ($kind === 'facet') {
                $key = $this->safeId($src['key'] ?? null, '');
                $value = $this->safeId($src['value'] ?? null, '');
                $normalizedSource = $key === '' || $value === '' ? null : ['kind' => 'facet', 'key' => $key, 'value' => $value];
            }
            $deliverToday = ($source['deliverToday'] ?? false) === true;
            if ($normalizedSource === null && ! $deliverToday) {
                return null;
            }
            // عدد صحيح JSON: `6` و`6.0` كلاهما قيمةٌ صحيحة (PHP يفكّ الثانية float بينما JS لا يميّزها) — فتقبل التوائم
            // الثلاثة الاثنتين ولا ينحرف المعاينة عن المخزَّن. float غير صحيح أو غير منتهٍ ⇒ الافتراضي. القصّ قبل التحويل.
            $limit = $source['limit'] ?? null;
            $integral = is_int($limit) || (is_float($limit) && is_finite($limit) && floor($limit) === $limit);
            $limit = $integral ? (int) max(self::SHELF_LIMIT_MIN, min(self::SHELF_LIMIT_MAX, $limit)) : self::SHELF_LIMIT_DEFAULT;
            $content = ['title' => $title, 'deliverToday' => $deliverToday, 'limit' => $limit];
            if ($normalizedSource !== null) {
                $content['source'] = $normalizedSource;
            }

            return $content;
        }

        if ($type === 'discovery') {
            // FLOWERS-H9 / ADR-21 — «تسوّق حسب …»: محورٌ مُميَّز (`facet` بمفتاح بُعدٍ وصفي، أو `brand`)؛ القيم والأعداد
            // تُقرأ من ميتا قائمة المنتجات العامة، فلا تُخزَّن هنا ولا تُختلق.
            $axis = $this->inList($source['axis'] ?? null, self::DISCOVERY_AXES, 'facet');
            $dimension = $axis === 'facet' ? $this->safeId($source['dimension'] ?? null, '') : '';
            if ($axis === 'facet' && $dimension === '') {
                return null;
            }

            return array_filter([
                'title' => mb_substr(trim($this->asString($source['title'] ?? null)), 0, self::MAX_SECTION_TITLE_LENGTH),
                'axis' => $axis,
                'dimension' => $axis === 'facet' ? $dimension : null,
                'display' => $this->inList($source['display'] ?? null, self::DISCOVERY_DISPLAYS, 'tiles'),
            ], static fn ($v) => $v !== null);
        }

        if ($type === 'deliveryPromise') {
            // FLOWERS-H9 / ADR-21 — نصّ تحريري اختياري فقط؛ الموعد الفعلي يُقرأ حيّاً من `delivery-schedule`.
            $title = mb_substr(trim($this->asString($source['title'] ?? null)), 0, self::MAX_SECTION_TITLE_LENGTH);
            $body = mb_substr(trim($this->asString($source['body'] ?? null)), 0, self::MAX_DELIVERY_PROMISE_BODY_LENGTH);

            return $title === '' && $body === '' ? null : ['title' => $title, 'body' => $body];
        }

        return null;
    }

    private function sanitizeContentHref(string $value): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }
        if (str_starts_with($trimmed, '/')) {
            if (str_starts_with($trimmed, '//') || preg_match('/[\s<>"\']/', $trimmed) === 1) {
                return '';
            }

            return mb_substr($trimmed, 0, 240);
        }

        return $this->sanitizeExternalUrl($trimmed) ?? '';
    }

    /**
     * @param  list<array<string, mixed>>  $fallback
     * @return list<array<string, mixed>>
     */
    private function normalizeLinks(mixed $raw, array $fallback): array
    {
        if (! is_array($raw)) {
            return $fallback;
        }

        $links = [];
        foreach (array_values($raw) as $index => $item) {
            $link = $this->normalizeNavLink($item, $index);
            if ($link !== null) {
                $links[] = $link;
            }
            if (count($links) >= 12) {
                break;
            }
        }

        return $links;
    }

    /** @return array<string, mixed>|null */
    private function normalizeNavLink(mixed $raw, int $index): ?array
    {
        if (! is_array($raw) || array_is_list($raw)) {
            return null;
        }

        $kind = $this->inList($raw['kind'] ?? null, self::NAV_KINDS, 'home');
        $href = $kind === 'external'
            ? ($this->sanitizeExternalUrl($this->asString($raw['href'] ?? null)) ?? '')
            : mb_substr($this->asString($raw['href'] ?? null, '/'), 0, 240);

        return [
            'id' => $this->safeId($raw['id'] ?? null, 'nav-'.$index),
            'label' => mb_substr($this->asString($raw['label'] ?? null), 0, 80),
            'kind' => $kind,
            'href' => $href,
            'enabled' => $this->asBoolean($raw['enabled'] ?? null, true),
        ];
    }

    /** @return list<array<string, mixed>> */
    private function normalizeSocial(mixed $raw): array
    {
        if (! is_array($raw)) {
            return [];
        }

        $items = [];
        foreach (array_values($raw) as $index => $item) {
            if (! is_array($item) || array_is_list($item)) {
                continue;
            }
            $items[] = [
                'id' => $this->safeId($item['id'] ?? null, 'social-'.$index),
                'network' => $this->inList($item['network'] ?? null, self::SOCIAL_NETWORKS, 'instagram'),
                'url' => $this->sanitizeExternalUrl($this->asString($item['url'] ?? null)) ?? '',
                'enabled' => $this->asBoolean($item['enabled'] ?? null, true),
            ];
            if (count($items) >= 8) {
                break;
            }
        }

        return $items;
    }

    /**
     * @param  list<array<string, mixed>>  $fallback
     * @return list<array<string, mixed>>
     */
    private function normalizePages(mixed $raw, array $fallback): array
    {
        if (! is_array($raw)) {
            return $fallback;
        }

        $pages = [];
        foreach (array_values($raw) as $index => $item) {
            if (! is_array($item) || array_is_list($item)) {
                continue;
            }
            $pages[] = [
                'id' => $this->safeId($item['id'] ?? null, 'page-'.$index),
                'slug' => $this->inList($item['slug'] ?? null, self::CONTENT_PAGE_SLUGS, 'about'),
                'title' => mb_substr($this->asString($item['title'] ?? null), 0, 80),
                'enabled' => $this->asBoolean($item['enabled'] ?? null, false),
            ];
        }

        return $pages;
    }

    /**
     * CUST-HV V3 — يطبّع `announcements` (العقد §12.1). `null` = غياب: لا شريط
     * ولا كيان فارغ. كل حقل غير صالح يُسقط إلى «غير مضبوط» (لا إلى قيمة ظاهرة)،
     * **عدا `window`**: التاريخ المشوَّه يُحفظ حرفياً كما أدخله التاجر
     * (AMEND-7 — لا يُحوَّل أبداً إلى «بلا نافذة» فيصير الإعلان أكثر ظهوراً)،
     * ويُرفض عند النشر (`StorefrontPresentationPublishValidator`).
     *
     * @return array<string, mixed>|null
     */
    private function normalizeAnnouncements(mixed $raw): ?array
    {
        if (! is_array($raw) || $this->isList($raw)) {
            return null;
        }

        $items = [];
        $seen = [];
        $index = 0;
        foreach (is_array($raw['items'] ?? null) ? array_values($raw['items']) : [] as $rawItem) {
            if (! is_array($rawItem) || array_is_list($rawItem)) {
                continue;
            }
            $item = $this->normalizeAnnouncementItem($rawItem, $index);
            $index++;
            if (isset($seen[$item['id']])) {
                continue; // أول ورود يكسب عند تكرار المعرّف.
            }
            $seen[$item['id']] = true;
            $items[] = $item;
            if (count($items) >= self::ANNOUNCEMENT_MAX_ITEMS) {
                break;
            }
        }

        $behaviour = $this->normalizeAnnouncementBehaviour($this->object($raw['behaviour'] ?? null));
        $enabled = $this->asBoolean($raw['enabled'] ?? null, false);

        if (! $enabled && $items === [] && $behaviour === []) {
            return null;
        }

        $out = ['enabled' => $enabled, 'items' => $items];
        if ($behaviour !== []) {
            $out['behaviour'] = $behaviour;
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $raw
     * @return array<string, mixed>
     */
    private function normalizeAnnouncementItem(array $raw, int $index): array
    {
        $text = preg_replace('/\p{Cc}+/u', ' ', $this->asString($raw['text'] ?? null)) ?? '';
        $item = [
            'id' => $this->safeId($raw['id'] ?? null, 'ann-'.$index),
            'text' => mb_substr(trim($text), 0, self::ANNOUNCEMENT_TEXT_MAX),
            'enabled' => $this->asBoolean($raw['enabled'] ?? null, true),
        ];

        $icon = $raw['icon'] ?? null;
        if (is_string($icon) && in_array($icon, self::ANNOUNCEMENT_ICONS, true)) {
            $item['icon'] = $icon;
        }

        $href = $this->announcementHref($this->asString($raw['href'] ?? null));
        if ($href !== null) {
            $item['href'] = $href;
        }

        $surface = $this->normalizeAnnouncementSurface($this->object($raw['surface'] ?? null));
        if ($surface !== []) {
            $item['surface'] = $surface;
        }

        $window = $this->object($raw['window'] ?? null);
        $keptWindow = [];
        foreach (['startsAt', 'endsAt'] as $edge) {
            $value = is_string($window[$edge] ?? null) ? mb_substr(trim($window[$edge]), 0, 40) : '';
            if ($value !== '') {
                $keptWindow[$edge] = $value;
            }
        }
        if ($keptWindow !== []) {
            $item['window'] = $keptWindow;
        }

        $pages = [];
        foreach (is_array($raw['pages'] ?? null) ? array_values($raw['pages']) : [] as $page) {
            if (is_string($page) && in_array($page, self::ANNOUNCEMENT_PAGES, true) && ! in_array($page, $pages, true)) {
                $pages[] = $page;
            }
        }
        if ($pages !== []) {
            // «الكل» يغني عن غيره؛ الغياب يعني الكل أيضاً فلا يُخزَّن.
            $pages = in_array('all', $pages, true) ? ['all'] : array_values(array_intersect(self::ANNOUNCEMENT_PAGES, $pages));
            if ($pages !== ['all']) {
                $item['pages'] = $pages;
            }
        }

        return $item;
    }

    /** رابط داخلي (`/path`) أو https خارجي آمن؛ غير ذلك يُسقط. */
    private function announcementHref(string $value): ?string
    {
        $value = trim($value);
        if ($value === '' || mb_strlen($value) > 240) {
            return null;
        }
        if (str_starts_with($value, '/')) {
            return preg_match('#^/(?!/)[A-Za-z0-9\-._~!$&()*+,;=:@%/?\#\[\]]*$#', $value) === 1 ? $value : null;
        }

        return $this->sanitizeExternalUrl($value);
    }

    /**
     * ألوان صلبة فقط (`{hex}`). النص/الرابط لا يُحفظان بلا خلفية مخصَّصة: اللون
     * الأمامي حينها «تلقائي» (يُحسب أسود/أبيض بأعلى تباين) فلا يُنتَج زوج
     * غير مُثبَت التباين على سطح الثيم.
     *
     * @param  array<string, mixed>  $raw
     * @return array<string, array{hex: string}>
     */
    private function normalizeAnnouncementSurface(array $raw): array
    {
        $colour = function (mixed $value): ?array {
            $hex = is_array($value) && is_string($value['hex'] ?? null) ? trim($value['hex']) : '';

            return $this->isSafeHexColor($hex) ? ['hex' => strtolower($hex)] : null;
        };

        $background = $colour($raw['background'] ?? null);
        if ($background === null) {
            return [];
        }
        $surface = ['background' => $background];
        foreach (['text', 'link'] as $role) {
            $value = $colour($raw[$role] ?? null);
            if ($value !== null) {
                $surface[$role] = $value;
            }
        }

        return $surface;
    }

    /**
     * @param  array<string, mixed>  $raw
     * @return array<string, mixed>
     */
    private function normalizeAnnouncementBehaviour(array $raw): array
    {
        $out = [];
        $ticker = $this->asBoolean($raw['ticker'] ?? null, false);
        // الشريط المتحرك يستبعد التدوير (سطرٌ يجري لا يُدوَّر) — مصدر وحيد للقاعدة.
        $rotate = ! $ticker && $this->asBoolean($raw['rotate'] ?? null, false);

        if ($rotate) {
            $out['rotate'] = true;
            $interval = $raw['rotateInterval'] ?? null;
            if (is_int($interval) && in_array($interval, self::ANNOUNCEMENT_ROTATE_INTERVALS, true)
                && $interval !== self::ANNOUNCEMENT_DEFAULT_ROTATE_INTERVAL) {
                $out['rotateInterval'] = $interval;
            }
        }
        if ($ticker) {
            $out['ticker'] = true;
            $speed = $raw['tickerSpeed'] ?? null;
            if (is_string($speed) && in_array($speed, self::ANNOUNCEMENT_TICKER_SPEEDS, true) && $speed !== 'normal') {
                $out['tickerSpeed'] = $speed;
            }
        }
        foreach (['sticky', 'dismissible'] as $flag) {
            if ($this->asBoolean($raw[$flag] ?? null, false)) {
                $out[$flag] = true;
            }
        }

        return $out;
    }

    /**
     * CUST-H2-1 — يطبّع مفتاح `pagePresentation` كاملاً. `null` تعني «لم
     * تُخصَّص بعد» ويجب ألا تُكتب إلى الوثيقة إطلاقاً — الغياب يبقى غياباً،
     * لا كِياناً فارغاً `{}`، حتى تستمر كل نسخة سابقة على CUST-H2 بالتطبيع
     * طبق الأصل بلا هذا المفتاح.
     *
     * @return array<string, mixed>|null
     */
    private function normalizePagePresentation(mixed $raw): ?array
    {
        if (! is_array($raw) || $this->isList($raw)) {
            return null;
        }

        $product = $this->normalizePageTypePresentation(
            $raw['product'] ?? null,
            self::PRODUCT_PAGE_REGION_KEYS,
            self::FIXED_REQUIRED_PRODUCT_REGION_KEYS,
        );
        $category = $this->normalizePageTypePresentation(
            $raw['category'] ?? null,
            self::CATEGORY_PAGE_REGION_KEYS,
            self::FIXED_REQUIRED_CATEGORY_REGION_KEYS,
        );

        if ($product === null && $category === null) {
            return null;
        }

        $result = [];
        if ($product !== null) {
            $result['product'] = $product;
        }
        if ($category !== null) {
            $result['category'] = $category;
        }

        return $result;
    }

    /**
     * يطبّع مستند نوع صفحة واحد `{version, regions}`. إصدار محتوى الصفحة
     * يتطور مستقلاً عن `version` الأعلى للوثيقة (عقد المعمارية، فقرة
     * «Normalization») — إصدار أعلى مما يدعمه هذا الإصدار يفشل إلى الغياب
     * بدل التخمين.
     *
     * @param  list<string>  $allowedKeys
     * @param  list<string>  $fixedRequiredKeys
     * @return array{version: int, regions: list<array{id: string, key: string, visible: bool}>}|null
     */
    private function normalizePageTypePresentation(mixed $raw, array $allowedKeys, array $fixedRequiredKeys): ?array
    {
        if (! is_array($raw) || $this->isList($raw)) {
            return null;
        }

        if (isset($raw['version']) && is_numeric($raw['version']) && (int) $raw['version'] > 1) {
            return null;
        }

        return [
            'version' => 1,
            'regions' => $this->normalizePageRegions($raw['regions'] ?? null, $allowedKeys, $fixedRequiredKeys),
        ];
    }

    /**
     * مفاتيح مجهولة أو من نوع صفحة آخر تُسقط fail-closed. الـid يسقط إلى
     * المفتاح نفسه حين غيابه/عدم أمانه — نفس اتفاقية `id = key` الحتمية
     * المستعملة لترحيل أقسام الصفحة الرئيسية. كل منطقة FIXED_REQUIRED تُجبَر
     * visible=true. التكرار بالمفتاح ينهار إلى أول ورود (maxInstances=1
     * وcanDuplicate=false لكل منطقة في H2 V1). لا `content` في هذا الإصدار
     * — لا عقد محتوى مُصنَّف لكل منطقة بعد (CUST-H2-3/H2-4).
     *
     * @param  list<string>  $allowedKeys
     * @param  list<string>  $fixedRequiredKeys
     * @return list<array{id: string, key: string, visible: bool}>
     */
    private function normalizePageRegions(mixed $raw, array $allowedKeys, array $fixedRequiredKeys): array
    {
        if (! is_array($raw) || ! $this->isList($raw)) {
            return [];
        }

        $out = [];
        $seenKeys = [];
        foreach ($raw as $entry) {
            if (! is_array($entry)) {
                continue;
            }

            $key = $this->asString($entry['key'] ?? null);
            if (! in_array($key, $allowedKeys, true)) {
                continue;
            }
            if (isset($seenKeys[$key])) {
                continue;
            }
            $seenKeys[$key] = true;

            $isFixedRequired = in_array($key, $fixedRequiredKeys, true);
            $out[] = [
                'id' => $this->safeId($entry['id'] ?? null, $key),
                'key' => $key,
                'visible' => $isFixedRequired ? true : (bool) ($entry['visible'] ?? false),
            ];
        }

        return $out;
    }

    private function safeId(mixed $value, string $fallback): string
    {
        $text = trim($this->asString($value, $fallback));

        return preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $text) === 1 ? $text : $fallback;
    }

    /** @param list<string> $list */
    private function inList(mixed $value, array $list, string $fallback): string
    {
        return is_string($value) && in_array($value, $list, true) ? $value : $fallback;
    }

    private function asString(mixed $value, string $fallback = ''): string
    {
        return is_string($value) ? $value : $fallback;
    }

    private function asBoolean(mixed $value, bool $fallback): bool
    {
        return is_bool($value) ? $value : $fallback;
    }

    /** @return array<string, mixed> */
    private function object(mixed $value): array
    {
        return is_array($value) && ! $this->isList($value) ? $value : [];
    }

    private function isList(array $value): bool
    {
        return $value === [] ? false : array_is_list($value);
    }
}
