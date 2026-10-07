<?php

namespace Tests\Feature;

use App\Models\StorefrontMedia;
use App\Models\StorefrontMediaDerivative;
use App\Services\Commerce\StorefrontMediaDerivativeService;
use App\Services\Commerce\StorefrontMediaPixelEvidence;
use App\Services\Commerce\StorefrontMediaTransform;
use App\Services\Commerce\StorefrontMediaVariantGenerator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Mockery;
use Tests\TestCase;

/**
 * CUST-HV V2b — مشتقّات تحويل الاستخدام: هوية `transformKey` (بما فيها `zoom`)،
 * هندسة الإطار، التصيير الفعلي بالبكسل، وإثبات الأوركستريشن المختار (AMEND-21):
 * كل استخدامٍ يبلغ حالةً نهائية، لا `pending` دائم، النشر قراءةٌ فقط.
 *
 * العقد: docs/plans/store/CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md §7.5.
 * تشغيل: php artisan test --filter=StorefrontMediaDerivativeTest
 */
class StorefrontMediaDerivativeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    /** @param array<string,mixed> $overrides */
    private function transform(array $overrides = []): array
    {
        return array_replace_recursive([
            'crop' => ['x' => 0.25, 'y' => 0.1, 'w' => 0.5, 'h' => 0.5, 'aspect' => '16:9', 'zoom' => 1],
        ], $overrides);
    }

    private function createReady(array $auth, int $w = 1600, int $h = 900, ?string $bytes = null): array
    {
        $json = $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($bytes ?? $this->jpegBytes($w, $h))]], ['Accept' => 'application/json'])
            ->json();
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media'];
    }

    private function ensure(array $auth, string $mediaId, array $transform, bool $retry = false): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($auth['token'])->postJson(self::BASE.'/'.$mediaId.'/derivatives', [
            'transform' => $transform,
            'retry' => $retry,
        ]);
    }

    /** @return array{0:int,1:int,2:int} RGB عند نقطةٍ من ملفٍ مُشتقٍّ مخزَّن. */
    private function pixel(string $bytes, float $fx, float $fy): array
    {
        $image = imagecreatefromstring($bytes);
        $this->assertNotFalse($image);
        $rgb = imagecolorat($image, (int) floor((imagesx($image) - 1) * $fx), (int) floor((imagesy($image) - 1) * $fy));

        return [($rgb >> 16) & 0xFF, ($rgb >> 8) & 0xFF, $rgb & 0xFF];
    }

    // ═════════════════════════ هوية التحويل ═════════════════════════

    /** @test */
    public function the_transform_key_is_deterministic_32_hex_and_collapses_float_noise(): void
    {
        $a = StorefrontMediaTransform::fromInput(['crop' => ['x' => 0.12341, 'y' => 0.2, 'w' => 0.5, 'h' => 0.5, 'aspect' => '1:1', 'zoom' => 2.001], 'focal' => ['x' => 33.4, 'y' => 70.6]]);
        $b = StorefrontMediaTransform::fromInput(['crop' => ['x' => 0.123449, 'y' => 0.2000001, 'w' => 0.50000001, 'h' => 0.5, 'aspect' => '1:1', 'zoom' => 2.004], 'focal' => ['x' => 33, 'y' => 71]]);

        $this->assertSame($a->normalized(), $b->normalized());
        $key = $a->key('media-1', 768, 'webp');
        $this->assertMatchesRegularExpression('/\A[a-f0-9]{32}\z/', $key);
        $this->assertSame($key, $b->key('media-1', 768, 'webp'));
        $this->assertSame(substr(hash('sha256', 'media-1:'.$a->normalized().':768:webp'), 0, 32), $key, 'V0 §7.5 formula, verbatim');
    }

    /** @test */
    public function two_framings_differing_only_in_zoom_get_different_keys_and_different_rows(): void
    {
        $one = StorefrontMediaTransform::fromInput($this->transform(['crop' => ['zoom' => 1.5]]));
        $two = StorefrontMediaTransform::fromInput($this->transform(['crop' => ['zoom' => 2.5]]));

        $this->assertNotSame($one->key('m', 480, 'webp'), $two->key('m', 480, 'webp'), 'AMEND-11: zoom is part of identity');
        $this->assertNotSame($one->usageKey('m'), $two->usageKey('m'));
    }

    /** @test */
    public function every_identity_input_changes_the_key_and_width_and_format_and_media_do_too(): void
    {
        $base = StorefrontMediaTransform::fromInput($this->transform());
        $keys = [
            $base->key('m', 480, 'webp'),
            $base->key('m', 768, 'webp'),
            $base->key('m', 480, 'jpg'),
            $base->key('other', 480, 'webp'),
            StorefrontMediaTransform::fromInput($this->transform(['rotate' => 90]))->key('m', 480, 'webp'),
            StorefrontMediaTransform::fromInput($this->transform(['fit' => 'contain']))->key('m', 480, 'webp'),
            StorefrontMediaTransform::fromInput($this->transform(['focal' => ['x' => 10, 'y' => 10]]))->key('m', 480, 'webp'),
            StorefrontMediaTransform::fromInput($this->transform(['crop' => ['aspect' => '4:3']]))->key('m', 480, 'webp'),
            StorefrontMediaTransform::fromInput($this->transform(['crop' => ['x' => 0.26]]))->key('m', 480, 'webp'),
        ];

        $this->assertCount(count($keys), array_unique($keys));
    }

    /** @test */
    public function the_default_frame_has_no_derivatives_and_any_difference_is_a_transform(): void
    {
        $this->assertTrue(StorefrontMediaTransform::fromInput([])->isDefault());
        $this->assertTrue(StorefrontMediaTransform::fromInput(null)->isDefault());
        $this->assertTrue(StorefrontMediaTransform::fromInput(['focal' => ['x' => 50, 'y' => 50], 'fit' => 'cover', 'rotate' => 0])->isDefault());
        $this->assertFalse(StorefrontMediaTransform::fromInput(['rotate' => 90])->isDefault());
        $this->assertFalse(StorefrontMediaTransform::fromInput(['fit' => 'contain'])->isDefault());
        $this->assertFalse(StorefrontMediaTransform::fromInput(['focal' => ['x' => 20, 'y' => 50]])->isDefault());
    }

    /**
     * @test
     *
     * @dataProvider invalidTransforms
     */
    public function invalid_transforms_are_rejected_with_the_offending_path(array $input, string $path): void
    {
        try {
            StorefrontMediaTransform::fromInput($input);
            $this->fail('expected a rejection');
        } catch (InvalidArgumentException $e) {
            $this->assertStringStartsWith($path.':', $e->getMessage());
        }
    }

    /** @return array<string,array{0:array<string,mixed>,1:string}> */
    public static function invalidTransforms(): array
    {
        $crop = ['x' => 0.1, 'y' => 0.1, 'w' => 0.5, 'h' => 0.5, 'aspect' => '1:1', 'zoom' => 1];

        return [
            'unknown top-level key' => [['css' => 'x'], 'transform.css'],
            'rotate 45' => [['rotate' => 45], 'transform.rotate'],
            'fit stretch' => [['fit' => 'stretch'], 'transform.fit'],
            'focal out of range' => [['focal' => ['x' => 101, 'y' => 0]], 'transform.focal.x'],
            'focal unknown key' => [['focal' => ['x' => 1, 'y' => 1, 'z' => 1]], 'transform.focal.z'],
            'zoom above 4' => [['crop' => ['zoom' => 4.5] + $crop], 'transform.crop.zoom'],
            'zoom below 1' => [['crop' => ['zoom' => 0.5] + $crop], 'transform.crop.zoom'],
            'crop overflows right edge' => [['crop' => ['x' => 0.7] + $crop], 'transform.crop.w'],
            'crop overflows bottom edge' => [['crop' => ['y' => 0.7] + $crop], 'transform.crop.h'],
            'crop too thin' => [['crop' => ['w' => 0.001] + $crop], 'transform.crop.w'],
            'bad aspect' => [['crop' => ['aspect' => '2:1'] + $crop], 'transform.crop.aspect'],
            'crop unknown key' => [['crop' => ['style' => 'x'] + $crop], 'transform.crop.style'],
            'crop x as string' => [['crop' => ['x' => '0.1'] + $crop], 'transform.crop.x'],
        ];
    }

    // ═════════════════════════ هندسة الإطار ═════════════════════════

    /** @test */
    public function the_frame_region_follows_crop_zoom_and_focal_and_stays_inside_the_crop(): void
    {
        $region = static fn (array $t) => StorefrontMediaVariantGenerator::region(1000, 500, StorefrontMediaTransform::fromInput($t));

        $this->assertSame([0, 0, 1000, 500], $region(['rotate' => 90]), 'no crop = full frame');
        $this->assertSame([250, 50, 500, 250], $region($this->transform()));

        // zoom 2 حول المنتصف: نافذةٌ نصف الحجم في وسط المستطيل.
        $this->assertSame([375, 113, 250, 125], $region($this->transform(['crop' => ['zoom' => 2]])));
        // تركيزٌ عند الزاوية العليا اليسرى يلصق النافذة بها ولا يخرج من المستطيل.
        $this->assertSame([250, 50, 250, 125], $region($this->transform(['crop' => ['zoom' => 2], 'focal' => ['x' => 0, 'y' => 0]])));
        $this->assertSame([500, 175, 250, 125], $region($this->transform(['crop' => ['zoom' => 2], 'focal' => ['x' => 100, 'y' => 100]])));
    }

    // ═════════════════════════ التصيير بالبكسل ═════════════════════════

    /** @test */
    public function crop_rotate_and_never_upscale_are_visible_in_the_rendered_pixels(): void
    {
        $generator = app(StorefrontMediaVariantGenerator::class);
        $source = tempnam(sys_get_temp_dir(), 'sfdt');
        file_put_contents($source, $this->jpegBytes(1200, 640)); // يسار أحمر، يمين أزرق

        $render = function (array $t, array $widths = [480, 1280, 1920]) use ($generator, $source): array {
            $out = [];
            $generator->renderTransform($source, StorefrontMediaTransform::fromInput($t), $widths, function (int $w, string $f, string $bytes, string $mime, int $rw, int $rh) use (&$out): void {
                $out["{$w}.{$f}"] = ['bytes' => $bytes, 'rw' => $rw, 'rh' => $rh, 'mime' => $mime];
            });

            return $out;
        };

        // قصّ النصف الأيمن → أزرق بالكامل، وإطارٌ 600×640 (لا تكبير إلى 1920).
        $right = $render(['crop' => ['x' => 0.5, 'y' => 0, 'w' => 0.5, 'h' => 1, 'aspect' => 'free-locked', 'zoom' => 1]]);
        $this->assertEqualsCanonicalizing(['480.webp', '480.jpg', '1280.webp', '1280.jpg', '1920.webp', '1920.jpg'], array_keys($right));
        $this->assertSame([600, 640], [$right['1920.webp']['rw'], $right['1920.webp']['rh']], 'never upscaled past the frame');
        $this->assertSame([600, 640], [$right['1280.webp']['rw'], $right['1280.webp']['rh']]);
        $this->assertSame([480, 512], [$right['480.webp']['rw'], $right['480.webp']['rh']]);
        $this->assertSame($right['1920.jpg']['bytes'], $right['1280.jpg']['bytes'], 'widths clamped to the frame share one encode');
        $this->assertNotSame($right['480.jpg']['bytes'], $right['1280.jpg']['bytes']);
        [$r, , $b] = $this->pixel($right['480.jpg']['bytes'], 0.5, 0.5);
        $this->assertLessThan(60, $r);
        $this->assertGreaterThan(160, $b);

        // تدوير 90° بعقارب الساعة: الأحمر (يسار) يصير في الأعلى.
        $rotated = $render(['rotate' => 90], [480]);
        $this->assertSame([480, 900], [$rotated['480.jpg']['rw'], $rotated['480.jpg']['rh']], 'a 1200×640 frame becomes 640×1200 after a quarter turn, then fits 480 wide');
        [$topR, , $topB] = $this->pixel($rotated['480.jpg']['bytes'], 0.5, 0.1);
        [$botR, , $botB] = $this->pixel($rotated['480.jpg']['bytes'], 0.5, 0.9);
        $this->assertGreaterThan(160, $topR);
        $this->assertLessThan(60, $topB);
        $this->assertLessThan(60, $botR);
        $this->assertGreaterThan(160, $botB);

        // تصغيرٌ حين يكون الإطار أكبر من العرض الاسمي.
        $big = tempnam(sys_get_temp_dir(), 'sfdt');
        file_put_contents($big, $this->jpegBytes(1600, 900));
        $scaled = [];
        $generator->renderTransform($big, StorefrontMediaTransform::fromInput(['rotate' => 180]), [480, 768], function (int $w, string $f, string $bytes, string $m, int $rw, int $rh) use (&$scaled): void {
            $scaled["{$w}.{$f}"] = [$rw, $rh];
        });
        $this->assertSame([480, 270], $scaled['480.webp']);
        $this->assertSame([768, 432], $scaled['768.jpg']);

        @unlink($source);
        @unlink($big);
    }

    // ═════════════════════════ الأوركستريشن (AMEND-21) ═════════════════════════

    /** @test */
    public function ensure_renders_eight_files_from_one_decode_under_the_tenant_prefix_and_leaks_nothing(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-ensure');
        $media = $this->createReady($auth);
        $this->r2Calls = [];

        $response = $this->ensure($auth, $media['id'], $this->transform())->assertOk();
        $data = $response->json('data');

        $this->assertSame('ready', $data['state']);
        $this->assertFalse($data['retryable']);
        $this->assertCount(8, $data['files']);
        $this->assertSame([480, 480, 768, 768, 1280, 1280, 1920, 1920], array_column($data['files'], 'width'));
        foreach ($data['files'] as $file) {
            $this->assertSame('ready', $file['state']);
            $this->assertNotNull($file['url']);
            $this->assertLessThanOrEqual($file['width'], $file['rendered_width'], 'never upscaled');
        }

        $this->assertSame(1, count(array_filter($this->r2Calls, static fn (string $c): bool => str_starts_with($c, 'get:'))), 'exactly one source read per usage');
        $this->assertSame(8, count(array_filter($this->r2Calls, static fn (string $c): bool => str_starts_with($c, 'put:'))), 'bounded: eight files');

        $prefix = "tenant/{$auth['tenant_id']}/storefront-media/{$media['id']}/";
        $derivative = array_values(array_filter($this->r2KeysFor($auth['tenant_id'], $media['id']), static fn (string $k): bool => (bool) preg_match('/\/[a-f0-9]{32}\.(webp|jpg)\z/', $k)));
        $this->assertCount(8, $derivative);
        foreach ($derivative as $key) {
            $this->assertStringStartsWith($prefix, $key);
        }

        $json = json_encode($data);
        foreach (['storage_key', 'tenant/', 'bucket', 'sha256', 'region_luminance', '"transform"'] as $needle) {
            $this->assertStringNotContainsString($needle, (string) $json);
        }

        $this->assertSame(8, StorefrontMediaDerivative::query()->where('state', 'ready')->count());

        // CUST-HV V6b-1 (AMEND-8) — كل صفّ مشتقٍّ يحمل دليل البكسل للإطار المحوَّل (لا للأصل).
        foreach (StorefrontMediaDerivative::query()->get() as $row) {
            $this->assertSame('transform', $row->region_luminance['basis']);
            $this->assertNotNull(StorefrontMediaPixelEvidence::bounds($row->region_luminance));
        }
    }

    /** @test */
    public function ensure_is_idempotent_and_two_usages_of_one_asset_never_overwrite_each_other(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-idem');
        $media = $this->createReady($auth);

        $this->ensure($auth, $media['id'], $this->transform(['crop' => ['zoom' => 1.5]]))->assertOk();
        $before = $this->r2PutCount;
        $this->ensure($auth, $media['id'], $this->transform(['crop' => ['zoom' => 1.5]]))->assertOk()->assertJsonPath('data.state', 'ready');
        $this->assertSame($before, $this->r2PutCount, 're-ensuring a ready usage writes nothing');

        $this->ensure($auth, $media['id'], $this->transform(['crop' => ['zoom' => 2.5]]))->assertOk()->assertJsonPath('data.state', 'ready');

        $this->assertSame(16, StorefrontMediaDerivative::query()->count());
        $this->assertSame(16, StorefrontMediaDerivative::query()->distinct()->count('transform_key'));
        $this->assertSame(2, StorefrontMediaDerivative::query()->distinct()->count('usage_key'));
    }

    /** @test */
    public function the_default_frame_and_unready_or_unavailable_media_are_refused_with_stable_codes(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-refuse');
        $media = $this->createReady($auth);

        $this->ensure($auth, $media['id'], ['rotate' => 0])->assertStatus(422)->assertJsonPath('code', 'transform_is_default');

        StorefrontMedia::query()->whereKey($media['id'])->update(['variants_state' => 'failed']);
        $this->ensure($auth, $media['id'], $this->transform())->assertStatus(409)->assertJsonPath('code', 'media_not_ready');

        StorefrontMedia::query()->whereKey($media['id'])->update(['variants_state' => 'ready']);
        config()->set('storefront_media.r2.enabled', false);
        $this->ensure($auth, $media['id'], $this->transform())->assertStatus(503)->assertJsonPath('code', 'storage_not_enabled');
        $this->assertSame(0, StorefrontMediaDerivative::query()->count());
    }

    /** @test */
    public function status_is_a_pure_read_and_never_generates_even_for_a_missing_or_failed_usage(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-status');
        $media = $this->createReady($auth);
        $this->r2Calls = [];

        $absent = $this->withToken($auth['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives/status', ['transforms' => [$this->transform()]])
            ->assertOk()->json('data.0');
        $this->assertSame('absent', $absent['state']);
        $this->assertSame([], $absent['files']);
        $this->assertSame([], $this->r2Calls, 'status touches no storage');
        $this->assertSame(0, StorefrontMediaDerivative::query()->count(), 'status creates no rows');

        // فشلٌ ثم قراءة: تبقى الحالة فاشلة بلا إعادة توليدٍ ضمنية.
        $this->r2FailNextPuts = 8;
        $this->ensure($auth, $media['id'], $this->transform())->assertOk()->assertJsonPath('data.state', 'failed');
        $this->r2FailNextPuts = 0;
        $puts = $this->r2PutCount;

        $failed = $this->withToken($auth['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives/status', ['transforms' => [$this->transform()]])
            ->assertOk()->json('data.0');
        $this->assertSame('failed', $failed['state']);
        $this->assertTrue($failed['retryable']);
        $this->assertSame($puts, $this->r2PutCount, 'a read never regenerates');
    }

    /** @test */
    public function a_storage_failure_ends_every_row_failed_with_a_stable_code_cleans_up_and_retry_recovers(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-fail');
        $media = $this->createReady($auth);

        // الكتابة الرابعة تنقطع: لا صفّ يبقى pending، ولا ملف يتيم.
        $this->r2PutHook = function (array $args, int $count): void {
            if ($this->r2PutCount === 0) {
                return;
            }
        };
        $failAfter = $this->r2PutCount + 4;
        $this->r2PutHook = function (array $args, int $count) use ($failAfter): void {
            if ($count === $failAfter) {
                throw new \RuntimeException('simulated R2 outage');
            }
        };

        $first = $this->ensure($auth, $media['id'], $this->transform())->assertOk()->json('data');
        $this->r2PutHook = null;

        $this->assertSame('failed', $first['state']);
        $this->assertTrue($first['retryable']);
        $this->assertSame('storage_unavailable', $first['error_code']);
        $this->assertSame(0, StorefrontMediaDerivative::query()->where('state', 'pending')->count(), 'every claimed row reached a terminal state');
        $this->assertGreaterThan(0, StorefrontMediaDerivative::query()->where('state', 'ready')->count(), 'files that did store stay ready — the failure is per file');

        // بلا retry لا إعادة توليد (لا حلقة ساخنة).
        $puts = $this->r2PutCount;
        $this->ensure($auth, $media['id'], $this->transform())->assertOk()->assertJsonPath('data.state', 'failed');
        $this->assertSame($puts, $this->r2PutCount);

        // retry يعيد المحاولة للفاشل وحده ويبلغ ready.
        $retry = $this->ensure($auth, $media['id'], $this->transform(), retry: true)->assertOk()->json('data');
        $this->assertSame('ready', $retry['state']);
        $this->assertSame(8, StorefrontMediaDerivative::query()->where('state', 'ready')->count());
        $this->assertSame(0, StorefrontMediaDerivative::query()->whereNotNull('claimed_at')->count());
    }

    /** @test */
    public function a_user_rotation_is_costed_like_an_exif_rotation_and_an_oversized_decode_fails_terminally(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-budget');
        $media = $this->createReady($auth);
        // 40 MP: يتّسع للفكّ العادي (≈216 MB < 256) ولا يتّسع مع نسخةٍ مدوَّرة (≈512 MB).
        StorefrontMedia::query()->whereKey($media['id'])->update(['width' => 8000, 'height' => 5000]);

        $rotated = $this->ensure($auth, $media['id'], $this->transform(['rotate' => 90]))->assertOk()->json('data');
        $this->assertSame('failed', $rotated['state']);
        $this->assertSame('image_too_large_for_processing', $rotated['error_code']);
        $this->assertSame(0, StorefrontMediaDerivative::query()->where('state', 'pending')->count());

        $plain = $this->ensure($auth, $media['id'], $this->transform())->assertOk()->json('data');
        $this->assertSame('ready', $plain['state'], 'a plain crop of the same asset stays within budget');
    }

    /** @test */
    public function a_crashed_request_cannot_leave_a_usage_permanently_pending(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-crash');
        $media = $this->createReady($auth);

        // نحاكي انقطاع العملية بعد المطالبة وقبل التوليد: صفوفٌ pending بإيجارٍ قديم.
        $this->ensure($auth, $media['id'], $this->transform())->assertOk();
        StorefrontMediaDerivative::query()->update([
            'state' => 'pending',
            'generated_at' => null,
            'bytes' => null,
            'claimed_at' => now()->subMinutes(10),
        ]);

        $status = $this->withToken($auth['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives/status', ['transforms' => [$this->transform()]])->json('data.0');
        $this->assertSame('failed', $status['state'], 'an expired lease is read as failed, never as endless processing');
        $this->assertSame('interrupted', $status['error_code']);
        $this->assertTrue($status['retryable']);

        // طلبٌ لاحق (حتى بلا retry) يستردّ الإيجار المنتهي ويبلغ ready.
        $this->ensure($auth, $media['id'], $this->transform())->assertOk()->assertJsonPath('data.state', 'ready');
        $this->assertSame(8, StorefrontMediaDerivative::query()->where('state', 'ready')->count());
    }

    /** @test */
    public function a_live_lease_held_by_another_request_is_respected_and_never_double_generated(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-lease');
        $media = $this->createReady($auth);
        $this->ensure($auth, $media['id'], $this->transform())->assertOk();

        StorefrontMediaDerivative::query()->update(['state' => 'pending', 'generated_at' => null, 'claimed_at' => now()]);
        $puts = $this->r2PutCount;

        $response = $this->ensure($auth, $media['id'], $this->transform(), retry: true)->assertOk()->json('data');

        $this->assertSame('processing', $response['state']);
        $this->assertSame($puts, $this->r2PutCount, 'the live claimant owns generation');
    }

    /** @test */
    public function a_realistic_maximum_document_reaches_a_terminal_state_for_every_usage_in_bounded_requests(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-max');
        $assets = [$this->createReady($auth, 1200, 800), $this->createReady($auth, 1000, 1000), $this->createReady($auth, 1400, 700)];
        // يحتمل الاختبار انقطاعاً عابراً واحداً في منتصف الوثيقة.
        $outage = $this->r2PutCount + 150;
        $this->r2PutHook = function (array $args, int $count) use ($outage): void {
            if ($count === $outage) {
                throw new \RuntimeException('simulated R2 outage');
            }
        };

        $usages = [];
        for ($i = 0; $i < 40; $i++) {
            $usages[] = [$assets[$i % 3]['id'], $this->transform(['crop' => ['x' => 0.01 * ($i % 20), 'zoom' => 1 + ($i % 7) / 2.5]])];
        }

        $perRequest = [];
        foreach ($usages as [$id, $t]) {
            $before = $this->r2PutCount;
            $beforeCalls = count($this->r2Calls);
            $state = $this->ensure($auth, $id, $t)->assertOk()->json('data.state');
            $calls = array_slice($this->r2Calls, $beforeCalls);
            $perRequest[] = [
                'puts' => $this->r2PutCount - $before,
                'gets' => count(array_filter($calls, static fn (string $c): bool => str_starts_with($c, 'get:'))),
            ];
            $this->assertContains($state, ['ready', 'failed'], 'a request never returns an in-between state it owns');
        }
        $this->r2PutHook = null;

        $this->assertLessThanOrEqual(8, max(array_column($perRequest, 'puts')), 'every request is a bounded unit');
        $this->assertLessThanOrEqual(1, max(array_column($perRequest, 'gets')), 'one decode per usage');
        $this->assertSame(0, StorefrontMediaDerivative::query()->where('state', 'pending')->count(), 'no permanent-pending valid document');

        // إعادة محاولة الفاشل بنقرة (retry) تُكمل الوثيقة كلّها.
        foreach ($usages as [$id, $t]) {
            $status = $this->withToken($auth['token'])->postJson(self::BASE.'/'.$id.'/derivatives/status', ['transforms' => [$t]])->json('data.0');
            if ($status['state'] !== 'ready') {
                $this->assertTrue($status['retryable']);
                $this->ensure($auth, $id, $t, retry: true)->assertOk()->assertJsonPath('data.state', 'ready');
            }
        }
        foreach ($usages as [$id, $t]) {
            $this->assertSame('ready', $this->withToken($auth['token'])->postJson(self::BASE.'/'.$id.'/derivatives/status', ['transforms' => [$t]])->json('data.0.state'));
        }
        $this->assertSame(40 * 8, StorefrontMediaDerivative::query()->where('state', 'ready')->count());
    }

    /** @test */
    public function abuse_bounds_stop_unbounded_growth_but_never_block_an_existing_usage(): void
    {
        $this->fakeStorefrontMediaR2();
        config()->set('storefront_media.max_derivative_usages_per_media', 2);
        $auth = $this->registerTenant('sfd-bounds');
        $media = $this->createReady($auth);

        $this->ensure($auth, $media['id'], $this->transform(['crop' => ['x' => 0.1]]))->assertOk();
        $this->ensure($auth, $media['id'], $this->transform(['crop' => ['x' => 0.2]]))->assertOk();
        $this->ensure($auth, $media['id'], $this->transform(['crop' => ['x' => 0.3]]))->assertStatus(422)->assertJsonPath('code', 'derivative_limit_reached');
        $this->ensure($auth, $media['id'], $this->transform(['crop' => ['x' => 0.2]]))->assertOk()->assertJsonPath('data.state', 'ready');

        config()->set('storefront_media.max_derivative_usages_per_media', 200);
        config()->set('storefront_media.max_derivative_rows_per_tenant', 17);
        $this->ensure($auth, $media['id'], $this->transform(['crop' => ['x' => 0.3]]))->assertStatus(422)->assertJsonPath('code', 'derivative_quota_exceeded');
    }

    // ═════════════════════════ API: عزل، صلاحيات، تحقق ═════════════════════════

    /** @test */
    public function validation_names_the_offending_path_and_unknown_body_keys_are_rejected(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-validate');
        $media = $this->createReady($auth);

        $this->ensure($auth, $media['id'], $this->transform(['crop' => ['zoom' => 9]]))
            ->assertStatus(422)->assertJsonValidationErrors(['transform.crop.zoom']);
        $this->ensure($auth, $media['id'], ['rotate' => 33])
            ->assertStatus(422)->assertJsonValidationErrors(['transform.rotate']);
        $this->withToken($auth['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives', ['transform' => $this->transform(), 'tenant_id' => 'x', 'storage_key' => 'y'])
            ->assertStatus(422)->assertJsonValidationErrors(['tenant_id', 'storage_key']);
        $this->withToken($auth['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives', [])->assertStatus(422);

        $this->withToken($auth['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives/status', ['transforms' => [$this->transform(['crop' => ['aspect' => 'nope']])]])
            ->assertStatus(422)->assertJsonValidationErrors(['transforms.0.crop.aspect']);
        $many = array_fill(0, 17, $this->transform());
        $this->withToken($auth['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives/status', ['transforms' => $many])->assertStatus(422);
        $this->assertSame(0, StorefrontMediaDerivative::query()->count());
    }

    /** @test */
    public function derivatives_are_tenant_isolated_for_ensure_status_and_signed_reads(): void
    {
        $this->fakeStorefrontMediaR2();
        $a = $this->registerTenant('sfd-iso-a', 'a@sfd-iso.test');
        $b = $this->registerTenant('sfd-iso-b', 'b@sfd-iso.test');
        $media = $this->createReady($a);
        $ready = $this->ensure($a, $media['id'], $this->transform())->assertOk()->json('data');
        $before = StorefrontMediaDerivative::withoutGlobalScopes()->count();

        $this->ensure($b, $media['id'], $this->transform())->assertNotFound();
        $this->withToken($b['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives/status', ['transforms' => [$this->transform()]])->assertNotFound();
        $this->assertSame($before, StorefrontMediaDerivative::withoutGlobalScopes()->count(), 'a foreign probe creates nothing');

        // رابط A الموقَّع: يعمل كما هو، ولا يُحوَّل إلى مستأجر B، ولا يُعبَث بمفتاحه.
        $url = $ready['files'][0]['url'];
        $this->flushHeaders();
        $this->get($url)->assertOk()->assertHeader('Cache-Control', 'max-age=600, private');
        $this->get(preg_replace('/tenant=[^&]+/', 'tenant='.$b['tenant_id'], $url))->assertForbidden();
        $this->get(str_replace($ready['files'][0]['transform_key'], str_repeat('a', 32), $url))->assertForbidden();
        $this->get($url.'x')->assertForbidden();
    }

    /** @test */
    public function the_signed_read_serves_the_rendered_bytes_privately_and_404s_once_the_media_is_gone(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-read');
        $media = $this->createReady($auth, 1200, 640);
        $ready = $this->ensure($auth, $media['id'], ['crop' => ['x' => 0.5, 'y' => 0, 'w' => 0.5, 'h' => 1, 'aspect' => 'free-locked', 'zoom' => 1]])->assertOk()->json('data');

        $jpg = collect($ready['files'])->first(fn (array $f): bool => $f['format'] === 'jpg' && $f['width'] === 480);
        $this->flushHeaders();
        $response = $this->get($jpg['url'])->assertOk()->assertHeader('Content-Type', 'image/jpeg')->assertHeader('X-Content-Type-Options', 'nosniff');
        [$r, , $b] = $this->pixel($response->streamedContent(), 0.5, 0.5);
        $this->assertLessThan(60, $r);
        $this->assertGreaterThan(160, $b);

        // الوسيط المحذوف لا يُقرأ مشتقّه بعد الآن (يُعاد فحص الحالة في كل قراءة).
        StorefrontMedia::query()->whereKey($media['id'])->update(['state' => 'deleted']);
        $this->get($jpg['url'])->assertNotFound();
    }

    /** @test */
    public function the_signed_read_404s_for_anything_not_ready_or_not_a_derivative_file_name(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-read-bad');
        $media = $this->createReady($auth);
        $ready = $this->ensure($auth, $media['id'], $this->transform())->assertOk()->json('data');
        $row = StorefrontMediaDerivative::query()->where('format', 'webp')->where('width', 480)->firstOrFail();
        $this->flushHeaders();

        $row->forceFill(['state' => 'failed', 'error_code' => 'processing_failed'])->save();
        $this->get($this->derivativeUrl($auth['tenant_id'], $media['id'], $row->transform_key.'.webp'))->assertNotFound();

        // اسمٌ يطابق ملف السلّم الأساسي لا يمرّ من مسار المشتقّات أبداً.
        $this->get($this->derivativeUrl($auth['tenant_id'], $media['id'], '480w.webp'))->assertNotFound();
        $this->get($this->derivativeUrl($auth['tenant_id'], $media['id'], $row->transform_key.'.png'))->assertNotFound();
        $this->assertNotEmpty($ready['files']);
    }

    private function derivativeUrl(string $tenantId, string $mediaId, string $file): string
    {
        return \Illuminate\Support\Facades\URL::temporarySignedRoute(
            'commerce.workspace.storefront-media.derivative',
            now()->addMinutes(5),
            ['media' => $mediaId, 'tenant' => $tenantId, 'file' => $file],
        );
    }

    /** @test */
    public function roles_without_commerce_manage_self_service_and_anonymous_callers_are_refused(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-rbac');
        $media = $this->createReady($auth);
        $cashier = $this->tokenForRole($auth['tenant_id'], 'cashier', 'cashier@sfd-rbac.test');
        $self = $this->tokenForRole($auth['tenant_id'], 'self_service', 'self@sfd-rbac.test');
        $body = ['transform' => $this->transform()];

        foreach ([$cashier, $self] as $token) {
            $this->withToken($token)->postJson(self::BASE.'/'.$media['id'].'/derivatives', $body)->assertForbidden();
            $this->withToken($token)->postJson(self::BASE.'/'.$media['id'].'/derivatives/status', ['transforms' => [$this->transform()]])->assertForbidden();
        }

        $this->flushHeaders();
        $this->postJson(self::BASE.'/'.$media['id'].'/derivatives', $body)->assertUnauthorized();
        $this->postJson(self::BASE.'/'.$media['id'].'/derivatives/status', ['transforms' => [$this->transform()]])->assertUnauthorized();
        $this->assertSame(0, StorefrontMediaDerivative::query()->count());
    }

    /** @test */
    public function a_deleted_asset_cannot_be_given_new_derivatives(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfd-deleted');
        $media = $this->createReady($auth);
        $this->withToken($auth['token'])->deleteJson(self::BASE.'/'.$media['id'])->assertOk();

        $this->ensure($auth, $media['id'], $this->transform())->assertNotFound();
        $this->assertSame(0, StorefrontMediaDerivative::withoutGlobalScopes()->count());
        $this->assertTrue(Str::isUuid($media['id']));
        $this->assertInstanceOf(StorefrontMediaDerivativeService::class, app(StorefrontMediaDerivativeService::class));
    }
}
