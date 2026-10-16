<?php

namespace Tests\Feature;

use App\Models\StorefrontDomain;
use App\Models\StorefrontMedia;
use App\Models\StorefrontPresentation;
use App\Services\Commerce\StorefrontPublishedMediaResolver;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AWJ-ANIMATED-MEDIA P1 — GIF / WebP متحرك في مكتبة وسائط المُخصِّص: رفع، تنقية، سلّم ثابت من الإطار الأول،
 * تسليم عام بوابته النشر، عزل المستأجر، وإغلاق بوابات التباين/التحويل (حركة ⇒ «غير مُثبَت»).
 *
 * تشغيل: php artisan test --filter=StorefrontAnimatedMediaTest
 */
class StorefrontAnimatedMediaTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use StorefrontMediaTestSupport;
    use AnimatedMediaFixtures;

    private const BASE = '/api/commerce/workspace/storefront-media';

    /** @return array<string,mixed> */
    private function uploadOne(array $auth, string $bytes, string $name): array
    {
        return $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($bytes, $name)]], ['Accept' => 'application/json'])
            ->json();
    }

    /** @return array<string,mixed> */
    private function createAnimated(array $auth, ?string $bytes = null, string $name = 'banner.gif'): array
    {
        $json = $this->uploadOne($auth, $bytes ?? $this->animatedGifBytes(), $name);
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media'];
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

    private function ref(string $mediaId): array
    {
        return ['homepage' => ['sections' => [['id' => 's1', 'design' => ['background' => ['media' => ['mediaId' => $mediaId]]]]]]];
    }

    private function key(array $auth, array $media, string $file): string
    {
        return "tenant/{$auth['tenant_id']}/storefront-media/{$media['id']}/{$file}";
    }

    // ═════════════════ الرفع ═════════════════

    /** @test */
    public function an_animated_gif_keeps_the_original_stores_a_sanitised_copy_and_builds_the_static_ladder_from_frame_one(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-gif');

        $dirty = $this->gifWithMetadata();
        $media = $this->createAnimated($auth, $dirty);

        $this->assertSame('ready', $media['variants_state']);
        $this->assertSame('animated', $media['kind']);
        $this->assertSame('image/gif', $media['mime']);
        $this->assertSame([400, 400], [$media['width'], $media['height']]);
        $this->assertSame(3, $media['animation']['frames']);
        $this->assertSame(600, $media['animation']['duration_ms']);
        $this->assertTrue($media['animation']['loop']);
        $this->assertNotEmpty($media['animation']['url']);

        $files = array_map('basename', $this->r2KeysFor($auth['tenant_id'], $media['id']));
        sort($files);
        $this->assertContains('animated.gif', $files);
        $this->assertContains('original.gif', $files);
        $this->assertContains('400w.webp', $files);
        $this->assertContains('thumb-320.jpg', $files);

        // الأصل كما رُفع بايتاً ببايت؛ المُقدَّم منقّى (لا تعليقات/XMP) ومتحرك.
        $this->assertSame($dirty, $this->r2Objects[$this->key($auth, $media, 'original.gif')]['body']);
        $served = $this->r2Objects[$this->key($auth, $media, 'animated.gif')];
        $this->assertSame('image/gif', $served['type']);
        $this->assertStringNotContainsString('secret-note', $served['body']);
        $this->assertStringNotContainsString('XMP Data', $served['body']);
        $this->assertStringContainsString('NETSCAPE2.0', $served['body']);

        // السلّم الثابت = الإطار الأول (الأحمر) بصيغتي WebP وJPEG.
        $thumb = imagecreatefromstring($this->r2Objects[$this->key($auth, $media, '400w.webp')]['body']);
        $rgb = imagecolorat($thumb, imagesx($thumb) / 2, imagesy($thumb) / 2);
        $this->assertGreaterThan(200, ($rgb >> 16) & 0xFF);
        $this->assertLessThan(80, $rgb & 0xFF);

        $row = StorefrontMedia::findOrFail($media['id']);
        $this->assertSame('animated', $row->kind);
        $this->assertNull($row->region_luminance, 'no contrast evidence for motion');
        $this->assertNotNull($row->animationVariant());
    }

    /** @test */
    public function an_animated_webp_works_the_same_way(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-webp');

        $media = $this->createAnimated($auth, $this->webpWithMetadata(), 'hero.webp');

        $this->assertSame('animated', $media['kind']);
        $this->assertSame('webp', $media['animation']['format']);
        $this->assertSame(3, $media['animation']['frames']);

        $served = $this->r2Objects[$this->key($auth, $media, 'animated.webp')];
        $this->assertSame('image/webp', $served['type']);
        $this->assertStringNotContainsString('secret', $served['body']);
        $this->assertNotNull(StorefrontMedia::findOrFail($media['id'])->animationVariant());
    }

    /** @test */
    public function static_uploads_are_unchanged_no_kind_no_animation_and_the_exact_same_files(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-static');

        $json = $this->uploadOne($auth, $this->jpegBytes(1600, 900), 'photo.jpg');
        $media = $json['data'][0]['media'];

        $this->assertArrayNotHasKey('kind', $media);
        $this->assertArrayNotHasKey('animation', $media);
        $this->assertSame('image', StorefrontMedia::findOrFail($media['id'])->kind);
        $files = array_map('basename', $this->r2KeysFor($auth['tenant_id'], $media['id']));
        $this->assertNotContains('animated.gif', $files);
        $this->assertNotContains('animated.webp', $files);
    }

    /** @test */
    public function a_single_frame_gif_is_treated_as_a_plain_static_image(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-staticgif');
        $one = \imagecreatetruecolor(800, 600);
        \imagefill($one, 0, 0, \imagecolorallocate($one, 20, 120, 220));
        \ob_start();
        \imagegif($one);
        $gif = (string) \ob_get_clean();

        $media = $this->uploadOne($auth, $gif, 'still.gif')['data'][0]['media'];

        $this->assertSame('ready', $media['variants_state']);
        $this->assertArrayNotHasKey('animation', $media);
        $this->assertSame('image', StorefrontMedia::findOrFail($media['id'])->kind);
    }

    /**
     * @test
     *
     * @dataProvider rejections
     */
    public function out_of_bounds_or_unsafe_animations_are_rejected_with_a_stable_code_and_leave_no_trace(string $case, string $code): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-rej-'.substr(md5($case), 0, 6));

        $bytes = match ($case) {
            'too many frames' => $this->gifWithFrames(301),
            'too long' => $this->gifWithFrames(210, delayCs: 10), // 21 s
            'too heavy (frames × pixels)' => $this->gifWithFrames(300),
            'truncated' => substr($this->animatedGifBytes(), 0, -1),
            'webp partial first frame' => $this->webpWithPartialFirstFrame(),
            'gif partial first frame' => $this->gifWithPartialFirstFrame(),
            'gif forged graphic-control terminator' => $this->gifWithBadGceTerminator(),
            'too heavy bytes' => $this->animatedGifBytes().str_repeat("\0", 5 * 1024 * 1024),
            'poc f1 webp nested anmf' => $this->pocWebpNestedAnmf(),
            'poc f2 gif ext ff 00' => $this->pocGifExtFfZero(),
            'poc f4 gif lzw size' => $this->pocGifLzwSize(),
            'poc f4 webp dims mismatch' => $this->pocWebpDimsMismatch(),
            'poc f5 webp vp8l header' => $this->pocWebpVp8lHeader(),
            'f5 webp alph before vp8l' => $this->webpWithAlphBeforeVp8l(),
            default => $this->fail($case),
        };
        $json = $this->uploadOne($auth, $bytes, 'x.'.(str_contains($case, 'webp') ? 'webp' : 'gif'));

        $this->assertSame('rejected', $json['data'][0]['status'], json_encode($json));
        $this->assertSame($code, $json['data'][0]['error']['code']);
        $this->assertSame(0, StorefrontMedia::query()->count());
        $this->assertSame([], $this->r2Calls, 'a rejected file never reaches storage');
    }

    /** @test */
    public function the_animated_total_pixel_budget_is_40_million_and_nothing_else_moved(): void
    {
        $this->assertSame(40_000_000, config('storefront_media.animated.max_total_pixels'));
        // the other animated bounds
        $this->assertSame(300, config('storefront_media.animated.max_frames'));
        $this->assertSame(20_000, config('storefront_media.animated.max_duration_ms'));
        $this->assertSame(2560, config('storefront_media.animated.max_edge'));
        $this->assertSame(2_500_000, config('storefront_media.animated.max_pixels'));
        $this->assertSame(5 * 1024 * 1024, config('storefront_media.animated.max_bytes'));
        // the static image limits
        $this->assertSame(5 * 1024 * 1024, config('storefront_media.max_bytes'));
        $this->assertSame(320, config('storefront_media.min_short_edge'));
        $this->assertSame(8192, config('storefront_media.max_edge'));
        $this->assertSame(40_000_000, config('storefront_media.max_pixels'), 'static per-image pixel cap, unrelated to the animated budget');
    }

    /**
     * @test
     *
     * 400×400 = 160,000 px per frame → 40,000,000 / 160,000 = 250 frames is exactly the budget.
     */
    public function the_total_pixel_budget_accepts_just_below_and_exactly_at_the_limit_and_rejects_above_it_before_storage(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-budget');

        foreach ([249 => 'just below', 250 => 'exactly at'] as $frames => $label) {
            $json = $this->uploadOne($auth, $this->gifWithFrames($frames), "b{$frames}.gif");
            $this->assertSame('created', $json['data'][0]['status'], "{$label} the limit ({$frames} frames): ".json_encode($json));
            $this->assertSame($frames, $json['data'][0]['media']['animation']['frames']);
        }
        $stored = StorefrontMedia::query()->count();
        $this->assertSame(2, $stored);
        $callsBefore = count($this->r2Calls);

        $json = $this->uploadOne($auth, $this->gifWithFrames(251), 'b251.gif'); // 40,160,000 px
        $this->assertSame('rejected', $json['data'][0]['status'], json_encode($json));
        $this->assertSame('animated_too_heavy', $json['data'][0]['error']['code']);
        $this->assertSame($stored, StorefrontMedia::query()->count(), 'no row for the rejected upload');
        $this->assertCount($callsBefore, $this->r2Calls, 'the rejected upload never reached storage');
    }

    /** @test */
    public function the_old_150_million_budget_no_longer_admits_a_300_frame_banner(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-budget-old');

        $json = $this->uploadOne($auth, $this->gifWithFrames(300), 'b300.gif'); // 48,000,000 px: fine under 150 M, over 40 M

        $this->assertSame('animated_too_heavy', $json['data'][0]['error']['code']);
        $this->assertSame(0, StorefrontMedia::query()->count());
        $this->assertSame([], $this->r2Calls);
    }

    /** @return array<string, array{string,string}> */
    public static function rejections(): array
    {
        return [
            'too many frames' => ['too many frames', 'animated_too_many_frames'],
            'too long' => ['too long', 'animated_too_long'],
            'too heavy (frames × pixels)' => ['too heavy (frames × pixels)', 'animated_too_heavy'],
            'truncated' => ['truncated', 'image_unreadable'],
            'webp partial first frame' => ['webp partial first frame', 'animated_poster_unavailable'],
            'gif partial first frame' => ['gif partial first frame', 'animated_poster_unavailable'],
            'gif forged graphic-control terminator' => ['gif forged graphic-control terminator', 'image_unreadable'],
            'too heavy bytes' => ['too heavy bytes', 'file_too_large'],
            'poc f1 webp nested anmf' => ['poc f1 webp nested anmf', 'image_unreadable'],
            'poc f2 gif ext ff 00' => ['poc f2 gif ext ff 00', 'image_unreadable'],
            'poc f4 gif lzw size' => ['poc f4 gif lzw size', 'image_unreadable'],
            'poc f4 webp dims mismatch' => ['poc f4 webp dims mismatch', 'image_unreadable'],
            'poc f5 webp vp8l header' => ['poc f5 webp vp8l header', 'image_unreadable'],
            'f5 webp alph before vp8l' => ['f5 webp alph before vp8l', 'image_unreadable'],
        ];
    }

    /** @test */
    public function the_kill_switch_also_stops_a_retry_from_regenerating_an_animated_file(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-retry-off');
        $media = $this->createAnimated($auth);
        StorefrontMedia::query()->whereKey($media['id'])->update(['variants_state' => 'failed', 'variants_error' => 'storage_unavailable']);
        unset($this->r2Objects[$this->key($auth, $media, 'animated.gif')]);

        config()->set('storefront_media.animated.enabled', false);
        $retried = $this->withToken($auth['token'])->postJson(self::BASE."/{$media['id']}/retry")->json('data');

        $this->assertSame('failed', $retried['variants_state']);
        $this->assertSame('animated_not_supported', $retried['variants_error']);
        $this->assertArrayNotHasKey($this->key($auth, $media, 'animated.gif'), $this->r2Objects, 'no animated file was written while disabled');
    }

    /** @test */
    public function the_kill_switch_restores_the_old_refusal(): void
    {
        $this->fakeStorefrontMediaR2();
        config()->set('storefront_media.animated.enabled', false);
        $auth = $this->registerTenant('am-off');

        $json = $this->uploadOne($auth, $this->animatedGifBytes(), 'a.gif');

        $this->assertSame('animated_not_supported', $json['data'][0]['error']['code']);
        $this->assertSame([], $this->r2Calls);
    }

    /** @test */
    public function dimension_limits_apply_to_animations_too(): void
    {
        $this->fakeStorefrontMediaR2();
        config()->set('storefront_media.animated.max_edge', 300);
        $auth = $this->registerTenant('am-dim');

        $json = $this->uploadOne($auth, $this->animatedGifBytes(), 'a.gif');

        $this->assertSame('dimension_too_large', $json['data'][0]['error']['code']);
    }

    /** @test */
    public function identical_animated_bytes_deduplicate_inside_a_tenant(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-dedupe');

        $first = $this->createAnimated($auth);
        $second = $this->uploadOne($auth, $this->animatedGifBytes(), 'again.gif')['data'][0];

        $this->assertSame('duplicate', $second['status']);
        $this->assertSame($first['id'], $second['media']['id']);
    }

    /** @test */
    public function a_failed_ladder_can_be_retried_and_still_produces_the_animated_file(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-retry');
        $this->r2PutHook = function (array $args, int $n): void {
            if ($n === 1) { // original ok; animated.gif fails
                return;
            }
            if ($n === 2) {
                throw new \RuntimeException('simulated outage');
            }
        };

        $json = $this->uploadOne($auth, $this->animatedGifBytes(), 'a.gif');
        $media = $json['data'][0]['media'];
        $this->assertSame('failed', $media['variants_state']);

        $this->r2PutHook = null;
        $retried = $this->withToken($auth['token'])->postJson(self::BASE."/{$media['id']}/retry")->assertOk()->json('data');

        $this->assertSame('ready', $retried['variants_state']);
        $this->assertSame(3, $retried['animation']['frames']);
        $this->assertArrayHasKey($this->key($auth, $media, 'animated.gif'), $this->r2Objects);
    }

    // ═════════════════ المعاينة الموقَّعة (مساحة العمل) ═════════════════

    /** @test */
    public function the_signed_workspace_url_serves_the_sanitised_animation_and_a_tampered_tenant_is_refused(): void
    {
        $this->fakeStorefrontMediaR2();
        $a = $this->registerTenant('am-sign-a', 'owner@am-sign-a.test');
        $media = $this->createAnimated($a);

        $res = $this->get($media['animation']['url'])->assertOk();
        $res->assertHeader('Content-Type', 'image/gif');
        $res->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringStartsWith('GIF89a', $res->streamedContent());

        $b = $this->registerTenant('am-sign-b', 'owner@am-sign-b.test');
        $tampered = preg_replace('/tenant=[^&]+/', 'tenant='.$b['tenant_id'], $media['animation']['url']);
        $this->get($tampered)->assertStatus(403);
    }

    // ═════════════════ التسليم العام + العزل ═════════════════

    /** @test */
    public function a_published_animation_is_served_through_the_gate_and_never_across_tenants_or_when_unpublished(): void
    {
        $this->fakeStorefrontMediaR2();
        $a = $this->store('am-pub-a');
        $b = $this->store('am-pub-b');
        $media = $this->createAnimated($a['auth']);
        $url = fn (array $store, string $id, string $file): string => "http://{$store['host']}/store/v1/media/customizer/{$id}/{$file}";

        // غير منشور ⇒ 404 موحّد (حتى بمعرّف صحيح).
        $this->get($url($a, $media['id'], 'animated.gif'))->assertNotFound();

        $this->publish($a, $this->ref($media['id']));
        $res = $this->get($url($a, $media['id'], 'animated.gif'))->assertOk();
        $res->assertHeader('Content-Type', 'image/gif');
        $res->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringContainsString('no-store', (string) $res->headers->get('Cache-Control'));
        $this->assertStringContainsString('private', (string) $res->headers->get('Cache-Control'));
        $this->assertStringStartsWith('GIF89a', $res->streamedContent());
        $etag = (string) $res->headers->get('ETag');
        $sha = StorefrontMedia::query()->withoutGlobalScopes()->whereKey($media['id'])->value('sha256');
        $this->assertSame(
            '"'.substr(hash('sha256', $sha.':animated.gif:s'.\App\Services\Commerce\StorefrontAnimatedImage::SANITISER_VERSION), 0, 32).'"',
            $etag,
            'the validator is bound to the sanitiser version',
        );
        $this->get($url($a, $media['id'], 'animated.gif'), ['If-None-Match' => $etag])->assertStatus(304);

        // الملف الثابت ما زال يعمل (الإطار الأول).
        $this->get($url($a, $media['id'], '400w.webp'))->assertOk()->assertHeader('Content-Type', 'image/webp');

        // مستأجر آخر (مضيفه الخاص) لا يبلغه، ولو نُشر عنده أصلٌ آخر.
        $this->get($url($b, $media['id'], 'animated.gif'))->assertNotFound();
        $other = $this->createAnimated($b['auth'], $this->animatedWebpBytes(), 'b.webp');
        $this->publish($b, $this->ref($other['id']));
        $this->get($url($b, $media['id'], 'animated.gif'))->assertNotFound();
        $this->get($url($b, $other['id'], 'animated.webp'))->assertOk()->assertHeader('Content-Type', 'image/webp');

        // ملف الحركة غير موجود على أصل ثابت، وأسماء خارج القائمة المغلقة، ومفتاح تحويل.
        $static = $this->withToken($a['auth']['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(1600, 900))]], ['Accept' => 'application/json'])->json('data.0.media');
        $this->publish($a, $this->ref($static['id']));
        $this->get($url($a, $static['id'], 'animated.gif'))->assertNotFound();
        $this->get($url($a, $media['id'], 'animated.png'))->assertNotFound();
        $this->get($url($a, str_repeat('a', 32), 'animated.gif'))->assertNotFound();

        // إلغاء النشر يُنهي الخدمة فوراً.
        $this->publish($a, ['homepage' => ['sections' => []]]);
        $this->get($url($a, $media['id'], 'animated.gif'))->assertNotFound();
    }

    // ═════════════════ بوابات النشر ═════════════════

    /** @test */
    public function the_resolver_exposes_the_animation_additively_and_keeps_sources_static(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('am-res');
        $media = $this->createAnimated($store['auth']);
        $config = $this->ref($media['id']);

        app(TenantContext::class)->set($store['auth']['tenant_id']);
        $resolved = app(StorefrontPublishedMediaResolver::class)->resolve($config);
        app(TenantContext::class)->forget();

        $entry = $resolved['homepage.sections.0.design.background.media'];
        $this->assertSame('/api/storefront/media/customizer/'.$media['id'].'/animated.gif', $entry['animation']['src']);
        $this->assertSame(['gif', 3, 600, true], [$entry['animation']['format'], $entry['animation']['frames'], $entry['animation']['durationMs'], $entry['animation']['loop']]);
        foreach ($entry['sources'] as $source) {
            $this->assertContains($source['format'], ['webp', 'jpg'], 'sources never carry the animated file');
            $this->assertContains($source['kind'], ['w', 'thumb']);
        }
    }

    /** @test */
    public function text_over_an_animated_background_publishes_only_under_a_scrim_that_holds_for_every_possible_frame(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-scrim');
        $this->seedMediaStorefront($auth['tenant_id']);
        $media = $this->createAnimated($auth);
        app(TenantContext::class)->set($auth['tenant_id']);
        $codes = fn (array $background): array => array_map(
            static fn (array $e): string => $e['code'],
            (new StorefrontPresentationPublishValidator)->errors((new StorefrontPresentationNormalizer)->normalize([
                'primaryColor' => '#12372a',
                'homepage' => ['sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true, 'design' => ['background' => $background]]]],
            ])),
        );
        $ref = ['mediaId' => $media['id'], 'decorative' => true];
        $bg = 'homepage.sections[0].design.background';

        // الإطار الأول وحده (أحمر) لا يكفي دليلاً: بلا طبقة، أو بطبقة ضعيفة ⇒ غير مُثبَت.
        $this->assertSame([$bg => 'contrast_unprovable'], $codes(['kind' => 'media', 'media' => $ref]));
        $this->assertSame([$bg => 'contrast_unprovable'], $codes(['kind' => 'media', 'media' => $ref, 'overlay' => ['color' => ['hex' => '#000000'], 'alpha' => 20]]));

        // طبقة كافية لأي بكسل (مدى القنوات الكامل) ⇒ يُنشر، بالخوارزمية القائمة ذاتها.
        $this->assertSame([], $codes(['kind' => 'media', 'media' => $ref, 'overlay' => ['color' => ['hex' => '#000000'], 'alpha' => 70]]));

        // ونفس الحدّ الأدنى لصورة ثابتة تمتد من الأسود إلى الأبيض (الأساس المقيس لا مسارٌ خاص بالحركة).
        $this->assertSame(
            ['min' => [0, 0, 0], 'max' => [255, 255, 255]],
            app(\App\Services\Commerce\StorefrontMediaContrastEvidence::class)->boundsFor($ref),
        );
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function crop_rotate_and_framing_on_an_animation_are_refused_at_publish_and_by_the_derivative_endpoint(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-transform');
        $media = $this->createAnimated($auth);
        app(TenantContext::class)->set($auth['tenant_id']);
        $gate = app(\App\Services\Commerce\StorefrontMediaPublishGate::class);
        $codes = static fn (array $ref): array => array_map(
            static fn (array $e): string => $e['code'],
            $gate->errors(['homepage' => ['sections' => [['design' => ['background' => ['media' => $ref]]]]]]),
        );
        $path = 'homepage.sections.0.design.background.media';

        $this->assertSame(["{$path}.crop" => 'animated_transform_unsupported'], $codes(['mediaId' => $media['id'], 'rotate' => 90, 'decorative' => true]));
        $this->assertSame(["{$path}.crop" => 'animated_transform_unsupported'], $codes(['mediaId' => $media['id'], 'focal' => ['x' => 10, 'y' => 10], 'decorative' => true]));
        $this->assertSame([], $codes(['mediaId' => $media['id'], 'decorative' => true]), 'an untransformed animation passes the media gate');
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->postJson(self::BASE."/{$media['id']}/derivatives", ['transform' => ['rotate' => 90]])
            ->assertStatus(422)
            ->assertJsonPath('code', 'animated_transform_unsupported');
    }

    /** @test */
    public function an_animation_is_publishable_only_where_the_storefront_renders_it(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('am-slots');
        $media = $this->createAnimated($auth);
        $static = $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(1600, 900))]], ['Accept' => 'application/json'])->json('data.0.media');
        app(TenantContext::class)->set($auth['tenant_id']);
        $gate = app(\App\Services\Commerce\StorefrontMediaPublishGate::class);
        $ref = ['mediaId' => $media['id'], 'decorative' => true];

        $codes = static fn (array $doc): array => array_map(static fn (array $e): string => $e['code'], $gate->errors($doc));

        // مسموح: خلفية قسم (سطح مكتب/جوال) وشريحة سلايدر (سطح مكتب/جوال).
        $this->assertSame([], $codes(['homepage' => ['sections' => [['design' => ['background' => ['media' => $ref, 'mobile' => $ref]]]]]]));
        $this->assertSame([], $codes(['homepage' => ['sections' => [['content' => ['slides' => [['media' => $ref, 'mobile' => $ref]]]]]]]));

        // مرفوض بوضوح: شعار، معرض، كتلة محتوى — سيظهر ثابتاً بصمت.
        $denied = 'animated_not_allowed_here';
        $this->assertSame(['branding.logoMedia.mediaId' => $denied], $codes(['branding' => ['logoMedia' => $ref]]));
        $this->assertSame(['branding.faviconMedia.mediaId' => $denied], $codes(['branding' => ['faviconMedia' => $ref]]));
        $this->assertSame(['homepage.sections.0.content.images.0.media.mediaId' => $denied], $codes(['homepage' => ['sections' => [['content' => ['images' => [['media' => $ref]]]]]]]));
        $this->assertSame(['homepage.sections.0.content.blocks.0.media.mediaId' => $denied], $codes(['homepage' => ['sections' => [['content' => ['blocks' => [['media' => $ref]]]]]]]));

        // الصورة الثابتة لا تتأثر بالقاعدة في أي موضع.
        $this->assertSame([], $codes(['branding' => ['logoMedia' => ['mediaId' => $static['id'], 'decorative' => true]]]));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function animation_is_tenant_scoped_in_the_workspace_api(): void
    {
        $this->fakeStorefrontMediaR2();
        $a = $this->registerTenant('am-iso-a', 'owner@am-iso-a.test');
        $b = $this->registerTenant('am-iso-b', 'owner@am-iso-b.test');
        $media = $this->createAnimated($a);

        $this->withToken($b['token'])->getJson(self::BASE."/{$media['id']}")->assertNotFound();
        $this->withToken($b['token'])->deleteJson(self::BASE."/{$media['id']}")->assertNotFound();
        $this->withToken($b['token'])->getJson(self::BASE)->assertOk()->assertJsonPath('data', []);
    }
}
