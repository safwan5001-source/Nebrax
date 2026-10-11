<?php

namespace Tests\Feature;

use App\Support\Commerce\GalleryPublishRules;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Support\Commerce\StorefrontSectionDesignNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

/**
 * CUST-HV V8d — قسم المعرض `gallery` (V0 §13.2): نموذج المحتوى، الخيارات، قاعدة النشر (صورتان على الأقل)،
 * النص البديل لكل لغة وعزل الوسائط عبر البوابة العامة. الحالات مشتركة مع توأمَي TS عبر `tests/Fixtures/presentation/gallery.json`.
 *
 * تشغيل: php artisan test --filter=StorefrontGalleryTest
 */
class StorefrontGalleryTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';

    private int $uploads = 0;

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    /** @return array<string,mixed> */
    private static function fixture(): array
    {
        return json_decode((string) file_get_contents(dirname(__DIR__).'/Fixtures/presentation/gallery.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    /** @return array<string, array{array<string,mixed>}> */
    public static function contentCases(): array
    {
        $cases = self::fixture()['content'];

        return array_combine(array_column($cases, 'name'), array_map(static fn (array $c): array => [$c], $cases));
    }

    /** @return array<string, array{array<string,mixed>}> */
    public static function publishCases(): array
    {
        $cases = self::fixture()['publish'];

        return array_combine(array_column($cases, 'name'), array_map(static fn (array $c): array => [$c], $cases));
    }

    /**
     * @param  array<string,mixed>|null  $content
     * @return array<string,mixed>
     */
    private function document(mixed $content, bool $visible = true, array $extra = []): array
    {
        return (new StorefrontPresentationNormalizer)->normalize([
            'version' => 2,
            'primaryColor' => '#12372a',
            'homepage' => ['sections' => [['id' => 'sec-a', 'type' => 'gallery', 'visible' => $visible, 'content' => $content] + $extra]],
        ]);
    }

    /**
     * @test
     *
     * @dataProvider contentCases
     *
     * @param  array<string,mixed>  $case
     */
    public function the_content_normalizes_like_the_shared_fixture(array $case): void
    {
        $section = collect($this->document($case['input'])['homepage']['sections'])->firstWhere('id', 'sec-a');
        $this->assertNotNull($section, 'the gallery section itself survives');

        // الترتيب جزءٌ من العقد: التكافؤ الحرفي لا القيمي.
        $this->assertSame(
            json_encode($case['expected'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            json_encode($section['content'] ?? null, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $case['name'],
        );
        $this->assertSame(
            $section['content'] ?? null,
            collect($this->document($section['content'] ?? null)['homepage']['sections'])->firstWhere('id', 'sec-a')['content'] ?? null,
            'idempotent: '.$case['name'],
        );
    }

    /**
     * @test
     *
     * @dataProvider publishCases
     *
     * @param  array<string,mixed>  $case
     */
    public function the_publish_rule_matches_the_shared_fixture(array $case): void
    {
        $doc = ['homepage' => ['sections' => [['id' => 'sec-a', 'type' => 'gallery', 'visible' => true, 'content' => $case['content']]]]];

        $prefix = 'homepage.sections[0].content.';
        $actual = [];
        foreach (GalleryPublishRules::errors($doc) as $path => $error) {
            $this->assertStringStartsWith($prefix, $path);
            $actual[] = ['path' => substr($path, strlen($prefix)), 'code' => $error['code']];
        }
        $this->assertSame($case['expected'], $actual, $case['name']);
    }

    /** @test */
    public function a_hidden_gallery_never_blocks_publishing(): void
    {
        $doc = $this->document(['images' => [['media' => ['mediaId' => '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e']]]], false);

        $this->assertSame([], GalleryPublishRules::errors($doc));
    }

    /** @test */
    public function a_gallery_is_accepted_for_storage_but_is_not_in_the_default_document(): void
    {
        $normalizer = new StorefrontPresentationNormalizer;

        $this->assertContains('gallery', StorefrontPresentationNormalizer::HOME_MEDIA_SECTION_KEYS);
        $this->assertNotContains('gallery', StorefrontPresentationNormalizer::HOME_BUILDER_SECTION_KEYS);
        $this->assertNotContains('gallery', StorefrontPresentationNormalizer::HOME_DATA_SECTION_KEYS, 'vertical setup counts data sections only');
        $this->assertNotContains('gallery', array_column($normalizer->defaultConfig()['homepage']['sections'], 'type'));
        $this->assertSame(3, $normalizer->normalize(['version' => 3])['version']);
    }

    /** @test */
    public function a_gallery_without_content_survives_as_a_bare_instance(): void
    {
        $section = $this->document(null)['homepage']['sections'][0];

        $this->assertSame(['id' => 'sec-a', 'type' => 'gallery', 'visible' => true], $section);
    }

    /** @test */
    public function the_gallery_design_capability_is_exactly_what_the_slice_offers(): void
    {
        $capability = StorefrontSectionDesignNormalizer::capabilities()['gallery'];
        $this->assertSame(
            ['background', 'width', 'spacing', 'layout', 'border', 'radius', 'shadow', 'separator'],
            array_keys($capability),
        );
        $this->assertSame(['carousel'], $capability['layout']);

        $design = StorefrontSectionDesignNormalizer::normalize('gallery', [
            'layout' => 'carousel',
            'text' => ['body' => ['hex' => '#ffffff']],
            'mediaTreatment' => ['height' => 'tall'],
            'motion' => ['reveal' => 'fade-up'],
            'spacing' => ['top' => 'md'],
        ]);
        $this->assertSame(['spacing', 'layout'], array_keys($design));

        $this->assertNull(StorefrontSectionDesignNormalizer::normalize('gallery', ['layout' => 'grid']), 'the grid is the absence of a layout');
        $this->assertNull(StorefrontSectionDesignNormalizer::normalize('gallery', ['layout' => 'split']));
        $this->assertNull(StorefrontSectionDesignNormalizer::normalize('gallery', [
            'background' => ['kind' => 'media', 'media' => ['mediaId' => '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e']],
        ]), 'a section background is never a picture: the pictures are the images');
    }

    /** @test */
    public function the_validator_reports_a_short_gallery_at_its_path(): void
    {
        $one = $this->document(['images' => [['media' => ['mediaId' => '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e']]]]);
        $errors = (new StorefrontPresentationPublishValidator)->errors($one);

        $this->assertSame('gallery_images_min', $errors['homepage.sections[0].content.images']['code'] ?? null);
    }

    // ─── integration: real uploads, tenant isolation ───────────────────────────────────

    /** @return array<string,mixed> */
    private function uploadMedia(array $auth): array
    {
        $json = $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(1600 + $this->uploads++, 900, null, ['left' => [10, 12, 14], 'right' => [40, 44, 60]]))]], ['Accept' => 'application/json'])
            ->json();
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media'];
    }

    /** @return array{auth:array<string,mixed>,a:string,b:string} */
    private function tenantWithPictures(string $slug): array
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $this->seedMediaStorefront($auth['tenant_id']);

        return ['auth' => $auth, 'a' => $this->uploadMedia($auth)['id'], 'b' => $this->uploadMedia($auth)['id']];
    }

    /** @return array<string,string> مسار → رمز */
    private function codes(array $document): array
    {
        return array_map(
            static fn (array $e): string => $e['code'],
            (new StorefrontPresentationPublishValidator)->errors($document),
        );
    }

    /** @test */
    public function two_images_with_alt_text_or_the_decorative_flag_publish_whatever_their_options(): void
    {
        $t = $this->tenantWithPictures('ga-ok');
        app(TenantContext::class)->set($t['auth']['tenant_id']);

        $doc = $this->document([
            'images' => [
                ['id' => 'a', 'media' => ['mediaId' => $t['a'], 'alt' => ['ar' => 'زهور', 'en' => 'Flowers']], 'caption' => 'Spring', 'link' => '/products'],
                ['id' => 'b', 'media' => ['mediaId' => $t['b'], 'decorative' => true]],
            ],
            'options' => ['columns' => 4, 'aspect' => '4:3', 'gap' => 'lg', 'captions' => true, 'lightbox' => true],
        ], true, ['design' => ['layout' => 'carousel']]);

        $this->assertSame([], $this->codes($doc));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_image_without_alt_text_or_the_decorative_flag_is_refused_per_locale(): void
    {
        $t = $this->tenantWithPictures('ga-alt');
        app(TenantContext::class)->set($t['auth']['tenant_id']);

        $codes = $this->codes($this->document(['images' => [
            ['id' => 'a', 'media' => ['mediaId' => $t['a']]],
            ['id' => 'b', 'media' => ['mediaId' => $t['b'], 'alt' => ['ar' => 'نص']]],
        ]]));

        $this->assertSame('alt_required_ar', $codes['homepage.sections.0.content.images.0.media.alt.ar'] ?? null);
        $this->assertSame('alt_required_en', $codes['homepage.sections.0.content.images.0.media.alt.en'] ?? null);
        $this->assertArrayNotHasKey('homepage.sections.0.content.images.1.media.alt.ar', $codes);
        $this->assertSame('alt_required_en', $codes['homepage.sections.0.content.images.1.media.alt.en'] ?? null);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function another_tenants_picture_is_missing_for_this_tenant(): void
    {
        $mine = $this->tenantWithPictures('ga-mine');
        $theirs = $this->tenantWithPictures('ga-theirs');
        app(TenantContext::class)->set($mine['auth']['tenant_id']);

        $codes = $this->codes($this->document(['images' => [
            ['id' => 'a', 'media' => ['mediaId' => $mine['a'], 'decorative' => true]],
            ['id' => 'b', 'media' => ['mediaId' => $theirs['a'], 'decorative' => true]],
        ]]));

        $this->assertSame('media_missing', $codes['homepage.sections.0.content.images.1.media.mediaId'] ?? null);
        $this->assertArrayNotHasKey('homepage.sections.0.content.images.0.media.mediaId', $codes);
        app(TenantContext::class)->forget();
    }
}
