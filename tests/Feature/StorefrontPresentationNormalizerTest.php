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
    public function legacy_verification_fields_are_readable_but_never_mint_verified_authority(): void
    {
        $normalized = $this->normalizer->normalize($this->fixture('v1-unsafe-input.json'));

        $this->assertFalse($normalized['verification']['requestedVerifiedLabel']);
        $this->assertSame('1234567890', $normalized['verification']['crNumber']);
        $this->assertSame('', $normalized['verification']['sourceUrl']);
        $this->assertArrayNotHasKey('is_verified', $normalized);
        $this->assertArrayNotHasKey('verified', $normalized);
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
    public function a_forward_schema_version_fails_closed_to_awj_modern_without_guessing(): void
    {
        $normalized = $this->normalizer->normalize(
            ['themePreset' => 'navy', 'primaryColor' => '#1e3a5f', 'version' => 9],
            9,
        );

        $this->assertSame($this->normalizer->defaultConfig(), $normalized);
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

    /** @return array<string, mixed> */
    private function fixture(string $name): array
    {
        $path = dirname(__DIR__).'/Fixtures/presentation/'.$name;
        $decoded = json_decode((string) file_get_contents($path), true);
        $this->assertIsArray($decoded, $path);

        return $decoded;
    }
}
