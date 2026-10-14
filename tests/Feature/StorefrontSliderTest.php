<?php

namespace Tests\Feature;

use App\Support\Commerce\SliderPublishRules;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Support\Commerce\StorefrontSectionDesignNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CUST-HV V8a — قسم الشرائح `slider` (V0 §13.1): نموذج المحتوى، السلوك، قواعد النشر (حدّ أدنى + تباين النص فوق صورة
 * كل شريحة)، وعزل الوسائط. الحالات مشتركة مع توأمَي TS عبر `tests/Fixtures/presentation/slider.json`.
 *
 * تشغيل: php artisan test --filter=StorefrontSliderTest
 */
class StorefrontSliderTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';

    private int $uploads = 0;

    /** @return array<string,mixed> */
    private static function fixture(): array
    {
        return json_decode((string) file_get_contents(dirname(__DIR__).'/Fixtures/presentation/slider.json'), true, 512, JSON_THROW_ON_ERROR);
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
            'homepage' => ['sections' => [['id' => 'sec-a', 'type' => 'slider', 'visible' => $visible, 'content' => $content] + $extra]],
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
        $this->assertNotNull($section, 'the slider section itself survives');

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
    public function the_publish_rules_match_the_shared_fixture(array $case): void
    {
        $media = $case['media'];
        $doc = [
            'primaryColor' => $case['config']['primaryColor'],
            'accentColor' => $case['config']['accentColor'],
            'palette' => $case['config']['palette'],
            'homepage' => ['sections' => [['id' => 'sec-a', 'type' => 'slider', 'visible' => true, 'content' => $case['content']]]],
        ];
        $errors = SliderPublishRules::errors($doc, static fn (array $ref): ?array => $media[$ref['mediaId']] ?? null);

        $prefix = 'homepage.sections[0].content.';
        $actual = [];
        foreach ($errors as $path => $error) {
            $this->assertStringStartsWith($prefix, $path);
            $actual[] = ['path' => substr($path, strlen($prefix)), 'code' => $error['code']];
        }
        $this->assertSame($case['expected'], $actual, $case['name']);
    }

    /** @test */
    public function a_hidden_slider_never_blocks_publishing(): void
    {
        $doc = $this->document(['slides' => [['media' => ['mediaId' => '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e'], 'heading' => 'Hi']]], false);

        $this->assertSame([], SliderPublishRules::errors($doc, static fn (): ?array => null));
    }

    /** @test */
    public function a_slider_is_accepted_for_storage_but_is_not_in_the_default_document(): void
    {
        $normalizer = new StorefrontPresentationNormalizer;

        $this->assertContains('slider', StorefrontPresentationNormalizer::HOME_MEDIA_SECTION_KEYS);
        $this->assertNotContains('slider', StorefrontPresentationNormalizer::HOME_BUILDER_SECTION_KEYS);
        $this->assertNotContains('slider', StorefrontPresentationNormalizer::HOME_DATA_SECTION_KEYS, 'vertical setup counts data sections only');
        $this->assertNotContains('slider', array_column($normalizer->defaultConfig()['homepage']['sections'], 'type'));
        $this->assertSame(3, $normalizer->normalize(['version' => 3])['version']);
    }

    /** @test */
    public function a_slider_without_content_survives_as_a_bare_instance(): void
    {
        $section = $this->document(null)['homepage']['sections'][0];

        $this->assertSame(['id' => 'sec-a', 'type' => 'slider', 'visible' => true], $section);
    }

    /** @test */
    public function the_slider_design_capability_is_exactly_what_the_slice_renders(): void
    {
        $capability = StorefrontSectionDesignNormalizer::capabilities()['slider'];
        $this->assertSame(
            ['background', 'width', 'spacing', 'border', 'radius', 'shadow', 'separator', 'mediaTreatment'],
            array_keys($capability),
        );

        $design = StorefrontSectionDesignNormalizer::normalize('slider', [
            'background' => ['kind' => 'solid', 'color' => ['role' => 'brand']],
            'text' => ['body' => ['hex' => '#ffffff']],
            'layout' => 'split',
            'overlap' => 'md',
            'motion' => ['reveal' => 'fade-up'],
            'mediaTreatment' => ['height' => 'tall'],
            'spacing' => ['top' => 'md'],
        ]);

        $this->assertSame(['background', 'spacing', 'mediaTreatment'], array_keys($design));
        $this->assertNull(StorefrontSectionDesignNormalizer::normalize('slider', [
            'background' => ['kind' => 'media', 'media' => ['mediaId' => '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e']],
        ]), 'a section background is never a picture: the pictures are the slides');
    }

    /** @test */
    public function the_validator_reports_a_short_slider_and_unreadable_slides_at_their_paths(): void
    {
        $one = $this->document(['slides' => [['media' => ['mediaId' => '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e']]]]);
        $errors = (new StorefrontPresentationPublishValidator)->errors($one);

        $this->assertSame('slider_slides_min', $errors['homepage.sections[0].content.slides']['code'] ?? null);
    }

    // ─── integration: real uploads, real evidence, tenant isolation ───────────────────

    /** @return array<string,mixed> */
    private function uploadMedia(array $auth, array $colours): array
    {
        $json = $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(1600 + $this->uploads++, 900, null, $colours))]], ['Accept' => 'application/json'])
            ->json();
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media'];
    }

    /** @return array{auth:array<string,mixed>,dark:string,dark2:string,wide:string} */
    private function tenantWithPictures(string $slug): array
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $this->seedMediaStorefront($auth['tenant_id']);

        return [
            'auth' => $auth,
            'dark' => $this->uploadMedia($auth, ['left' => [10, 12, 14], 'right' => [40, 44, 60]])['id'],
            'dark2' => $this->uploadMedia($auth, ['left' => [12, 10, 14], 'right' => [44, 40, 60]])['id'],
            'wide' => $this->uploadMedia($auth, ['left' => [0, 0, 0], 'right' => [255, 255, 255]])['id'],
        ];
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
    public function two_proven_slides_with_alt_text_publish_and_a_mobile_picture_asks_for_no_second_alt(): void
    {
        $t = $this->tenantWithPictures('sl-ok');
        app(TenantContext::class)->set($t['auth']['tenant_id']);
        $alt = ['ar' => 'زهور', 'en' => 'Flowers'];

        $doc = $this->document(['slides' => [
            ['id' => 'a', 'media' => ['mediaId' => $t['dark'], 'alt' => $alt], 'mobile' => ['mediaId' => $t['dark2']], 'heading' => 'Spring'],
            ['id' => 'b', 'media' => ['mediaId' => $t['dark2'], 'decorative' => true], 'sub' => 'Fresh'],
        ]]);

        $this->assertSame([], $this->codes($doc));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_slide_picture_without_alt_text_or_the_decorative_flag_is_refused_per_locale(): void
    {
        $t = $this->tenantWithPictures('sl-alt');
        app(TenantContext::class)->set($t['auth']['tenant_id']);

        $codes = $this->codes($this->document(['slides' => [
            ['id' => 'a', 'media' => ['mediaId' => $t['dark']]],
            ['id' => 'b', 'media' => ['mediaId' => $t['dark2'], 'alt' => ['ar' => 'نص']]],
        ]]));

        $this->assertSame('alt_required_ar', $codes['homepage.sections.0.content.slides.0.media.alt.ar'] ?? null);
        $this->assertSame('alt_required_en', $codes['homepage.sections.0.content.slides.0.media.alt.en'] ?? null);
        $this->assertArrayNotHasKey('homepage.sections.0.content.slides.1.media.alt.ar', $codes);
        $this->assertSame('alt_required_en', $codes['homepage.sections.0.content.slides.1.media.alt.en'] ?? null);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_full_range_picture_under_text_is_unprovable_until_its_overlay_darkens_it(): void
    {
        $t = $this->tenantWithPictures('sl-wide');
        app(TenantContext::class)->set($t['auth']['tenant_id']);
        $slide = fn (array $extra): array => ['id' => 'a', 'media' => ['mediaId' => $t['wide'], 'decorative' => true], 'heading' => 'Hi'] + $extra;
        $second = ['id' => 'b', 'media' => ['mediaId' => $t['dark'], 'decorative' => true]];
        $path = 'homepage.sections[0].content.slides[0].media';

        $this->assertSame([$path => 'contrast_unprovable'], $this->codes($this->document(['slides' => [$slide([]), $second]])));
        $this->assertSame([], $this->codes($this->document(['slides' => [$slide(['overlay' => ['color' => ['hex' => '#000000'], 'alpha' => 70]]), $second]])));
        $this->assertSame([], $this->codes($this->document(['slides' => [['id' => 'a', 'media' => ['mediaId' => $t['wide'], 'decorative' => true]], $second]])), 'no text, nothing to read');
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function another_tenants_picture_is_missing_for_this_tenant(): void
    {
        $mine = $this->tenantWithPictures('sl-mine');
        $theirs = $this->tenantWithPictures('sl-theirs');
        app(TenantContext::class)->set($mine['auth']['tenant_id']);

        $codes = $this->codes($this->document(['slides' => [
            ['id' => 'a', 'media' => ['mediaId' => $mine['dark'], 'decorative' => true]],
            ['id' => 'b', 'media' => ['mediaId' => $theirs['dark'], 'decorative' => true], 'mobile' => ['mediaId' => $theirs['dark2']]],
        ]]));

        $this->assertSame('media_missing', $codes['homepage.sections.0.content.slides.1.media.mediaId'] ?? null);
        $this->assertSame('media_missing', $codes['homepage.sections.0.content.slides.1.mobile.mediaId'] ?? null);
        $this->assertArrayNotHasKey('homepage.sections.0.content.slides.0.media.mediaId', $codes);
        app(TenantContext::class)->forget();
    }
}
