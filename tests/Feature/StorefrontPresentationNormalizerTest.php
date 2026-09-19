<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontPresentationNormalizer;
use Tests\TestCase;

/**
 * STORE-BACKEND-1 — توأم PHP لـ normalizePresentationConfig v1.
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
        $default = $this->fixture('v1-default.json');

        $this->assertSame($default, $this->normalizer->defaultConfig());
        $this->assertSame($default, $this->normalizer->normalize(null));
        $this->assertSame($default, $this->normalizer->normalize('nope'));
        $this->assertSame($default, $this->normalizer->normalize(1));
        $this->assertSame('awj-modern', $this->normalizer->normalize([])['themePreset']);
        $this->assertSame('#12372a', $this->normalizer->normalize([])['primaryColor']);
        $this->assertSame(1, $this->normalizer->normalize([])['version']);
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
        $this->assertSame(1, $normalized['version']);
        $this->assertSame('Safe Name', $normalized['branding']['displayName']);
        $this->assertNull($normalized['branding']['logoDataUrl']);
        $this->assertNull($normalized['branding']['compactLogoDataUrl']);
        $this->assertNull($normalized['branding']['faviconDataUrl']);
        $this->assertSame('', $normalized['header']['links'][0]['href']);
        $this->assertStringContainsString('https://instagram.com', $normalized['header']['links'][1]['href']);
        $this->assertFalse(collect($normalized['homepage']['sections'])->contains(fn ($s) => $s['key'] === 'banner-html'));
        $this->assertTrue(collect($normalized['homepage']['sections'])->contains(fn ($s) => $s['key'] === 'hero' && $s['visible'] === false));
        $this->assertSame('', $normalized['social'][0]['url']);
        $this->assertSame('', $normalized['apps']['iosUrl']);
        $this->assertStringContainsString('play.google.com', $normalized['apps']['androidUrl']);
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

        $this->assertTrue($normalized['verification']['requestedVerifiedLabel']);
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

        $this->assertSame(1, $normalized['version']);
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
