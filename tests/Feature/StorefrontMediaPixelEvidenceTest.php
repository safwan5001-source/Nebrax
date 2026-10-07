<?php

namespace Tests\Feature;

use App\Services\Commerce\StorefrontMediaPixelEvidence;
use App\Services\Commerce\StorefrontMediaTransform;
use App\Services\Commerce\StorefrontMediaVariantGenerator;
use Intervention\Image\Interfaces\ImageManagerInterface;
use Tests\TestCase;

/**
 * CUST-HV V6b-1 — دليل البكسل لإثبات التباين فوق الصور (V0 §3.2.1 / §4.5 / AMEND-20 / AMEND-8).
 *
 * يثبت: (١) المسح يرى كل بكسل — نقطةٌ ساخنة واحدة تغيّر الحد؛ (٢) الدليل على إطار المشتقّ المحوَّل لا الأصل؛
 * (٣) الشفافية تُرفَع علماً؛ (٤) الهامش {@see StorefrontMediaPixelEvidence::SLACK} يغطي فعلاً رنين ترميز
 * JPEG/WebP وإعادة أخذ العيّنات عبر **كل ملفٍّ مرمَّزٍ** يولّده السلّم لصورٍ عدائيّة بجودة الإنتاج.
 *
 * تشغيل: php artisan test --filter=StorefrontMediaPixelEvidenceTest
 */
class StorefrontMediaPixelEvidenceTest extends TestCase
{
    /** @var list<string> */
    private array $temp = [];

    protected function tearDown(): void
    {
        foreach ($this->temp as $path) {
            @unlink($path);
        }
        parent::tearDown();
    }

    private function generator(): StorefrontMediaVariantGenerator
    {
        return new StorefrontMediaVariantGenerator(app(ImageManagerInterface::class));
    }

    private function png(\GdImage $image): string
    {
        $path = tempnam(sys_get_temp_dir(), 'sfev');
        imagepng($image, $path);
        $this->temp[] = $path;

        return $path;
    }

    /** @param  array{0:int,1:int,2:int}  $rgb */
    private function solid(int $w, int $h, array $rgb): \GdImage
    {
        $image = imagecreatetruecolor($w, $h);
        imagefilledrectangle($image, 0, 0, $w - 1, $h - 1, imagecolorallocate($image, ...$rgb));

        return $image;
    }

    /** @return array<string,mixed> */
    private function evidenceOfSource(string $path): array
    {
        return $this->generator()->generate($path, static function (): void {})['region_luminance'];
    }

    /** @test */
    public function a_single_hot_pixel_changes_the_bound_because_every_pixel_is_scanned(): void
    {
        $dark = $this->solid(640, 400, [20, 22, 24]);
        $evidence = $this->evidenceOfSource($this->png($dark));
        $this->assertSame([20, 22, 24], $evidence['min']);
        $this->assertSame([20, 22, 24], $evidence['max']);

        imagesetpixel($dark, 317, 201, imagecolorallocate($dark, 250, 240, 30));
        $evidence = $this->evidenceOfSource($this->png($dark));
        $this->assertSame([20, 22, 24], $evidence['min']);
        $this->assertSame([250, 240, 30], $evidence['max'], 'one bright pixel is enough: an average would have hidden it');
        $this->assertSame(StorefrontMediaPixelEvidence::VERSION, $evidence['v']);
        $this->assertSame('frame', $evidence['basis']);
        $this->assertSame(['abs' => StorefrontMediaPixelEvidence::SLACK_ABS, 'ringing' => StorefrontMediaPixelEvidence::SLACK_RINGING_PERCENT], $evidence['slack']);
        $this->assertFalse($evidence['alpha']);
    }

    /** @test */
    public function the_default_frame_evidence_is_taken_on_the_widest_frame_the_browser_can_show(): void
    {
        $result = $this->generator()->generate($this->png($this->solid(2400, 1000, [90, 90, 90])), static function (): void {});
        $this->assertSame(1920, $result['region_luminance']['width']);
        $this->assertSame(800, $result['region_luminance']['height']);
        $this->assertSame(2400, $result['width'], 'the asset keeps its true size; the evidence is on the widest SERVED frame');

        $small = $this->generator()->generate($this->png($this->solid(640, 400, [90, 90, 90])), static function (): void {});
        $this->assertSame(640, $small['region_luminance']['width'], 'no upscale: the widest frame is the source');
    }

    /** @test */
    public function a_transformed_usage_carries_the_evidence_of_its_own_rendered_pixels_not_the_assets(): void
    {
        // نصفٌ أسود ونصفٌ أبيض: الأصل يضمّ الطرفين، أما القصّ إلى النصف الأيمن فأبيض بالكامل.
        $image = $this->solid(1200, 600, [0, 0, 0]);
        imagefilledrectangle($image, 600, 0, 1199, 599, imagecolorallocate($image, 255, 255, 255));
        $path = $this->png($image);

        $asset = $this->evidenceOfSource($path);
        $this->assertSame([0, 0, 0], $asset['min']);
        $this->assertSame([255, 255, 255], $asset['max']);

        $stats = $this->generator()->renderTransform(
            $path,
            StorefrontMediaTransform::fromInput(['crop' => ['x' => 0.55, 'y' => 0, 'w' => 0.45, 'h' => 1, 'aspect' => 'free-locked', 'zoom' => 1]]),
            [480, 1280],
            static function (): void {},
        );
        $this->assertSame('transform', $stats['region_luminance']['basis']);
        $this->assertSame([255, 255, 255], $stats['region_luminance']['min'], 'the cropped usage shows only white — provable where the asset is not');
    }

    /** @test */
    public function a_semi_transparent_pixel_raises_the_alpha_flag_and_removes_the_bounds(): void
    {
        $image = imagecreatetruecolor(640, 400);
        imagealphablending($image, false);
        imagesavealpha($image, true);
        imagefill($image, 0, 0, imagecolorallocatealpha($image, 30, 30, 30, 0));
        $opaque = $this->evidenceOfSource($this->png($image));
        $this->assertFalse($opaque['alpha']);

        imagesetpixel($image, 10, 10, imagecolorallocatealpha($image, 30, 30, 30, 64));
        $evidence = $this->evidenceOfSource($this->png($image));
        $this->assertTrue($evidence['alpha'], 'what shows through is unknown here — never claimed as proven');
        $this->assertNull(StorefrontMediaPixelEvidence::bounds($evidence));
    }

    /** @test */
    public function bounds_add_a_margin_that_grows_with_the_channel_range_clamp_to_0_255_and_reject_anything_malformed(): void
    {
        $base = ['v' => 1, 'basis' => 'frame', 'width' => 10, 'height' => 10, 'min' => [0, 100, 250], 'max' => [10, 200, 255], 'alpha' => false, 'slack' => ['abs' => 12, 'ringing' => 20]];
        // margin = 12 + ceil(20% of the channel's range): 14 · 32 · 13 levels
        $this->assertSame(['min' => [0, 68, 237], 'max' => [24, 232, 255]], StorefrontMediaPixelEvidence::bounds($base));

        // the margin comes from the approved constants, never from what is stored: a narrower stored value cannot shrink the proof
        $this->assertSame(
            StorefrontMediaPixelEvidence::bounds($base),
            StorefrontMediaPixelEvidence::bounds(['slack' => ['abs' => 0, 'ringing' => 0]] + $base),
        );

        // a sharp edge's ringing is proportional to its contrast, so a wide range needs a wide margin
        $wide = ['min' => [25, 25, 25], 'max' => [235, 235, 235]] + $base;
        $this->assertSame(['min' => [0, 0, 0], 'max' => [255, 255, 255]], StorefrontMediaPixelEvidence::bounds($wide));

        foreach ([
            'unknown version' => ['v' => 2] + $base,
            'alpha' => ['alpha' => true] + $base,
            'alpha missing' => array_diff_key($base, ['alpha' => 1]),
            'min above max' => ['min' => [11, 100, 250]] + $base,
            'out of range' => ['max' => [10, 200, 256]] + $base,
            'not three channels' => ['min' => [0, 100]] + $base,
            'floats' => ['min' => [0.5, 100, 250]] + $base,
        ] as $label => $bad) {
            $this->assertNull(StorefrontMediaPixelEvidence::bounds($bad), $label);
        }
        $this->assertNull(StorefrontMediaPixelEvidence::bounds([]));
    }

    /**
     * أهم اختبارٍ هنا: يولّد السلّم الحقيقي (جودة الإنتاج) لصورٍ عدائية، يفكّ **كل ملفٍّ مرمَّز** (WebP وJPEG،
     * كل عرض)، ويقيس أقصى تجاوزٍ لأي قناةٍ خارج [الحدّ الأدنى، الأقصى] المخزَّنين — يجب ألا يتجاوز الهامش.
     *
     * @test
     *
     * @dataProvider hostileImages
     */
    public function the_slack_covers_the_real_encoded_files_of_every_ladder_rung(string $name): void
    {
        $source = $this->png($this->hostile($name, 960, 640));
        $files = [];
        $result = $this->generator()->generate($source, function (string $file, string $bytes) use (&$files): void {
            $files[$file] = $bytes;
        });
        $evidence = $result['region_luminance'];
        $this->assertGreaterThanOrEqual(8, count($files), 'every rung and format is measured');

        $bounds = StorefrontMediaPixelEvidence::bounds($evidence);
        $this->assertNotNull($bounds);

        // for every served file: how far outside the MEASURED [min,max] does any channel go, as a share of the
        // margin granted to that channel? ≤ 1 = contained; ≤ 0.75 = contained with a safety margin.
        $worst = 0.0;
        foreach ($files as $file => $bytes) {
            $decoded = imagecreatefromstring($bytes);
            $this->assertNotFalse($decoded, $file);
            $worst = max($worst, $this->overshootShare($decoded, $evidence, $bounds));
            imagedestroy($decoded);
        }

        $this->assertLessThanOrEqual(
            0.75,
            $worst,
            sprintf('%s: a served file uses %.0f%% of the granted margin (must stay ≤ 75%% so there is room for encoder and browser variation)', $name, $worst * 100),
        );
    }

    /** @return array<string,array{0:string}> */
    public static function hostileImages(): array
    {
        return [
            'hard 1px black/white checkerboard' => ['checker'],
            'mid-tone vertical stripes (60 | 200)' => ['stripes'],
            'saturated 1-2px speckle' => ['speckle'],
            'sharp diagonal edge, dark on light (25 | 235)' => ['diagonal'],
            'sharp diagonal edge, mid contrast (100 | 180)' => ['diagonal_mid'],
        ];
    }

    private function hostile(string $name, int $w, int $h): \GdImage
    {
        $image = imagecreatetruecolor($w, $h);
        $black = imagecolorallocate($image, 0, 0, 0);
        $white = imagecolorallocate($image, 255, 255, 255);
        $a = imagecolorallocate($image, 60, 60, 60);
        $b = imagecolorallocate($image, 200, 200, 200);

        if ($name === 'checker') {
            for ($y = 0; $y < $h; $y++) {
                for ($x = 0; $x < $w; $x++) {
                    imagesetpixel($image, $x, $y, (($x + $y) & 1) ? $white : $black);
                }
            }
        } elseif ($name === 'stripes') {
            for ($x = 0; $x < $w; $x++) {
                imageline($image, $x, 0, $x, $h - 1, (intdiv($x, 3) & 1) ? $b : $a);
            }
        } elseif ($name === 'speckle') {
            mt_srand(7);
            imagefilledrectangle($image, 0, 0, $w - 1, $h - 1, imagecolorallocate($image, 128, 128, 128));
            for ($i = 0; $i < 4000; $i++) {
                $x = mt_rand(0, $w - 2);
                $y = mt_rand(0, $h - 2);
                $c = imagecolorallocate($image, mt_rand(0, 1) * 255, mt_rand(0, 1) * 255, mt_rand(0, 1) * 255);
                imagefilledrectangle($image, $x, $y, $x + mt_rand(0, 1), $y + mt_rand(0, 1), $c);
            }
        } else {
            [$bg, $fg] = $name === 'diagonal_mid' ? [180, 100] : [235, 25];
            imagefilledrectangle($image, 0, 0, $w - 1, $h - 1, imagecolorallocate($image, $bg, $bg, $bg));
            imagefilledpolygon($image, [0, 0, $w, 0, 0, $h], imagecolorallocate($image, $fg, $fg, $fg));
        }

        return $image;
    }

    /**
     * @param  array<string,mixed>  $evidence
     * @param  array{min:list<int>,max:list<int>}  $bounds
     */
    private function overshootShare(\GdImage $decoded, array $evidence, array $bounds): float
    {
        $w = imagesx($decoded);
        $h = imagesy($decoded);
        $share = 0.0;
        // the margin granted per channel BEFORE clamping to 0–255 (a clamped bound simply cannot be exceeded)
        $granted = [];
        for ($i = 0; $i < 3; $i++) {
            $granted[$i] = StorefrontMediaPixelEvidence::SLACK_ABS
                + intdiv(StorefrontMediaPixelEvidence::SLACK_RINGING_PERCENT * ($evidence['max'][$i] - $evidence['min'][$i]) + 99, 100);
        }
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                $c = imagecolorat($decoded, $x, $y);
                $px = [($c >> 16) & 0xFF, ($c >> 8) & 0xFF, $c & 0xFF];
                for ($i = 0; $i < 3; $i++) {
                    $over = max($evidence['min'][$i] - $px[$i], $px[$i] - $evidence['max'][$i]);
                    if ($over > 0) {
                        $share = max($share, $over / $granted[$i]);
                    }
                }
            }
        }

        return $share;
    }
}
