<?php

namespace Tests\Feature;

use App\Models\StorefrontMedia;
use App\Models\StorefrontPresentation;
use App\Services\Commerce\StorefrontMediaPixelEvidence;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

/**
 * CUST-HV V2a — مكتبة وسائط المُخصِّص: رفع، سلّم المتغيّرات، قائمة، تعديل،
 * حذف آمن، استخدام، إعادة محاولة، قراءة موقَّعة، عزل المستأجرين.
 *
 * العقد: docs/plans/store/CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md §7.
 * تشغيل: php artisan test --filter=StorefrontMediaApiTest
 */
class StorefrontMediaApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';

    private string $uploadedBytes = '';

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    /** @return array<string,mixed> */
    private function uploadOne(array $auth, string $bytes, string $name = 'photo.jpg'): array
    {
        return $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($bytes, $name)]], ['Accept' => 'application/json'])
            ->json();
    }

    private function createReady(array $auth, int $w = 1600, int $h = 900, string $name = 'photo.jpg'): array
    {
        $json = $this->uploadOne($auth, $this->jpegBytes($w, $h), $name);
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media'];
    }

    // ───────────────────────── capability gate ─────────────────────────

    /** @test */
    public function uploads_are_gated_when_r2_is_not_enabled_and_never_fall_back_to_local_disk(): void
    {
        $this->fakeStorefrontMediaR2(enabled: false);
        $auth = $this->registerTenant('sfm-gate');

        $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(800, 600))]], ['Accept' => 'application/json'])
            ->assertStatus(503)
            ->assertJsonPath('code', 'storage_not_enabled');

        $this->assertSame([], $this->r2Calls, 'a gated upload must not touch storage at all');
        $this->assertSame(0, StorefrontMedia::query()->count());

        $this->withToken($auth['token'])->getJson(self::BASE)
            ->assertOk()
            ->assertJsonPath('meta.uploads_enabled', false)
            ->assertJsonPath('data', []);
    }

    // ───────────────────────── upload + variants ─────────────────────────

    /** @test */
    public function a_jpeg_upload_stores_the_original_and_the_full_variant_ladder_under_the_tenant_prefix(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-upload');

        $this->uploadedBytes = $this->jpegBytes(2000, 1200);
        $media = $this->uploadOne($auth, $this->uploadedBytes, 'banner.jpg')['data'][0]['media'];

        $this->assertSame('ready', $media['variants_state']);
        $this->assertSame(2000, $media['width']);
        $this->assertSame(1200, $media['height']);

        $keys = $this->r2KeysFor($auth['tenant_id'], $media['id']);
        $files = array_map(static fn (string $k): string => basename($k), $keys);
        sort($files);

        $this->assertSame([
            '1280w.jpg', '1280w.webp', '1920w.jpg', '1920w.webp', '480w.jpg', '480w.webp', '768w.jpg', '768w.webp',
            'original.jpg', 'thumb-160.jpg', 'thumb-160.webp', 'thumb-320.jpg', 'thumb-320.webp',
        ], $files);

        foreach ($keys as $key) {
            $args = $this->r2Objects[$key]['args'];
            $this->assertSame('awj-storefront-media-test', $args['Bucket']);
            $this->assertArrayNotHasKey('ACL', $args);
            $this->assertStringStartsWith("tenant/{$auth['tenant_id']}/storefront-media/{$media['id']}/", $key);
        }
        $this->assertSame('image/webp', $this->r2Objects["tenant/{$auth['tenant_id']}/storefront-media/{$media['id']}/480w.webp"]['type']);
        $this->assertSame('image/jpeg', $this->r2Objects["tenant/{$auth['tenant_id']}/storefront-media/{$media['id']}/480w.jpg"]['type']);

        // الأصل محفوظ كما رُفع بايتاً ببايت (مصدر كل قصٍّ لاحق).
        $this->assertSame(
            $this->uploadedBytes,
            $this->r2Objects["tenant/{$auth['tenant_id']}/storefront-media/{$media['id']}/original.jpg"]['body'],
        );

        // أبعاد كل متغيّر مسجَّلة وصحيحة، ولا تكبير.
        $row = StorefrontMedia::findOrFail($media['id']);
        foreach ($row->variantList() as $variant) {
            $this->assertLessThanOrEqual(2000, $variant['width']);
            $bytes = $this->r2Objects["tenant/{$auth['tenant_id']}/storefront-media/{$media['id']}/{$variant['file']}"]['body'];
            [$w, $h] = getimagesizefromstring($bytes);
            $this->assertSame([$variant['width'], $variant['height']], [$w, $h]);
            $this->assertSame((int) round(1200 * $variant['width'] / 2000), $variant['height'], 'aspect ratio preserved', 1);
        }
        $this->assertNotNull($row->avg_luminance);
        $this->assertMatchesRegularExpression('/^#[0-9a-f]{6}$/', $row->dominant_colour);

        // CUST-HV V6b-1 — دليل البكسل (حدّا القنوات) يُكتب مع المتغيّرات على أعرض إطار، لا متوسطاً.
        $evidence = $row->region_luminance;
        $this->assertSame(StorefrontMediaPixelEvidence::VERSION, $evidence['v']);
        $this->assertSame('frame', $evidence['basis']);
        $widest = max(array_column($row->variantList(), 'width'));
        $this->assertSame($widest, $evidence['width']);
        $this->assertFalse($evidence['alpha']);
        $this->assertCount(3, $evidence['min']);
        $this->assertNotNull(StorefrontMediaPixelEvidence::bounds($evidence));
    }

    /** @test */
    public function the_ladder_never_upscales_and_adds_the_source_width_as_its_top_rung(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-noupscale');

        $media = $this->createReady($auth, 640, 480);

        $files = array_map('basename', $this->r2KeysFor($auth['tenant_id'], $media['id']));
        sort($files);
        $this->assertSame([
            '480w.jpg', '480w.webp', '640w.jpg', '640w.webp', 'original.jpg',
            'thumb-160.jpg', 'thumb-160.webp', 'thumb-320.jpg', 'thumb-320.webp',
        ], $files);
    }

    /** @test */
    public function responses_never_expose_storage_paths_buckets_hashes_or_keys(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-hygiene');
        $this->createReady($auth);

        $body = $this->withToken($auth['token'])->get(self::BASE, ['Accept' => 'application/json'])->assertOk()->getContent();

        foreach (['storage_key', 'sha256', 'original.jpg', 'tenant/', 'awj-storefront-media-test', 'region_luminance', 'bucket', 'disk'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $body, "leaked: {$forbidden}");
        }
        $item = json_decode($body, true)['data'][0];
        $keys = array_keys($item);
        sort($keys);
        $this->assertSame(
            ['alt_ar', 'alt_en', 'created_at', 'height', 'id', 'mime', 'name', 'preview_url', 'size', 'thumbnail_url', 'usage_count', 'variants', 'variants_error', 'variants_state', 'width'],
            $keys,
        );
        $variantKeys = array_keys($item['variants'][0]);
        sort($variantKeys);
        $this->assertSame(['format', 'height', 'kind', 'width'], $variantKeys);
    }

    /** @test */
    public function identical_bytes_in_the_same_tenant_return_the_existing_asset(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-dedupe');
        $bytes = $this->jpegBytes(1000, 700);

        $first = $this->uploadOne($auth, $bytes, 'a.jpg');
        $callsAfterFirst = count($this->r2Calls);
        $second = $this->uploadOne($auth, $bytes, 'renamed.jpg');

        $this->assertSame('created', $first['data'][0]['status']);
        $this->assertSame('duplicate', $second['data'][0]['status']);
        $this->assertSame($first['data'][0]['media']['id'], $second['data'][0]['media']['id']);
        $this->assertSame($callsAfterFirst, count($this->r2Calls), 'a duplicate performs no storage work');
        $this->assertSame(1, StorefrontMedia::query()->count());
    }

    /** @test */
    public function identical_bytes_in_two_tenants_never_share_an_asset(): void
    {
        $this->fakeStorefrontMediaR2();
        $a = $this->registerTenant('sfm-dd-a', 'a@sfm-dd.test');
        $b = $this->registerTenant('sfm-dd-b', 'b@sfm-dd.test');
        $bytes = $this->jpegBytes(900, 600);

        $fromA = $this->uploadOne($a, $bytes)['data'][0]['media']['id'];
        $fromB = $this->uploadOne($b, $bytes)['data'][0]['media']['id'];

        $this->assertNotSame($fromA, $fromB);
        $this->assertNotSame([], $this->r2KeysFor($a['tenant_id'], $fromA));
        $this->assertSame([], $this->r2KeysFor($b['tenant_id'], $fromA), 'tenant B has nothing under A\'s asset');
        $this->assertNotSame([], $this->r2KeysFor($b['tenant_id'], $fromB));
    }

    /** @test */
    public function png_with_alpha_and_webp_sources_are_accepted_and_alpha_is_flattened_for_the_jpeg_fallback(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-formats');

        $png = $this->uploadOne($auth, $this->pngBytes(800, 500, alpha: true), 'logo.png')['data'][0]['media'];
        $webp = $this->uploadOne($auth, $this->webpBytes(800, 500), 'pic.webp')['data'][0]['media'];

        $this->assertSame('image/png', $png['mime']);
        $this->assertSame('image/webp', $webp['mime']);
        $this->assertSame('ready', $png['variants_state']);
        $this->assertSame('ready', $webp['variants_state']);

        // الجزء الشفاف (الربع الأيمن) يُسطَّح على الأبيض في JPEG، لا أسود.
        $jpg = $this->r2Objects["tenant/{$auth['tenant_id']}/storefront-media/{$png['id']}/480w.jpg"]['body'];
        $image = imagecreatefromstring($jpg);
        $rgb = imagecolorat($image, imagesx($image) - 5, 5);
        $this->assertGreaterThan(230, ($rgb >> 16) & 0xFF);
        $this->assertGreaterThan(230, ($rgb >> 8) & 0xFF);
        $this->assertGreaterThan(230, $rgb & 0xFF);
    }

    /** @test */
    public function exif_orientation_is_applied_to_every_variant(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-orient');

        // 1000×500، يسار أحمر / يمين أزرق، اتجاه 6 (تدوير 90° مع عقارب الساعة)
        // ⇒ 500×1000 بأحمر في الأعلى وأزرق في الأسفل.
        $media = $this->uploadOne($auth, $this->jpegBytes(1000, 500, orientation: 6), 'phone.jpg')['data'][0]['media'];

        $this->assertSame(500, $media['width']);
        $this->assertSame(1000, $media['height']);

        $webp = $this->r2Objects["tenant/{$auth['tenant_id']}/storefront-media/{$media['id']}/480w.webp"]['body'];
        [$w, $h] = getimagesizefromstring($webp);
        $this->assertLessThan($h, $w, 'portrait after orientation');

        $image = imagecreatefromstring($webp);
        $top = imagecolorat($image, intdiv($w, 2), 10);
        $bottom = imagecolorat($image, intdiv($w, 2), $h - 10);
        $this->assertGreaterThan(150, ($top >> 16) & 0xFF, 'red on top');
        $this->assertGreaterThan(150, $bottom & 0xFF, 'blue at the bottom');
    }

    // ───────────────────────── validation ─────────────────────────

    /**
     * @test
     *
     * @dataProvider rejectedFiles
     */
    public function invalid_files_are_rejected_with_a_stable_code_and_leave_no_trace(string $case, string $expectedCode): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-invalid-'.strtolower(substr(md5($case), 0, 6)));

        [$bytes, $name] = $this->invalidFile($case);
        $json = $this->uploadOne($auth, $bytes, $name);

        $this->assertSame('rejected', $json['data'][0]['status'], json_encode($json));
        $this->assertSame($expectedCode, $json['data'][0]['error']['code']);
        $this->assertSame(0, StorefrontMedia::query()->count());
        $this->assertSame([], $this->r2Calls, 'a rejected file never reaches storage');
    }

    /** @return array<string, array{string,string}> */
    public static function rejectedFiles(): array
    {
        return [
            'svg' => ['svg', 'unsupported_type'],
            'gif' => ['gif', 'unsupported_type'],
            'php disguised as jpg' => ['php', 'unsupported_type'],
            'pdf' => ['pdf', 'unsupported_type'],
            'animated webp' => ['animated-webp', 'animated_not_supported'],
            'apng' => ['apng', 'animated_not_supported'],
            'garbage claiming to be a jpeg' => ['corrupt', 'unsupported_type'],
            'truncated jpeg' => ['truncated', 'image_unreadable'],
            'truncated png' => ['truncated-png', 'image_unreadable'],
            'too small' => ['small', 'dimension_too_small'],
            'too wide' => ['wide', 'dimension_too_large'],
            'too heavy' => ['heavy', 'file_too_large'],
        ];
    }

    /** @return array{string,string} */
    private function invalidFile(string $case): array
    {
        return match ($case) {
            'svg' => ['<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><script>alert(1)</script></svg>', 'x.svg'],
            'gif' => [base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), 'x.gif'],
            'php' => ['<?php system($_GET["c"]); ?>', 'shell.jpg'],
            'pdf' => ["%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", 'x.jpg'],
            'animated-webp' => [$this->animatedWebpBytes(), 'x.webp'],
            'apng' => [$this->apngBytes(), 'x.png'],
            'corrupt' => [substr($this->jpegBytes(800, 600), 0, 2).str_repeat("\x00", 200), 'x.jpg'],
            'truncated' => [substr($this->jpegBytes(1600, 1200), 0, 700), 'cut.jpg'],
            'truncated-png' => [substr($this->pngBytes(800, 800), 0, 300), 'cut.png'],
            'small' => [$this->jpegBytes(300, 200), 'small.jpg'],
            'wide' => [$this->pngBytes(9000, 320), 'wide.png'],
            'heavy' => [$this->jpegBytes(800, 600).str_repeat('0', 5 * 1024 * 1024), 'heavy.jpg'],
        };
    }

    private function animatedWebpBytes(): string
    {
        // RIFF/WEBP + VP8X مع بتّ الحركة (0x02) — يكفي لفحص الرأس.
        $vp8x = "VP8X\x0A\x00\x00\x00\x02\x00\x00\x00\x1F\x03\x00\x1F\x03\x00";

        return 'RIFF'.pack('V', 4 + strlen($vp8x)).'WEBP'.$vp8x;
    }

    private function apngBytes(): string
    {
        $png = $this->pngBytes(400, 400);
        $actl = pack('N', 8).'acTL'.pack('N', 2).pack('N', 0);
        $chunk = $actl.pack('N', crc32('acTL'.pack('N', 2).pack('N', 0)));
        $ihdrEnd = 8 + 8 + 13 + 4;

        return substr($png, 0, $ihdrEnd).$chunk.substr($png, $ihdrEnd);
    }

    /** @test */
    public function the_pixel_limit_is_enforced(): void
    {
        $this->fakeStorefrontMediaR2();
        config()->set('storefront_media.max_pixels', 500_000);
        $auth = $this->registerTenant('sfm-pixels');

        $json = $this->uploadOne($auth, $this->jpegBytes(1000, 700));

        $this->assertSame('pixel_limit', $json['data'][0]['error']['code']);
        $this->assertSame([], $this->r2Calls);
    }

    /** @test */
    public function an_image_that_passes_the_header_checks_but_cannot_be_decoded_becomes_a_failed_asset_with_a_retryable_code(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-undecodable');

        // PNG سليم الرأس والذيل (IHDR/IEND) وبيانات IDAT تالفة: يعبر الفحص ويفشل الفكّ.
        $png = $this->pngBytes(700, 700);
        $idat = strpos($png, 'IDAT');
        $broken = substr($png, 0, $idat + 8).str_repeat("\xA5", 40).substr($png, $idat + 48);
        $json = $this->uploadOne($auth, $broken, 'broken.png');

        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));
        $media = $json['data'][0]['media'];
        $this->assertSame('failed', $media['variants_state']);
        $this->assertSame('image_unreadable', $media['variants_error']);
        $this->assertNull($media['thumbnail_url']);
        $this->assertSame(['original.png'], array_map('basename', $this->r2KeysFor($auth['tenant_id'], $media['id'])));

        // إعادة المحاولة على أصلٍ تالف تبقى failed بالرمز نفسه — لا حلقة ولا pending أبدي.
        $this->withToken($auth['token'])->postJson(self::BASE.'/'.$media['id'].'/retry')
            ->assertOk()->assertJsonPath('data.variants_state', 'failed')->assertJsonPath('data.variants_error', 'image_unreadable');
    }

    /** @test */
    public function an_image_too_large_for_the_decode_budget_is_refused_up_front_and_rotation_costs_more(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-memory');

        // 1200×900 = 1.08 MP ⇒ ≈ 5.0 MB plain / ≈ 13 MB rotated + 32 MB overhead.
        config()->set('storefront_media.decode_budget_bytes', 40 * 1024 * 1024);
        $plain = $this->uploadOne($auth, $this->jpegBytes(1200, 900), 'plain.jpg');
        $this->assertSame('created', $plain['data'][0]['status'], 'a plain image fits the budget');

        $rotated = $this->uploadOne($auth, $this->jpegBytes(1201, 900, orientation: 6), 'phone.jpg');
        $this->assertSame('rejected', $rotated['data'][0]['status']);
        $this->assertSame('image_too_large_for_processing', $rotated['data'][0]['error']['code']);

        config()->set('storefront_media.decode_budget_bytes', 2 * 1024 * 1024);
        $tiny = $this->uploadOne($auth, $this->jpegBytes(1202, 900), 'tiny-budget.jpg');
        $this->assertSame('image_too_large_for_processing', $tiny['data'][0]['error']['code']);
        $this->assertSame(1, StorefrontMedia::query()->count());
    }

    /** @test */
    public function more_than_eight_files_in_one_request_is_a_validation_error(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-nine');
        $files = [];
        for ($i = 0; $i < 9; $i++) {
            $files[] = $this->upload($this->jpegBytes(400, 400), "f{$i}.jpg");
        }

        $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => $files], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['files']);
        $this->assertSame([], $this->r2Calls);
    }

    /** @test */
    public function a_mixed_batch_reports_each_file_independently(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-batch');

        $json = $this->withToken($auth['token'])->post(self::BASE, ['files' => [
            $this->upload($this->jpegBytes(800, 600), 'ok.jpg'),
            $this->upload('<svg/>', 'bad.svg'),
            $this->upload($this->pngBytes(700, 500), 'ok2.png'),
        ]], ['Accept' => 'application/json'])->assertCreated()->json('data');

        $this->assertSame(['created', 'rejected', 'created'], array_column($json, 'status'));
        $this->assertSame('unsupported_type', $json[1]['error']['code']);
        $this->assertSame(2, StorefrontMedia::query()->count());
    }

    /** @test */
    public function the_per_tenant_asset_and_byte_quotas_are_enforced_before_any_storage_write(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-quota');
        config()->set('storefront_media.max_assets_per_tenant', 1);
        $this->createReady($auth, 800, 600);
        $calls = count($this->r2Calls);

        $json = $this->uploadOne($auth, $this->jpegBytes(801, 601));
        $this->assertSame('library_full', $json['data'][0]['error']['code']);

        config()->set('storefront_media.max_assets_per_tenant', 50);
        config()->set('storefront_media.max_bytes_per_tenant', 10_000);
        $json = $this->uploadOne($auth, $this->jpegBytes(802, 602));
        $this->assertSame('library_quota_exceeded', $json['data'][0]['error']['code']);

        $this->assertSame($calls, count($this->r2Calls));
    }

    // ───────────────────────── failure + retry ─────────────────────────

    /** @test */
    public function a_storage_outage_while_writing_the_original_leaves_no_row_and_reports_unavailable(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-outage');
        $this->r2FailNextPuts = 1;

        $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(800, 600))]], ['Accept' => 'application/json'])
            ->assertStatus(503)
            ->assertJsonPath('code', 'storage_unavailable');

        $this->assertSame(0, StorefrontMedia::query()->count());
        $this->assertSame([], array_keys($this->r2Objects));
    }

    /** @test */
    public function a_variant_failure_marks_the_asset_failed_cleans_partial_files_and_retry_recovers_it(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-retry');

        // الكتابة الأولى (الأصل) تنجح، ثم تفشل الثالثة (متغيّر) — حتى نرفع العطل.
        $original = $this->jpegBytes(1600, 900);
        $outage = true;
        $this->r2PutHook = function (array $args, int $n) use (&$outage): void {
            if ($outage && $n === 3) {
                throw new \RuntimeException('simulated variant write failure');
            }
        };

        $item = $this->uploadOne($auth, $original)['data'][0]['media'];

        $this->assertSame('failed', $item['variants_state']);
        $this->assertSame('storage_unavailable', $item['variants_error']);
        $this->assertNull($item['thumbnail_url']);
        $this->assertSame([], $item['variants']);
        $keys = array_map('basename', $this->r2KeysFor($auth['tenant_id'], $item['id']));
        $this->assertSame(['original.jpg'], $keys, 'partial variants are cleaned; the original stays for retry');

        // يبقى مرئياً وقابلاً لإعادة التسمية.
        $this->withToken($auth['token'])->patchJson(self::BASE.'/'.$item['id'], ['name' => 'مُعاد.jpg'])->assertOk();

        // إعادة المحاولة بعد زوال العطل تُنهي الحالة.
        $outage = false;
        $this->withToken($auth['token'])->postJson(self::BASE.'/'.$item['id'].'/retry')
            ->assertOk()
            ->assertJsonPath('data.variants_state', 'ready')
            ->assertJsonPath('data.variants_error', null);
        $this->assertCount(13, $this->r2KeysFor($auth['tenant_id'], $item['id']));

        // idempotent: ready يعود كما هو بلا عمل تخزين.
        $calls = count($this->r2Calls);
        $this->withToken($auth['token'])->postJson(self::BASE.'/'.$item['id'].'/retry')->assertOk();
        $this->assertSame($calls, count($this->r2Calls));
    }

    // ───────────────────────── list / search / update ─────────────────────────

    /** @test */
    public function the_library_lists_newest_first_with_cursor_pagination_and_searches_name_and_alt(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-list');

        for ($i = 0; $i < 26; $i++) {
            // أبعاد مختلفة لتجنّب إزالة التكرار.
            $created = $this->createReady($auth, 400 + $i, 400, sprintf('item-%02d.jpg', $i));
            // `created_at` بدقة الثانية: نثبّت ترتيب الإنشاء صراحةً.
            StorefrontMedia::withoutGlobalScopes()->where('id', $created['id'])->update(['created_at' => now()->subSeconds(1000 - $i)]);
        }
        $first = $this->withToken($auth['token'])->getJson(self::BASE)->assertOk();
        $this->assertCount(24, $first['data']);
        $this->assertTrue($first['meta']['has_more']);
        $this->assertSame('item-25.jpg', $first['data'][0]['name'], 'newest first');
        $this->assertSame(26, $first['meta']['library']['assets']);

        $second = $this->withToken($auth['token'])->getJson(self::BASE.'?cursor='.urlencode($first['meta']['next_cursor']))->assertOk();
        $this->assertCount(2, $second['data']);
        $this->assertFalse($second['meta']['has_more']);

        $target = $first['data'][3]['id'];
        $this->withToken($auth['token'])->patchJson(self::BASE.'/'.$target, ['alt_ar' => 'قهوة مختصة', 'alt_en' => 'Specialty coffee'])->assertOk();

        $this->withToken($auth['token'])->getJson(self::BASE.'?q=item-07')->assertOk()->assertJsonCount(1, 'data');
        $this->withToken($auth['token'])->getJson(self::BASE.'?q='.urlencode('مختصة'))->assertOk()->assertJsonPath('data.0.id', $target);
        $this->withToken($auth['token'])->getJson(self::BASE.'?q=SPECIALTY')->assertOk()->assertJsonPath('data.0.id', $target);
        $this->withToken($auth['token'])->getJson(self::BASE.'?q='.urlencode('%'))->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function rename_and_locale_alt_text_are_updatable_and_nothing_else(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-patch');
        $media = $this->createReady($auth);

        $this->withToken($auth['token'])->patchJson(self::BASE.'/'.$media['id'], [
            'name' => '  غلاف الموسم  ', 'alt_ar' => ' وصف عربي ', 'alt_en' => '',
        ])->assertOk()
            ->assertJsonPath('data.name', 'غلاف الموسم')
            ->assertJsonPath('data.alt_ar', 'وصف عربي')
            ->assertJsonPath('data.alt_en', null);

        foreach (['tenant_id', 'width', 'variants_state', 'state', 'storage_key', 'sha256'] as $field) {
            $this->withToken($auth['token'])->patchJson(self::BASE.'/'.$media['id'], [$field => 'x'])
                ->assertStatus(422)->assertJsonValidationErrors([$field]);
        }
        $this->withToken($auth['token'])->patchJson(self::BASE.'/'.$media['id'], ['name' => '   '])->assertStatus(422);
        $this->withToken($auth['token'])->patchJson(self::BASE.'/'.$media['id'], ['alt_ar' => str_repeat('ا', 301)])->assertStatus(422);
    }

    // ───────────────────────── delete + usage ─────────────────────────

    /** @test */
    public function an_unreferenced_asset_is_soft_deleted_and_stops_serving(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-delete');
        $media = $this->createReady($auth);
        $url = $media['thumbnail_url'];
        $this->get($url)->assertOk();

        $this->withToken($auth['token'])->deleteJson(self::BASE.'/'.$media['id'])->assertOk()->assertJsonPath('data.deleted', true);

        $row = StorefrontMedia::findOrFail($media['id']);
        $this->assertSame('deleted', $row->state);
        $this->assertNotNull($row->deleted_at);
        $this->assertEqualsWithDelta(30, now()->diffInDays($row->purge_after), 1);
        $this->withToken($auth['token'])->getJson(self::BASE)->assertJsonCount(0, 'data');
        $this->get($url)->assertNotFound();
        $this->withToken($auth['token'])->deleteJson(self::BASE.'/'.$media['id'])->assertNotFound();
        // الملفات تبقى حتى يزيلها المصالِح بعد المهلة (V2c).
        $this->assertNotSame([], $this->r2KeysFor($auth['tenant_id'], $media['id']));
    }

    /** @test */
    public function a_referenced_asset_cannot_be_deleted_and_the_409_lists_every_place_it_is_used(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-inuse');
        $seed = $this->seedMediaStorefront($auth['tenant_id']);
        $media = $this->createReady($auth);

        $draft = $this->seedVersionWithConfig($auth['tenant_id'], $seed['storefront']->id, $this->configReferencing($media['id']), 'مسودة الموسم');
        $other = $this->seedVersionWithConfig($auth['tenant_id'], $seed['storefront']->id, $this->configReferencing($media['id']), 'نسخة ثانية');
        $unrelated = $this->seedVersionWithConfig($auth['tenant_id'], $seed['storefront']->id, ['homepage' => ['sections' => []]], 'بلا وسائط');

        app(TenantContext::class)->set($auth['tenant_id']);
        StorefrontPresentation::create([
            'storefront_id' => $seed['storefront']->id,
            'schema_version' => 3,
            'draft_config' => $this->configReferencing($media['id']),
            'published_config' => $this->configReferencing($media['id']),
            'published_revision' => 1,
        ]);
        app(TenantContext::class)->forget();

        $response = $this->withToken($auth['token'])->deleteJson(self::BASE.'/'.$media['id'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'media_in_use');

        $usage = collect($response->json('usage'));
        $this->assertEqualsCanonicalizing(
            [$draft->id, $other->id],
            $usage->where('container', 'version')->pluck('id')->all(),
        );
        $this->assertCount(1, $usage->where('container', 'head_draft'));
        $this->assertCount(1, $usage->where('container', 'head_published'));
        $this->assertNotContains($unrelated->id, $usage->pluck('id')->all());
        $this->assertSame('homepage.sections.0.design.background.media', $usage->first()['path']);
        $this->assertSame('active', StorefrontMedia::findOrFail($media['id'])->state);

        $this->withToken($auth['token'])->getJson(self::BASE.'/'.$media['id'].'/usage')
            ->assertOk()
            ->assertJsonPath('data.count', 4)
            ->assertJsonFragment(['name' => 'مسودة الموسم']);
    }

    /** @test */
    public function the_unused_filter_and_usage_count_follow_real_references(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-unused');
        $seed = $this->seedMediaStorefront($auth['tenant_id']);
        $used = $this->createReady($auth, 800, 500, 'used.jpg');
        $free = $this->createReady($auth, 801, 500, 'free.jpg');
        $this->seedVersionWithConfig($auth['tenant_id'], $seed['storefront']->id, $this->configReferencing($used['id']));

        $all = collect($this->withToken($auth['token'])->getJson(self::BASE)->json('data'))->keyBy('id');
        $this->assertSame(1, $all[$used['id']]['usage_count']);
        $this->assertSame(0, $all[$free['id']]['usage_count']);

        $unused = $this->withToken($auth['token'])->getJson(self::BASE.'?unused=1')->assertOk()->json('data');
        $this->assertSame([$free['id']], array_column($unused, 'id'));
    }

    /** @test */
    public function a_single_asset_can_be_read_with_its_usage_count_and_the_same_safe_shape_as_the_list(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-show');
        $seed = $this->seedMediaStorefront($auth['tenant_id']);
        $used = $this->createReady($auth, 800, 500, 'used.jpg');
        $this->seedVersionWithConfig($auth['tenant_id'], $seed['storefront']->id, $this->configReferencing($used['id']));

        $json = $this->withToken($auth['token'])->getJson(self::BASE.'/'.$used['id'])->assertOk()->json('data');

        $this->assertSame($used['id'], $json['id']);
        $this->assertSame('used.jpg', $json['name']);
        $this->assertSame(1, $json['usage_count']);
        $this->assertSame('ready', $json['variants_state']);
        $this->assertNotNull($json['preview_url']);
        $this->assertSame(
            array_keys($used),
            array_keys($json),
            'القراءة المفردة بنفس قائمة السماح الضيقة للقائمة.',
        );
        $this->assertStringNotContainsString('storage_key', json_encode($json));
        $this->assertStringNotContainsString('sha256', json_encode($json));
    }

    /** @test */
    public function reading_a_single_asset_is_a_uniform_404_for_foreign_deleted_or_unknown_ids_and_is_role_gated(): void
    {
        $this->fakeStorefrontMediaR2();
        $a = $this->registerTenant('sfm-show-a', 'a@sfm-show.test');
        $b = $this->registerTenant('sfm-show-b', 'b@sfm-show.test');
        $media = $this->createReady($a);
        $gone = $this->createReady($a, 801, 500, 'gone.jpg');
        $this->withToken($a['token'])->deleteJson(self::BASE.'/'.$gone['id'])->assertOk();

        $foreign = $this->withToken($b['token'])->getJson(self::BASE.'/'.$media['id'])->assertNotFound();
        $deleted = $this->withToken($a['token'])->getJson(self::BASE.'/'.$gone['id'])->assertNotFound();
        $unknown = $this->withToken($a['token'])->getJson(self::BASE.'/00000000-0000-4000-8000-000000000000')->assertNotFound();
        $this->assertSame($foreign->json('message'), $deleted->json('message'));
        $this->assertSame($foreign->json('message'), $unknown->json('message'));

        $this->withToken($a['token'])->getJson(self::BASE.'/not-a-uuid')->assertNotFound();
        $cashier = $this->tokenForRole($a['tenant_id'], 'cashier', 'cashier@sfm-show.test');
        $this->withToken($cashier)->getJson(self::BASE.'/'.$media['id'])->assertForbidden();
        // `withToken` يثبّت الترويسة لبقية الاختبار — نزيلها قبل فحص «بلا مصادقة».
        $this->flushHeaders();
        $this->getJson(self::BASE.'/'.$media['id'])->assertUnauthorized();
    }

    // ───────────────────────── signed workspace reads ─────────────────────────

    /** @test */
    public function the_signed_link_serves_a_private_variant_and_rejects_tampering_and_expiry(): void
    {
        $client = $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-signed');
        $media = $this->createReady($auth);

        $ok = $this->get($media['thumbnail_url'])->assertOk();
        $this->assertSame('image/webp', $ok->headers->get('Content-Type'));
        $this->assertStringContainsString('private', $ok->headers->get('Cache-Control'));
        $this->assertStringNotContainsString('public', $ok->headers->get('Cache-Control'));
        $this->assertSame('nosniff', $ok->headers->get('X-Content-Type-Options'));
        [$w] = getimagesizefromstring($ok->streamedContent());
        $this->assertSame(320, $w);

        // توقيع مُعبَث به، أو معامِل مُبدَّل، أو ملف آخر ⇒ 403 (لا خدمة).
        $this->get($media['thumbnail_url'].'x')->assertForbidden();
        $this->get(str_replace('thumb-320.webp', 'thumb-160.webp', $media['thumbnail_url']))->assertForbidden();
        $this->get(preg_replace('/tenant=[^&]+/', 'tenant='.\Illuminate\Support\Str::uuid(), $media['thumbnail_url']))->assertForbidden();

        $this->travel(21)->minutes();
        $this->get($media['thumbnail_url'])->assertForbidden();
    }

    /** @test */
    public function a_signed_link_never_serves_the_original_or_an_unlisted_variant(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-signed-orig');
        $media = $this->createReady($auth, 700, 500);
        $svc = app(\App\Services\Commerce\StorefrontMediaService::class);

        app(TenantContext::class)->set($auth['tenant_id']);
        $row = StorefrontMedia::findOrFail($media['id']);
        $this->assertNull($svc->signedUrl($row, 'original.jpg'));
        $this->assertNull($svc->signedUrl($row, '1920w.webp'), 'a rung that was not generated is not signable');
        $forged = \Illuminate\Support\Facades\URL::temporarySignedRoute(
            'commerce.workspace.storefront-media.file',
            now()->addMinutes(5),
            ['media' => $media['id'], 'tenant' => $auth['tenant_id'], 'file' => 'original.jpg'],
        );
        app(TenantContext::class)->forget();

        $this->get($forged)->assertNotFound();
    }

    // ───────────────────────── isolation + RBAC ─────────────────────────

    /** @test */
    public function another_tenant_can_neither_see_nor_touch_the_asset(): void
    {
        $this->fakeStorefrontMediaR2();
        $a = $this->registerTenant('sfm-iso-a', 'a@sfm-iso.test');
        $b = $this->registerTenant('sfm-iso-b', 'b@sfm-iso.test');
        $media = $this->createReady($a);

        $this->withToken($b['token'])->getJson(self::BASE)->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($b['token'])->patchJson(self::BASE.'/'.$media['id'], ['name' => 'سرقة'])->assertNotFound();
        $this->withToken($b['token'])->deleteJson(self::BASE.'/'.$media['id'])->assertNotFound();
        $this->withToken($b['token'])->getJson(self::BASE.'/'.$media['id'].'/usage')->assertNotFound();
        $this->withToken($b['token'])->postJson(self::BASE.'/'.$media['id'].'/retry')->assertNotFound();

        $this->assertSame('active', StorefrontMedia::withoutGlobalScopes()->findOrFail($media['id'])->state);
        $this->assertSame($media['name'], StorefrontMedia::withoutGlobalScopes()->findOrFail($media['id'])->original_name);

        // رابط A الموقَّع لا يمكن تحويله إلى مستأجر B.
        $swapped = preg_replace('/tenant=[^&]+/', 'tenant='.$b['tenant_id'], $media['thumbnail_url']);
        $this->get($swapped)->assertForbidden();
    }

    /** @test */
    public function a_reference_in_another_tenant_does_not_block_deletion(): void
    {
        $this->fakeStorefrontMediaR2();
        $a = $this->registerTenant('sfm-ref-a', 'a@sfm-ref.test');
        $b = $this->registerTenant('sfm-ref-b', 'b@sfm-ref.test');
        $seedB = $this->seedMediaStorefront($b['tenant_id'], 'b-main');
        $media = $this->createReady($a);
        // وثيقة المستأجر B تحمل (بالصدفة/الخبث) معرّف وسيط المستأجر A.
        $this->seedVersionWithConfig($b['tenant_id'], $seedB['storefront']->id, $this->configReferencing($media['id']));

        $this->withToken($a['token'])->deleteJson(self::BASE.'/'.$media['id'])->assertOk();
    }

    /** @test */
    public function roles_without_commerce_manage_and_unauthenticated_callers_are_refused(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-rbac');
        $media = $this->createReady($auth);
        $cashier = $this->tokenForRole($auth['tenant_id'], 'cashier', 'cashier@sfm-rbac.test');

        $this->withToken($cashier)->getJson(self::BASE)->assertForbidden();
        $this->withToken($cashier)->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(800, 600))]], ['Accept' => 'application/json'])->assertForbidden();
        $this->withToken($cashier)->patchJson(self::BASE.'/'.$media['id'], ['name' => 'x'])->assertForbidden();
        $this->withToken($cashier)->deleteJson(self::BASE.'/'.$media['id'])->assertForbidden();
        $this->withToken($cashier)->getJson(self::BASE.'/'.$media['id'].'/usage')->assertForbidden();
        $this->withToken($cashier)->postJson(self::BASE.'/'.$media['id'].'/retry')->assertForbidden();

        // `withToken` يثبّت الترويسة لبقية الاختبار — نزيلها قبل فحص «بلا مصادقة».
        $this->flushHeaders();
        $this->getJson(self::BASE)->assertUnauthorized();
        $this->postJson(self::BASE)->assertUnauthorized();
    }

    /** @test */
    public function the_self_service_account_is_refused(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-self');
        $self = $this->tokenForRole($auth['tenant_id'], 'self_service', 'self@sfm.test');

        $this->withToken($self)->getJson(self::BASE)->assertForbidden();
    }
}
