<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontPresentationNormalizer;
use Tests\TestCase;

/**
 * STORE-BACKEND-1 + STORE-CUSTOMIZER-CONTRACT-2 — توأم PHP لـ
 * normalizePresentationConfig v2 مع دعم قراءة وثائق v1.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationNormalizerTest
 */
class StorefrontPresentationNormalizerTest extends TestCase
{
    private StorefrontPresentationNormalizer $normalizer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->normalizer = new StorefrontPresentationNormalizer;
    }

    /** @test */
    public function missing_or_non_object_input_fails_closed_to_awj_modern_defaults(): void
    {
        $default = $this->fixture('default-config.json');

        $this->assertSame($default, $this->normalizer->defaultConfig());
        $this->assertSame($default, $this->normalizer->normalize(null));
        $this->assertSame($default, $this->normalizer->normalize('nope'));
        $this->assertSame($default, $this->normalizer->normalize(1));
        $this->assertSame('awj-modern', $this->normalizer->normalize([])['themePreset']);
        $this->assertSame('#12372a', $this->normalizer->normalize([])['primaryColor']);
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, $this->normalizer->normalize([])['version']);
    }

    /** @test */
    public function awj_market_preset_is_accepted_with_its_own_default_primary_color(): void
    {
        $normalized = $this->normalizer->normalize(['themePreset' => 'awj-market']);

        $this->assertSame('awj-market', $normalized['themePreset']);
        $this->assertSame('#0f766e', $normalized['primaryColor']);
        $this->assertSame(
            StorefrontPresentationNormalizer::THEME_PRESETS['awj-market'],
            $normalized['primaryColor'],
        );
    }

    /** @test */
    public function a_stale_awj_market_typo_still_fails_closed_to_awj_modern(): void
    {
        $normalized = $this->normalizer->normalize(['themePreset' => 'awj-market-v0']);

        $this->assertSame('awj-modern', $normalized['themePreset']);
        $this->assertSame('#12372a', $normalized['primaryColor']);
    }

    /** @test */
    public function awj_market_does_not_change_the_no_presentation_defaults(): void
    {
        // Registering a new preset must not mutate defaultConfig()/no-presentation
        // behaviour — every existing AWJ Modern store stays AWJ Modern.
        $this->assertSame('awj-modern', $this->normalizer->defaultConfig()['themePreset']);
        $this->assertSame('awj-modern', $this->normalizer->normalize(null)['themePreset']);
        $this->assertSame('comfortable', $this->normalizer->normalize(null)['density']);
        $this->assertSame('standard', $this->normalizer->normalize(null)['productCard']);
        $this->assertSame('standard', $this->normalizer->normalize(null)['header']['style']);
    }

    /** @test */
    public function unknown_keys_are_dropped_and_invalid_tokens_fail_closed(): void
    {
        $input = $this->fixture('v1-unsafe-input.json');
        $normalized = $this->normalizer->normalize($input);

        $this->assertArrayNotHasKey('unknownTop', $normalized);
        $this->assertSame('awj-modern', $normalized['themePreset']);
        $this->assertSame('#12372a', $normalized['primaryColor']);
        $this->assertNull($normalized['accentColor']);
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, $normalized['version']);
        $this->assertSame('Safe Name', $normalized['branding']['displayName']);
        $this->assertNull($normalized['branding']['logoDataUrl']);
        $this->assertNull($normalized['branding']['compactLogoDataUrl']);
        $this->assertNull($normalized['branding']['faviconDataUrl']);
        $this->assertSame('', $normalized['header']['links'][0]['href']);
        $this->assertStringContainsString('https://instagram.com', $normalized['header']['links'][1]['href']);
        $this->assertFalse(collect($normalized['homepage']['sections'])->contains(fn ($s) => $s['type'] === 'banner-html'));
        $this->assertTrue(collect($normalized['homepage']['sections'])->contains(fn ($s) => $s['type'] === 'hero' && $s['visible'] === false));
        $this->assertSame('', $normalized['social'][0]['url']);
        $this->assertSame('', $normalized['apps']['iosUrl']);
        $this->assertStringContainsString('play.google.com', $normalized['apps']['androidUrl']);
        $this->assertSame('', $this->normalizer->normalize([
            'apps' => ['iosUrl' => 'https://www.apple.com/iphone'],
        ])['apps']['iosUrl']);
        $this->assertStringContainsString('apps.apple.com', $this->normalizer->normalize([
            'apps' => ['iosUrl' => 'https://apps.apple.com/app/id1'],
        ])['apps']['iosUrl']);
    }

    /** @test */
    public function legacy_v1_sections_migrate_with_deterministic_ids_and_default_backfill(): void
    {
        $normalized = $this->normalizer->normalize($this->fixture('v1-unsafe-input.json'));
        $sections = $normalized['homepage']['sections'];

        // legacy migration: id = key، بلا UUID عشوائي.
        foreach ($sections as $section) {
            $this->assertSame($section['id'], $section['type']);
        }
        // دلالات v1: الأقسام الناقصة تُعاد إلحاقها من الافتراضي.
        $types = collect($sections)->pluck('type')->sort()->values()->all();
        $this->assertSame(
            collect(StorefrontPresentationNormalizer::HOME_BUILDER_SECTION_KEYS)->sort()->values()->all(),
            $types,
        );
    }

    /** @test */
    public function legacy_normalization_is_idempotent_across_repeated_passes(): void
    {
        $once = $this->normalizer->normalize($this->fixture('v1-unsafe-input.json'));
        $twice = $this->normalizer->normalize($once);

        $this->assertSame($once['homepage']['sections'], $twice['homepage']['sections']);
    }

    /** @test */
    public function v2_keeps_multiple_instances_of_the_same_type_in_order(): void
    {
        $normalized = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => [
                'sections' => [
                    ['id' => 'banner-a', 'type' => 'banner', 'visible' => true],
                    ['id' => 'hero', 'type' => 'hero', 'visible' => true],
                    ['id' => 'banner-b', 'type' => 'banner', 'visible' => false],
                ],
            ],
        ]);

        $this->assertSame(
            [
                ['id' => 'banner-a', 'type' => 'banner', 'visible' => true],
                ['id' => 'hero', 'type' => 'hero', 'visible' => true],
                ['id' => 'banner-b', 'type' => 'banner', 'visible' => false],
            ],
            $normalized['homepage']['sections'],
        );
    }

    /** @test */
    public function v2_absence_means_delete_and_never_resurrects_defaults(): void
    {
        $normalized = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => [
                'sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true]],
            ],
        ]);

        $this->assertSame(['hero'], collect($normalized['homepage']['sections'])->pluck('type')->all());
    }

    /** @test */
    public function v2_empty_sections_array_stays_empty(): void
    {
        $normalized = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => ['sections' => []],
        ]);

        $this->assertSame([], $normalized['homepage']['sections']);
    }

    /** @test */
    public function v2_drops_unknown_types_and_duplicate_ids_deterministically(): void
    {
        $normalized = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => [
                'sections' => [
                    ['id' => 'x-1', 'type' => 'evil-type', 'visible' => true],
                    ['id' => 'hero', 'type' => 'hero', 'visible' => false],
                    ['id' => 'hero', 'type' => 'hero', 'visible' => true],
                    ['id' => 'banner-1', 'type' => 'banner', 'visible' => true],
                ],
            ],
        ]);

        $this->assertSame(
            [
                ['id' => 'hero', 'type' => 'hero', 'visible' => false],
                ['id' => 'banner-1', 'type' => 'banner', 'visible' => true],
            ],
            $normalized['homepage']['sections'],
        );
    }

    /** @test */
    public function v2_rejects_unsafe_ids_and_caps_the_section_list(): void
    {
        $sections = [['id' => 'bad id!!', 'type' => 'banner', 'visible' => true]];
        for ($i = 0; $i < StorefrontPresentationNormalizer::MAX_HOME_SECTIONS + 5; $i++) {
            $sections[] = ['id' => 'banner-'.$i, 'type' => 'banner', 'visible' => true];
        }

        $normalized = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => ['sections' => $sections],
        ]);

        $this->assertCount(StorefrontPresentationNormalizer::MAX_HOME_SECTIONS, $normalized['homepage']['sections']);
        foreach ($normalized['homepage']['sections'] as $section) {
            $this->assertMatchesRegularExpression('/^[a-zA-Z0-9_-]{1,64}$/', $section['id']);
        }
    }

    /** @test */
    public function v2_round_trip_is_stable_across_repeated_normalization(): void
    {
        $input = [
            'version' => 2,
            'homepage' => [
                'sections' => [
                    ['id' => 'b1', 'type' => 'banner', 'visible' => true],
                    ['id' => 'hero', 'type' => 'hero', 'visible' => true],
                    ['id' => 'b2', 'type' => 'banner', 'visible' => false],
                ],
            ],
        ];

        $once = $this->normalizer->normalize($input);
        $twice = $this->normalizer->normalize($once);

        $this->assertSame($once['homepage']['sections'], $twice['homepage']['sections']);
        $this->assertSame(
            ['b1', 'hero', 'b2'],
            collect($twice['homepage']['sections'])->pluck('id')->all(),
        );
    }

    /** @test */
    public function unsafe_urls_are_rejected_and_https_is_kept(): void
    {
        $this->assertNull($this->normalizer->sanitizeExternalUrl('javascript:alert(1)'));
        $this->assertNull($this->normalizer->sanitizeExternalUrl('http://insecure.example'));
        $this->assertNull($this->normalizer->sanitizeExternalUrl('data:text/html,hi'));
        $this->assertNull($this->normalizer->sanitizeExternalUrl('vbscript:x'));
        $this->assertNull($this->normalizer->sanitizeExternalUrl('file:///etc/passwd'));
        $this->assertSame(
            'https://example.com/ok',
            $this->normalizer->sanitizeExternalUrl('https://example.com/ok'),
        );
        $this->assertNull($this->normalizer->sanitizeLogoUrl('data:image/svg+xml;base64,PHN2Zz4='));
        $this->assertNotNull($this->normalizer->sanitizeLogoUrl('https://cdn.example.com/logo.png'));
    }

    /** @test */
    public function verification_flag_is_stored_and_never_mints_verified_authority(): void
    {
        $normalized = $this->normalizer->normalize($this->fixture('v1-unsafe-input.json'));

        $this->assertFalse($normalized['verification']['requestedVerifiedLabel']);
        $this->assertSame('1234567890', $normalized['verification']['crNumber']);
        $this->assertSame('', $normalized['verification']['sourceUrl']);
        $this->assertArrayNotHasKey('is_verified', $normalized);
        $this->assertArrayNotHasKey('verified', $normalized);
    }

    /** @test */
    public function sbc_values_are_opaque_and_trimmed_only_at_normalization_boundary(): void
    {
        $normalized = $this->normalizer->normalize([
            'sbc' => [
                'authentication_number' => '  000123  ',
                'seal_token' => "  token=AbC +/  ",
                'show_in_storefront' => true,
            ],
        ]);

        $this->assertSame('000123', $normalized['sbc']['authentication_number']);
        $this->assertSame('token=AbC +/', $normalized['sbc']['seal_token']);
        $this->assertTrue($normalized['sbc']['show_in_storefront']);
        $this->assertSame('', $this->normalizer->normalize([])['sbc']['authentication_number']);
        $this->assertSame('', $this->normalizer->normalize([])['sbc']['seal_token']);
        $this->assertFalse($this->normalizer->normalize([])['sbc']['show_in_storefront']);
    }

    /** @test */
    public function oversized_logo_data_urls_are_stored_as_null(): void
    {
        $huge = 'data:image/png;base64,'.str_repeat('A', StorefrontPresentationNormalizer::MAX_LOGO_BYTES);
        $normalized = $this->normalizer->normalize([
            'branding' => ['logoDataUrl' => $huge],
        ]);

        $this->assertNull($normalized['branding']['logoDataUrl']);
    }

    /** @test */
    public function font_preset_accepts_known_values_and_fails_closed_to_cairo_geist(): void
    {
        $this->assertSame('cairo-geist', $this->normalizer->normalize([])['fontPreset']);
        $this->assertSame(
            'cairo-geist',
            $this->normalizer->normalize(['fontPreset' => 'cairo-geist'])['fontPreset'],
        );
        $this->assertSame(
            'tajawal-geist',
            $this->normalizer->normalize(['fontPreset' => 'tajawal-geist'])['fontPreset'],
        );
        $this->assertSame(
            'cairo-geist',
            $this->normalizer->normalize(['fontPreset' => 'helvetica-geist'])['fontPreset'],
        );
        $this->assertSame(
            ['cairo-geist', 'tajawal-geist'],
            StorefrontPresentationNormalizer::FONT_PRESETS,
        );
    }

    /** @test */
    public function accent_color_round_trips_without_becoming_a_public_consumer_bound_field(): void
    {
        // CUST-H3-2 — accentColor stays accepted/persisted for backward
        // compatibility; it is not a public semantic consumer, so it carries
        // no public-facing derivation the way primaryColor drives
        // presentationCssVars(). This test only guards the normalizer's
        // round-trip, not any UI exposure (none exists today).
        $normalized = $this->normalizer->normalize(['accentColor' => '#ff00aa']);
        $this->assertSame('#ff00aa', $normalized['accentColor']);

        $twice = $this->normalizer->normalize($normalized);
        $this->assertSame('#ff00aa', $twice['accentColor']);

        $this->assertNull($this->normalizer->normalize(['accentColor' => 'not-a-hex'])['accentColor']);
        $this->assertNull($this->normalizer->normalize([])['accentColor']);
    }

    /** @test */
    public function a_forward_schema_version_fails_closed_to_awj_modern_without_guessing(): void
    {
        $normalized = $this->normalizer->normalize(
            ['themePreset' => 'navy', 'primaryColor' => '#1e3a5f', 'version' => 9],
            9,
        );

        $this->assertSame($this->normalizer->defaultConfig(), $normalized);
    }

    /** @test */
    public function section_content_is_optional_structured_and_fail_closed(): void
    {
        $normalized = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => [
                'sections' => [
                    [
                        'id' => 'banner-a',
                        'type' => 'banner',
                        'visible' => true,
                        'content' => [
                            'title' => 'عرض',
                            'subtitle' => '<b>not html</b>',
                            'ctaLabel' => 'تسوّق',
                            'ctaHref' => 'javascript:alert(1)',
                            'imageUrl' => 'https://cdn.example.com/banner.jpg',
                            'html' => '<script>alert(1)</script>',
                        ],
                    ],
                    [
                        'id' => 'offers-a',
                        'type' => 'offers',
                        'visible' => true,
                        'content' => ['discountPercent' => 50],
                    ],
                    [
                        'id' => 'feat-a',
                        'type' => 'featured',
                        'visible' => true,
                        'content' => [
                            'productIds' => ['prod-1', 'prod-1', 'bad id', 'prod-2'],
                            'price' => 100,
                        ],
                    ],
                ],
            ],
        ]);

        $sections = collect($normalized['homepage']['sections'])->keyBy('id');
        $banner = $sections['banner-a'];
        $this->assertSame('عرض', $banner['content']['title']);
        $this->assertSame('<b>not html</b>', $banner['content']['subtitle']);
        $this->assertSame('', $banner['content']['ctaHref']);
        $this->assertSame('https://cdn.example.com/banner.jpg', $banner['content']['imageUrl']);
        $this->assertArrayNotHasKey('html', $banner['content']);
        $this->assertArrayNotHasKey('content', $sections['offers-a']);
        $this->assertSame(['prod-1', 'prod-2'], $sections['feat-a']['content']['productIds']);
        $this->assertArrayNotHasKey('price', $sections['feat-a']['content']);

        $plain = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => [
                'sections' => [
                    ['id' => 'banner-a', 'type' => 'banner', 'visible' => true],
                ],
            ],
        ]);
        $this->assertArrayNotHasKey('content', $plain['homepage']['sections'][0]);
    }

    /**
     * CUST-H4-4 — banner `imageAlt`: additive, bounded, plain text.
     *
     * @test
     */
    public function banner_image_alt_is_trimmed_bounded_plain_text_and_additive(): void
    {
        $normalized = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => [
                'sections' => [
                    [
                        'id' => 'banner-a',
                        'type' => 'banner',
                        'visible' => true,
                        'content' => [
                            'title' => 'عرض',
                            'imageUrl' => 'https://cdn.example.com/banner.jpg',
                            'imageAlt' => '  '.str_repeat('a', 400).'  ',
                        ],
                    ],
                ],
            ],
        ]);

        $alt = $normalized['homepage']['sections'][0]['content']['imageAlt'];
        $this->assertSame(StorefrontPresentationNormalizer::MAX_BANNER_IMAGE_ALT_LENGTH, mb_strlen($alt));
        $this->assertSame(str_repeat('a', StorefrontPresentationNormalizer::MAX_BANNER_IMAGE_ALT_LENGTH), $alt);
    }

    /** @test */
    public function banner_image_alt_defaults_to_empty_string_for_pre_h4_4_documents(): void
    {
        // A document stored before this field existed carries no `imageAlt`
        // key at all. The server must not fail or omit the key — it
        // normalizes to the empty string, same as every other banner string
        // field's absence.
        $normalized = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => [
                'sections' => [
                    [
                        'id' => 'banner-a',
                        'type' => 'banner',
                        'visible' => true,
                        'content' => [
                            'title' => 'عرض',
                            'imageUrl' => 'https://cdn.example.com/banner.jpg',
                        ],
                    ],
                ],
            ],
        ]);

        $this->assertSame('', $normalized['homepage']['sections'][0]['content']['imageAlt']);
    }

    /** @test */
    public function banner_image_alt_alone_does_not_make_an_otherwise_empty_banner_non_empty(): void
    {
        $normalized = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => [
                'sections' => [
                    [
                        'id' => 'banner-a',
                        'type' => 'banner',
                        'visible' => true,
                        'content' => ['imageAlt' => 'stray text with nothing else'],
                    ],
                ],
            ],
        ]);

        $this->assertArrayNotHasKey('content', $normalized['homepage']['sections'][0]);
    }

    /** @test */
    public function banner_image_alt_rejects_a_non_string_value_to_the_empty_default(): void
    {
        $normalized = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => [
                'sections' => [
                    [
                        'id' => 'banner-a',
                        'type' => 'banner',
                        'visible' => true,
                        'content' => [
                            'title' => 'عرض',
                            'imageAlt' => ['not' => 'a string'],
                        ],
                    ],
                ],
            ],
        ]);

        $this->assertSame('', $normalized['homepage']['sections'][0]['content']['imageAlt']);
    }

    /** @test */
    public function client_supplied_version_is_overwritten_and_is_not_authority(): void
    {
        $normalized = $this->normalizer->normalize([
            'version' => 99,
            'themePreset' => 'navy',
        ]);

        $this->assertSame(StorefrontPresentationNormalizer::VERSION, $normalized['version']);
        $this->assertSame('navy', $normalized['themePreset']);
        $this->assertSame('#1e3a5f', $normalized['primaryColor']);
    }

    /** @test */
    public function page_presentation_is_absent_by_default_and_version_bumps_to_three(): void
    {
        $this->assertSame(3, StorefrontPresentationNormalizer::VERSION);
        $this->assertArrayNotHasKey('pagePresentation', $this->normalizer->defaultConfig());
        $this->assertArrayNotHasKey('pagePresentation', $this->normalizer->normalize(null));
        $this->assertArrayNotHasKey('pagePresentation', $this->normalizer->normalize([]));
        $this->assertSame(3, $this->normalizer->normalize([])['version']);
    }

    /** @test */
    public function a_pre_cust_h2_document_normalizes_byte_identically_aside_from_the_version_bump(): void
    {
        $legacyV2 = [
            'version' => 2,
            'themePreset' => 'navy',
            'homepage' => ['sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true]]],
        ];

        $normalized = $this->normalizer->normalize($legacyV2);

        $this->assertArrayNotHasKey('pagePresentation', $normalized);
        $this->assertSame(3, $normalized['version']);
        $this->assertSame('navy', $normalized['themePreset']);
    }

    /** @test */
    public function an_empty_or_malformed_page_presentation_object_collapses_to_absent(): void
    {
        $this->assertArrayNotHasKey('pagePresentation', $this->normalizer->normalize(['pagePresentation' => []]));
        $this->assertArrayNotHasKey('pagePresentation', $this->normalizer->normalize(['pagePresentation' => 'nope']));
        $this->assertArrayNotHasKey('pagePresentation', $this->normalizer->normalize(['pagePresentation' => ['a', 'b']]));
        $this->assertArrayNotHasKey('pagePresentation', $this->normalizer->normalize([
            'pagePresentation' => ['product' => null, 'category' => 'x'],
        ]));
    }

    /** @test */
    public function product_regions_accept_valid_keys_and_default_id_to_key(): void
    {
        $normalized = $this->normalizer->normalize([
            'pagePresentation' => [
                'product' => [
                    'version' => 1,
                    'regions' => [
                        ['key' => 'description', 'visible' => true],
                        ['id' => 'sku-1', 'key' => 'sku_options_details', 'visible' => false],
                    ],
                ],
            ],
        ]);

        $this->assertArrayNotHasKey('category', $normalized['pagePresentation']);
        $regions = collect($normalized['pagePresentation']['product']['regions'])->keyBy('key');
        $this->assertSame(1, $normalized['pagePresentation']['product']['version']);
        $this->assertSame('description', $regions['description']['id']);
        $this->assertTrue($regions['description']['visible']);
        $this->assertSame('sku-1', $regions['sku_options_details']['id']);
        $this->assertFalse($regions['sku_options_details']['visible']);
    }

    /** @test */
    public function unknown_and_cross_page_type_region_keys_are_dropped(): void
    {
        $normalized = $this->normalizer->normalize([
            'pagePresentation' => [
                'product' => [
                    'regions' => [
                        ['key' => 'evil-key', 'visible' => true],
                        // A real Category key sent under Product must be dropped too,
                        // even though it is valid for a different page type.
                        ['key' => 'breadcrumbs', 'visible' => true],
                        ['key' => 'description', 'visible' => true],
                    ],
                ],
            ],
        ]);

        $keys = collect($normalized['pagePresentation']['product']['regions'])->pluck('key')->all();
        $this->assertSame(['description'], $keys);
    }

    /** @test */
    public function duplicate_region_keys_collapse_to_the_first_occurrence(): void
    {
        $normalized = $this->normalizer->normalize([
            'pagePresentation' => [
                'category' => [
                    'regions' => [
                        ['id' => 'first', 'key' => 'description', 'visible' => true],
                        ['id' => 'second', 'key' => 'description', 'visible' => false],
                    ],
                ],
            ],
        ]);

        $regions = $normalized['pagePresentation']['category']['regions'];
        $this->assertCount(1, $regions);
        $this->assertSame('first', $regions[0]['id']);
        $this->assertTrue($regions[0]['visible']);
    }

    /** @test */
    public function fixed_required_regions_are_forced_visible_regardless_of_input(): void
    {
        $normalized = $this->normalizer->normalize([
            'pagePresentation' => [
                'product' => [
                    'regions' => [
                        ['key' => 'media_gallery', 'visible' => false],
                        ['key' => 'identity', 'visible' => false],
                        ['key' => 'price', 'visible' => false],
                        ['key' => 'quantity_cta', 'visible' => false],
                    ],
                ],
                'category' => [
                    'regions' => [
                        ['key' => 'breadcrumbs', 'visible' => false],
                        ['key' => 'identity_title', 'visible' => false],
                        ['key' => 'filter_sort_bar', 'visible' => false],
                        ['key' => 'product_grid', 'visible' => false],
                    ],
                ],
            ],
        ]);

        foreach ($normalized['pagePresentation']['product']['regions'] as $region) {
            $this->assertTrue($region['visible'], $region['key']);
        }
        foreach ($normalized['pagePresentation']['category']['regions'] as $region) {
            $this->assertTrue($region['visible'], $region['key']);
        }
    }

    /** @test */
    public function variant_selector_is_not_forced_visible_because_it_is_data_dependent(): void
    {
        $normalized = $this->normalizer->normalize([
            'pagePresentation' => [
                'product' => [
                    'regions' => [
                        ['key' => 'variant_selector', 'visible' => false],
                    ],
                ],
            ],
        ]);

        $this->assertFalse($normalized['pagePresentation']['product']['regions'][0]['visible']);
    }

    /** @test */
    public function region_content_is_always_dropped_in_this_slice(): void
    {
        $normalized = $this->normalizer->normalize([
            'pagePresentation' => [
                'product' => [
                    'regions' => [
                        ['key' => 'description', 'visible' => true, 'content' => ['text' => 'hello']],
                    ],
                ],
            ],
        ]);

        $this->assertArrayNotHasKey('content', $normalized['pagePresentation']['product']['regions'][0]);
    }

    /** @test */
    public function a_forward_page_content_schema_version_drops_that_page_type_only(): void
    {
        $normalized = $this->normalizer->normalize([
            'pagePresentation' => [
                'product' => [
                    'version' => 99,
                    'regions' => [['key' => 'description', 'visible' => true]],
                ],
                'category' => [
                    'version' => 1,
                    'regions' => [['key' => 'description', 'visible' => true]],
                ],
            ],
        ]);

        $this->assertArrayNotHasKey('product', $normalized['pagePresentation']);
        $this->assertArrayHasKey('category', $normalized['pagePresentation']);
    }

    /** @test */
    public function page_presentation_round_trips_stably_across_repeated_normalization(): void
    {
        $input = [
            'pagePresentation' => [
                'product' => [
                    'regions' => [
                        ['key' => 'media_gallery', 'visible' => false],
                        ['key' => 'description', 'visible' => true],
                    ],
                ],
            ],
        ];

        $once = $this->normalizer->normalize($input);
        $twice = $this->normalizer->normalize($once);

        $this->assertSame($once['pagePresentation'], $twice['pagePresentation']);
    }

    /** @return array<string, mixed> */
    private function fixture(string $name): array
    {
        $path = dirname(__DIR__).'/Fixtures/presentation/'.$name;
        $decoded = json_decode((string) file_get_contents($path), true);
        $this->assertIsArray($decoded, $path);

        return $decoded;
    }
}
