<?php

namespace Tests\Feature;

use App\Models\StorefrontDomain;
use App\Models\StorefrontMedia;
use App\Models\StorefrontPresentation;
use App\Services\Commerce\StorefrontMediaPublishGate;
use App\Services\Commerce\StorefrontPublishedMediaResolver;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AWJ-ANIMATED-MEDIA — GIF / WebP متحرك داخل معرض الصور `gallery` (`homepage.sections.N.content.images.M.media`).
 *
 * يغطي: الفشل الذي أبلغ عنه التاجر (`animated_not_allowed_here` عند نشر معرض)، قبول أصلٍ جاهزٍ صالح، رفض أصل مستأجر آخر / غير جاهز /
 * محذوف، ورفض القصّ/التدوير/التركيز/الملاءمة على صورة متحركة، وأن الحلّال العام يكشف الحركة إضافياً بلا مسّ السلّم الثابت،
 * وأن الملف المتحرك لا يُخدَم إلا عبر معرضٍ منشور لمستأجره، وأن الخيار `showMotionControls` لا يدخل وثيقةً قديمة.
 *
 * تشغيل: php artisan test --filter=StorefrontGalleryAnimatedMediaTest
 */
class StorefrontGalleryAnimatedMediaTest extends TestCase
{
    use AnimatedMediaFixtures;
    use InteractsWithApi;
    use RefreshDatabase;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';

    private const IMAGE_PATH = 'homepage.sections.0.content.images';

    /** @return array<string,mixed> */
    private function createAnimated(array $auth, ?string $bytes = null, string $name = 'gallery.gif'): array
    {
        $json = $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($bytes ?? $this->animatedGifBytes(), $name)]], ['Accept' => 'application/json'])
            ->json();
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media'];
    }

    /** @return array<string,mixed> */
    private function createStill(array $auth): array
    {
        return $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(1600, 900))]], ['Accept' => 'application/json'])
            ->json('data.0.media');
    }

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

    private function publish(array $store, array $config): void
    {
        app(TenantContext::class)->set($store['auth']['tenant_id']);
        $row = StorefrontPresentation::query()->where('storefront_id', $store['storefront']->id)->first()
            ?? StorefrontPresentation::create([
                'storefront_id' => $store['storefront']->id, 'schema_version' => 3, 'draft_config' => [], 'published_config' => [], 'published_revision' => 0,
            ]);
        $row->forceFill(['published_config' => $config, 'published_revision' => ((int) $row->published_revision) + 1])->save();
        app(TenantContext::class)->forget();
    }

    /**
     * @param  list<array<string,mixed>>  $refs  مراجع الوسائط بالترتيب
     * @param  array<string,mixed>  $options
     * @return array<string,mixed>
     */
    private function galleryDoc(array $refs, array $options = []): array
    {
        $images = [];
        foreach ($refs as $i => $ref) {
            $images[] = ['id' => "img-{$i}", 'media' => $ref];
        }

        return ['homepage' => ['sections' => [[
            'id' => 'gal-1',
            'type' => 'gallery',
            'visible' => true,
            'content' => ['images' => $images] + ($options !== [] ? ['options' => $options] : []),
        ]]]];
    }

    /** @return array<string,string> مسار => رمز الخطأ */
    private function codes(array $doc): array
    {
        return array_map(
            static fn (array $e): string => $e['code'],
            app(StorefrontMediaPublishGate::class)->errors($doc),
        );
    }

    // ═════════════════ بوابة النشر ═════════════════

    /** @test */
    public function a_ready_animated_gif_and_webp_publish_in_a_gallery_where_they_used_to_be_refused(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('gal-pass');
        $gif = $this->createAnimated($auth);
        $webp = $this->createAnimated($auth, $this->animatedWebpBytes(), 'gallery.webp');
        $still = $this->createStill($auth);
        app(TenantContext::class)->set($auth['tenant_id']);

        // الإبلاغ الأصلي: التاجر رفع GIF صالحاً إلى المعرض فرُفض النشر بـ animated_not_allowed_here.
        $doc = $this->galleryDoc([
            ['mediaId' => $gif['id'], 'decorative' => true],
            ['mediaId' => $webp['id'], 'decorative' => true],
            ['mediaId' => $still['id'], 'decorative' => true],
        ]);
        $this->assertSame([], $this->codes($doc), 'GIF + animated WebP + a still publish side by side');

        // الخيار لا يغيّر القبول (سياسة عرض لا بوابة)
        $this->assertSame([], $this->codes($this->galleryDoc([['mediaId' => $gif['id'], 'decorative' => true]], ['showMotionControls' => true])));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function the_whole_publish_validator_accepts_an_animated_gallery_and_the_normalizer_keeps_the_references(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('gal-validator');
        $gif = $this->createAnimated($auth);
        $webp = $this->createAnimated($auth, $this->animatedWebpBytes(), 'gallery.webp');
        app(TenantContext::class)->set($auth['tenant_id']);

        $normalized = (new StorefrontPresentationNormalizer)->normalize($this->galleryDoc([
            ['mediaId' => $gif['id'], 'decorative' => true],
            ['mediaId' => $webp['id'], 'decorative' => true],
        ]) + ['version' => 2, 'primaryColor' => '#12372a']);
        $kept = $normalized['homepage']['sections'][0]['content']['images'] ?? [];
        $this->assertSame([$gif['id'], $webp['id']], array_map(static fn (array $i): string => $i['media']['mediaId'], $kept));

        $errors = (new StorefrontPresentationPublishValidator)->errors($normalized);
        $this->assertNotContains('animated_not_allowed_here', array_map(static fn (array $e): string => $e['code'], $errors));
        $this->assertSame([], array_filter($errors, static fn (array $e): bool => str_contains($e['code'], 'media') || str_contains($e['code'], 'animated')));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function animation_is_still_refused_everywhere_the_storefront_does_not_render_it(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('gal-denied');
        $gif = $this->createAnimated($auth);
        app(TenantContext::class)->set($auth['tenant_id']);
        $ref = ['mediaId' => $gif['id'], 'decorative' => true];
        $denied = 'animated_not_allowed_here';

        $this->assertSame(['branding.logoMedia.mediaId' => $denied], $this->codes(['branding' => ['logoMedia' => $ref]]));
        $this->assertSame(['homepage.sections.0.content.blocks.0.media.mediaId' => $denied], $this->codes(['homepage' => ['sections' => [['content' => ['blocks' => [['media' => $ref]]]]]]]));
        // only the gallery's `media` leaf is a rendered position — not a sibling key of an image
        $this->assertSame(['homepage.sections.0.content.images.0.poster.mediaId' => $denied], $this->codes(['homepage' => ['sections' => [['content' => ['images' => [['poster' => $ref]]]]]]]));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_foreign_not_ready_or_inactive_animated_asset_is_refused_in_a_gallery(): void
    {
        $this->fakeStorefrontMediaR2();
        $a = $this->registerTenant('gal-iso-a', 'owner@gal-iso-a.test');
        $b = $this->registerTenant('gal-iso-b', 'owner@gal-iso-b.test');
        $mine = $this->createAnimated($a);
        $theirs = $this->createAnimated($b, $this->animatedWebpBytes(), 'theirs.webp');
        $ref = static fn (string $id): array => ['mediaId' => $id, 'decorative' => true];
        $key = self::IMAGE_PATH.'.0.media.mediaId';

        // مستأجر A لا يستطيع نشر أصل مستأجر B (النطاق يخفيه ⇒ media_missing، لا تسريب وجود)
        app(TenantContext::class)->set($a['tenant_id']);
        $this->assertSame([$key => 'media_missing'], $this->codes($this->galleryDoc([$ref($theirs['id'])])));
        $this->assertSame([], $this->codes($this->galleryDoc([$ref($mine['id'])])));

        // سلّم غير جاهز ⇒ media_not_ready (الحالتان: فشل وانتظار)
        foreach ([StorefrontMedia::VARIANTS_FAILED, StorefrontMedia::VARIANTS_PENDING] as $state) {
            StorefrontMedia::query()->whereKey($mine['id'])->update(['variants_state' => $state]);
            $this->assertSame([$key => 'media_not_ready'], $this->codes($this->galleryDoc([$ref($mine['id'])])), $state);
        }
        StorefrontMedia::query()->whereKey($mine['id'])->update(['variants_state' => StorefrontMedia::VARIANTS_READY]);

        // أصل غير نشط (محذوف) ⇒ media_missing
        StorefrontMedia::query()->whereKey($mine['id'])->update(['state' => 'deleted']);
        $this->assertSame([$key => 'media_missing'], $this->codes($this->galleryDoc([$ref($mine['id'])])));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function crop_rotate_focal_and_fit_on_an_animated_gallery_image_are_refused_without_special_casing_the_asset(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('gal-transform');
        $gif = $this->createAnimated($auth);
        $webp = $this->createAnimated($auth, $this->animatedWebpBytes(), 'gallery.webp');
        app(TenantContext::class)->set($auth['tenant_id']);
        $key = self::IMAGE_PATH.'.0.media.crop';

        foreach ([$gif, $webp] as $asset) {
            foreach ([
                ['rotate' => 90],
                ['focal' => ['x' => 10, 'y' => 20]],
                ['fit' => 'contain'],
                ['crop' => ['x' => 0, 'y' => 0, 'w' => 0.5, 'h' => 0.5, 'aspect' => '1:1']],
            ] as $transform) {
                $this->assertSame(
                    [$key => 'animated_transform_unsupported'],
                    $this->codes($this->galleryDoc([['mediaId' => $asset['id'], 'decorative' => true] + $transform])),
                    $asset['id'].' '.json_encode($transform),
                );
            }
        }
        app(TenantContext::class)->forget();
    }

    // ═════════════════ الحلّال العام + التسليم + العزل ═════════════════

    /** @test */
    public function the_resolver_exposes_the_gallery_animation_additively_and_keeps_every_still_source(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('gal-res');
        $gif = $this->createAnimated($store['auth']);
        $webp = $this->createAnimated($store['auth'], $this->animatedWebpBytes(), 'gallery.webp');
        $still = $this->createStill($store['auth']);
        $config = $this->galleryDoc([
            ['mediaId' => $gif['id'], 'decorative' => true],
            ['mediaId' => $webp['id'], 'decorative' => true],
            ['mediaId' => $still['id'], 'decorative' => true],
        ]);

        app(TenantContext::class)->set($store['auth']['tenant_id']);
        $resolved = app(StorefrontPublishedMediaResolver::class)->resolve($config);
        app(TenantContext::class)->forget();

        $prefix = '/api/storefront/media/customizer/';
        $this->assertSame($prefix.$gif['id'].'/animated.gif', $resolved[self::IMAGE_PATH.'.0.media']['animation']['src']);
        $this->assertSame('gif', $resolved[self::IMAGE_PATH.'.0.media']['animation']['format']);
        $this->assertSame($prefix.$webp['id'].'/animated.webp', $resolved[self::IMAGE_PATH.'.1.media']['animation']['src']);
        $this->assertSame('webp', $resolved[self::IMAGE_PATH.'.1.media']['animation']['format']);
        $this->assertArrayNotHasKey('animation', $resolved[self::IMAGE_PATH.'.2.media'], 'a still picture is unchanged');

        foreach ([0, 1, 2] as $i) {
            $this->assertNotEmpty($resolved[self::IMAGE_PATH.".{$i}.media"]['sources']);
            foreach ($resolved[self::IMAGE_PATH.".{$i}.media"]['sources'] as $source) {
                $this->assertContains($source['format'], ['webp', 'jpg'], 'the still ladder never carries the animated file');
                $this->assertStringNotContainsString('animated.', $source['src']);
            }
        }
    }

    /** @test */
    public function a_published_gallery_serves_its_animation_only_on_its_own_tenant_host(): void
    {
        $this->fakeStorefrontMediaR2();
        $a = $this->store('gal-serve-a');
        $b = $this->store('gal-serve-b');
        $media = $this->createAnimated($a['auth']);
        $url = fn (array $store, string $id, string $file): string => "http://{$store['host']}/store/v1/media/customizer/{$id}/{$file}";

        $this->get($url($a, $media['id'], 'animated.gif'))->assertNotFound(); // غير منشور
        $this->publish($a, $this->galleryDoc([['mediaId' => $media['id'], 'decorative' => true]]));

        $res = $this->get($url($a, $media['id'], 'animated.gif'))->assertOk();
        $res->assertHeader('Content-Type', 'image/gif');
        $res->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringStartsWith('GIF89a', $res->streamedContent());
        $this->get($url($a, $media['id'], '400w.webp'))->assertOk()->assertHeader('Content-Type', 'image/webp');

        // مستأجر آخر (مضيفه) لا يبلغه ولو نشر معرضاً خاصاً به
        $this->get($url($b, $media['id'], 'animated.gif'))->assertNotFound();
        $other = $this->createAnimated($b['auth'], $this->animatedWebpBytes(), 'b.webp');
        $this->publish($b, $this->galleryDoc([['mediaId' => $other['id'], 'decorative' => true]]));
        $this->get($url($b, $media['id'], 'animated.gif'))->assertNotFound();
        $this->get($url($b, $other['id'], 'animated.webp'))->assertOk()->assertHeader('Content-Type', 'image/webp');

        // رفع المعرض من النشر يُنهي الخدمة
        $this->publish($a, ['homepage' => ['sections' => []]]);
        $this->get($url($a, $media['id'], 'animated.gif'))->assertNotFound();
    }

    // ═════════════════ عقد showMotionControls ═════════════════

    /** @test */
    public function show_motion_controls_is_an_opt_in_true_and_never_enters_a_legacy_document(): void
    {
        $normalizer = new StorefrontPresentationNormalizer;
        $media = ['mediaId' => '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e', 'decorative' => true];
        $other = ['mediaId' => '1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f', 'decorative' => true];
        $sectionContent = static fn (array $doc): array => $doc['homepage']['sections'][0]['content'];
        $build = fn (array $options): array => $sectionContent($normalizer->normalize(
            $this->galleryDoc([$media, $other], $options) + ['version' => 2, 'primaryColor' => '#12372a'],
        ));

        $legacy = $build([]);
        $this->assertArrayNotHasKey('options', $legacy, 'a document that never opted in gains no key');

        foreach ([false, 'yes', 1, 'true', null, []] as $notOptIn) {
            $this->assertSame(
                json_encode($legacy),
                json_encode($build(['showMotionControls' => $notOptIn])),
                'only a literal true opts in: '.json_encode($notOptIn),
            );
        }

        $on = $build(['showMotionControls' => true]);
        $this->assertSame(['showMotionControls' => true], $on['options']);
        // idempotent: saved → normalized again → published payload is byte-identical
        $this->assertSame(
            json_encode($on),
            json_encode($sectionContent($normalizer->normalize(['version' => 2, 'primaryColor' => '#12372a', 'homepage' => ['sections' => [['id' => 'gal-1', 'type' => 'gallery', 'visible' => true, 'content' => $on]]]]))),
        );
        // canonical key order: the opt-in follows the existing options
        $this->assertSame(
            ['columns', 'captions', 'lightbox', 'showMotionControls'],
            array_keys($build(['showMotionControls' => true, 'lightbox' => true, 'captions' => true, 'columns' => 4])['options']),
        );
    }
}
