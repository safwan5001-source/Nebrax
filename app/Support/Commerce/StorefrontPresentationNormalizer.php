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
     */
    public const VERSION = 2;

    public const MAX_HOME_SECTIONS = 30;

    public const MAX_DOCUMENT_BYTES = 1572864; // 1.5 MiB

    public const MAX_LOGO_BYTES = 524288; // 512 KiB

    public const THEME_PRESETS = [
        'awj-modern' => '#12372a',
        'navy' => '#1e3a5f',
        'burgundy' => '#7f1d1d',
        'sand' => '#92400e',
        'slate' => '#334155',
    ];

    public const FONT_PRESETS = ['cairo-geist'];

    public const DENSITY_PRESETS = ['comfortable', 'compact'];

    public const RADIUS_PRESETS = ['default', 'subtle', 'sharp'];

    public const PRODUCT_CARD_PRESETS = ['standard', 'compact'];

    public const HEADER_STYLES = ['standard', 'compact'];

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

    public const IMPLEMENTED_HOME_SECTION_KEYS = [
        'hero',
        'categories',
        'newArrivals',
        'wholesale',
    ];

    public const NAV_KINDS = ['home', 'category', 'product', 'content', 'external'];

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

        return [
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
            ],
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
                'requestedVerifiedLabel' => $this->asBoolean($verificationRaw['requestedVerifiedLabel'] ?? null, false),
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
    }

    public function encodedSize(array $config): int
    {
        return strlen((string) json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
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

        return $host === 'apps.apple.com' || str_ends_with($host, '.apple.com');
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

            if (! in_array($type, self::HOME_BUILDER_SECTION_KEYS, true)) {
                continue;
            }
            if (isset($seenIds[$id])) {
                continue;
            }

            $seenIds[$id] = true;
            $seenTypes[$type] = true;
            $out[] = [
                'id' => $id,
                'type' => $type,
                'visible' => (bool) ($section['visible'] ?? false),
            ];
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
