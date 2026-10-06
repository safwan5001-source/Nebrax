<?php

namespace Tests\Feature;

use App\Models\StorefrontDomain;
use App\Models\StorefrontMedia;
use App\Models\StorefrontPresentation;
use App\Services\Commerce\StorefrontPublishedMediaResolver;
use App\Support\Commerce\StorefrontMediaRefNormalizer;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

/**
 * CUST-HV V4a — `MediaRef` (تطبيع بتكافؤ الفيكستشر مع التوأمين)، شعار/أيقونة
 * كمراجع وسائط، والحلّ العام `presentation_media` (V0 §3.2، §7.8).
 *
 * تشغيل: php artisan test --filter=StorefrontMediaRefTest
 */
class StorefrontMediaRefTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';
    private const PROXY = '/api/storefront/media/customizer/';

    private int $uploads = 0;

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    // ═════════════════ التطبيع (تكافؤ مع التوأمين) ═════════════════

    /** @test */
    public function the_normaliser_matches_the_shared_fixture_exactly(): void
    {
        $fixture = json_decode((string) file_get_contents(base_path('tests/Fixtures/presentation/media-ref.json')), true, flags: JSON_THROW_ON_ERROR);
        $this->assertGreaterThan(25, count($fixture['cases']));

        foreach ($fixture['cases'] as $case) {
            $actual = StorefrontMediaRefNormalizer::normalize($case['input']);
            $this->assertEquals($case['expected'], $actual, $case['name']);
            if ($actual !== null) {
                $this->assertSame(array_keys($case['expected']), array_keys($actual), $case['name'].' (key order)');
                // idempotent: a normalised ref is a fixed point.
                $this->assertEquals($actual, StorefrontMediaRefNormalizer::normalize($actual), $case['name'].' (idempotent)');
            }
        }
    }

    /** @test */
    public function branding_media_is_additive_optional_and_never_touches_the_legacy_fields(): void
    {
        $normalizer = app(StorefrontPresentationNormalizer::class);
        $id = '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e';

        $plain = $normalizer->normalize(['branding' => ['displayName' => 'نور', 'logoDataUrl' => 'https://cdn.example.com/a.png']], 3);
        $this->assertArrayNotHasKey('logoMedia', $plain['branding']);
        $this->assertArrayNotHasKey('faviconMedia', $plain['branding']);
        $this->assertSame('https://cdn.example.com/a.png', $plain['branding']['logoDataUrl']);

        $with = $normalizer->normalize(['branding' => [
            'logoDataUrl' => 'https://cdn.example.com/a.png',
            'logoMedia' => ['mediaId' => strtoupper($id), 'url' => 'https://evil.example/x.png'],
            'compactLogoMedia' => ['mediaId' => 'nope'],
            'faviconMedia' => ['mediaId' => $id, 'decorative' => true],
        ]], 3);
        $this->assertSame(['mediaId' => $id], $with['branding']['logoMedia']);
        $this->assertArrayNotHasKey('compactLogoMedia', $with['branding']);
        $this->assertSame(['mediaId' => $id, 'decorative' => true], $with['branding']['faviconMedia']);
        $this->assertSame('https://cdn.example.com/a.png', $with['branding']['logoDataUrl'], 'legacy renders forever');

        $this->assertEquals($with, $normalizer->normalize($with, 3), 'the document is a fixed point');
    }

    // ═════════════════ الحلّ العام ═════════════════

    /** @return array{auth:array<string,mixed>,storefront:\App\Models\Storefront,host:string} */
    private function store(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $seed = $this->seedMediaStorefront($auth['tenant_id']);
        $host = "{$slug}.example.com";

        app(TenantContext::class)->set($auth['tenant_id']);
        StorefrontDomain::create([
            'storefront_id' => $seed['storefront']->id,
            'hostname' => $host,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return ['auth' => $auth, 'storefront' => $seed['storefront'], 'host' => $host];
    }

    /** @return array<string,mixed> */
    private function uploadMedia(array $auth): array
    {
        $json = $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(1600 + $this->uploads++, 900))]], ['Accept' => 'application/json'])
            ->json();
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media'];
    }

    /** @param array<string,mixed> $config */
    private function publish(array $store, array $config): void
    {
        app(TenantContext::class)->set($store['auth']['tenant_id']);
        StorefrontPresentation::create([
            'storefront_id' => $store['storefront']->id,
            'schema_version' => 3,
            'draft_config' => [],
            'published_config' => $config,
            'published_revision' => 1,
        ]);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function the_public_config_resolves_published_media_to_proxy_sources_and_per_locale_alt(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('mr-config');
        $media = $this->uploadMedia($store['auth']);
        StorefrontMedia::withoutGlobalScopes()->whereKey($media['id'])->update(['alt_ar' => 'شعار المكتبة', 'alt_en' => 'Library logo']);
        $this->publish($store, ['branding' => [
            'logoMedia' => ['mediaId' => $media['id'], 'alt' => ['en' => 'Override']],
            'faviconMedia' => ['mediaId' => $media['id'], 'decorative' => true],
        ]]);

        $response = $this->getJson("http://{$store['host']}/store/v1/storefront")->assertOk();
        $resolved = $response->json('data.presentation_media');

        $this->assertSame(['branding.faviconMedia', 'branding.logoMedia'], collect(array_keys($resolved))->sort()->values()->all());
        $logo = $resolved['branding.logoMedia'];
        $this->assertSame(['ar' => 'شعار المكتبة', 'en' => 'Override'], $logo['alt'], 'override per locale, library fallback per locale');
        $this->assertFalse($logo['decorative']);
        $this->assertTrue($resolved['branding.faviconMedia']['decorative']);
        $this->assertSame($media['width'] ?? $logo['width'], $logo['width']);

        $kinds = array_count_values(array_column($logo['sources'], 'kind'));
        $this->assertSame(2, $kinds['thumb']);
        $this->assertGreaterThanOrEqual(4, $kinds['w']);
        foreach ($logo['sources'] as $source) {
            $this->assertStringStartsWith(self::PROXY.$media['id'].'/', $source['src']);
            $this->assertMatchesRegularExpression('/\/(\d{2,4}w|thumb-(160|320))\.(webp|jpg)$/', $source['src']);
        }

        // ما لا يخرج أبداً.
        $json = (string) $response->getContent();
        foreach (['/store/v1/media/customizer', 'storage_key', 'tenant/', 'sha256', 'original', 'bucket'] as $needle) {
            $this->assertStringNotContainsString($needle, $json);
        }
    }

    /** @test */
    public function a_transformed_usage_resolves_to_its_own_derivative_sources_at_their_real_sizes(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('mr-deriv');
        $media = $this->uploadMedia($store['auth']);
        $crop = ['x' => 0.1, 'y' => 0.1, 'w' => 0.3, 'h' => 0.5, 'aspect' => 'free-locked'];
        $this->withToken($store['auth']['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives', ['transform' => ['crop' => $crop]])
            ->assertOk()->assertJsonPath('data.state', 'ready');
        $this->publish($store, ['branding' => ['logoMedia' => ['mediaId' => $media['id'], 'crop' => $crop]]]);

        $logo = $this->getJson("http://{$store['host']}/store/v1/storefront")->assertOk()->json('data.presentation_media')['branding.logoMedia'];

        // 480×? قصّ 30%×50% من 1600×900 = 480×450 → كل العروض الأكبر تتطابق في حجمٍ واحد.
        $sizes = array_map(static fn (array $s): string => $s['width'].'x'.$s['height'].'.'.$s['format'], $logo['sources']);
        $this->assertSame(count($sizes), count(array_unique($sizes)), 'one entry per real size and format');
        $this->assertSame(['webp', 'jpg'], array_values(array_unique(array_column($logo['sources'], 'format'))), 'webp first, jpg fallback — both offered');
        foreach ($logo['sources'] as $source) {
            $this->assertMatchesRegularExpression('#^'.preg_quote(self::PROXY, '#').'[a-f0-9]{32}/\d{2,4}w\.(webp|jpg)$#', $source['src'], 'a transformKey, not the media id');
            $this->assertStringNotContainsString($media['id'], $source['src']);
            $this->assertLessThanOrEqual(480, $source['width']);
        }
        $this->assertSame(480, $logo['width']);
    }

    /** @test */
    public function anything_that_cannot_be_resolved_is_omitted_never_guessed(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('mr-omit');
        $other = $this->store('mr-omit-b');
        $ready = $this->uploadMedia($store['auth']);
        $gone = $this->uploadMedia($store['auth']);
        $foreign = $this->uploadMedia($other['auth']);
        StorefrontMedia::withoutGlobalScopes()->whereKey($gone['id'])->update(['state' => 'deleted']);

        $crop = ['x' => 0.1, 'y' => 0.1, 'w' => 0.3, 'h' => 0.5, 'aspect' => 'free-locked'];
        $this->publish($store, ['branding' => [
            'logoMedia' => ['mediaId' => $gone['id']],
            'compactLogoMedia' => ['mediaId' => $foreign['id']],            // أصلُ مستأجرٍ آخر
            'faviconMedia' => ['mediaId' => $ready['id'], 'crop' => $crop], // مشتقٌّ لم يُجهَّز
        ]]);

        $this->getJson("http://{$store['host']}/store/v1/storefront")->assertOk()
            ->assertJsonPath('data.presentation_media', []);
    }

    /** @test */
    public function a_published_document_without_media_returns_an_empty_object_and_does_not_query_the_library(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('mr-none');
        $this->publish($store, ['branding' => ['displayName' => 'x']]);

        $queries = [];
        \Illuminate\Support\Facades\DB::listen(static function ($q) use (&$queries): void {
            $queries[] = $q->sql;
        });

        $response = $this->getJson("http://{$store['host']}/store/v1/storefront")->assertOk();
        $this->assertSame('{}', json_encode($response->json('data.presentation_media')));
        $this->assertStringContainsString('"presentation_media":{}', (string) $response->getContent());
        $this->assertSame([], array_filter($queries, static fn (string $sql): bool => str_contains($sql, 'storefront_media')));
    }

    /** @test */
    public function the_resolver_is_pure_over_the_published_document_and_keys_by_reference_path(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('mr-path');
        $media = $this->uploadMedia($store['auth']);
        app(TenantContext::class)->set($store['auth']['tenant_id']);

        $resolved = app(StorefrontPublishedMediaResolver::class)->resolve([
            'branding' => ['logoMedia' => ['mediaId' => $media['id']]],
            'homepage' => ['sections' => [['id' => 'a', 'design' => ['background' => ['media' => ['mediaId' => $media['id']]]]]]],
        ]);

        $this->assertSame(['branding.logoMedia', 'homepage.sections.0.design.background.media'], array_keys($resolved));
        app(TenantContext::class)->forget();
    }
}
