<?php

namespace Tests\Feature;

use App\Services\Commerce\StorefrontMediaException;
use App\Services\Commerce\StorefrontMediaTransform;
use App\Services\Commerce\StorefrontMediaVariantGenerator;
use Intervention\Image\Interfaces\ImageManagerInterface;
use Tests\TestCase;

/**
 * AWJ-ANIMATED-MEDIA P2-0 (review fix) — a generated variant must never be larger than the Next media proxy will buffer.
 *
 * The proxy refuses any origin body above `DEFAULT_MAX_BODY_BYTES` (8 MiB) and answers 502; the upload limit (5 MiB, ≤ 8192
 * px, ≤ 40 MP) says nothing about the RE-ENCODED size, which grows with pixel count × entropy: a valid 3.8 MiB PNG of
 * 1920×8192 one-bit noise re-encodes to a 10.27 MiB `1920w.jpg`. The generator therefore enforces
 * `storefront_media.variant_max_bytes` (below the proxy bound) on every encoded file, on both generation paths.
 *
 * تشغيل: php artisan test --filter=StorefrontMediaVariantByteCeilingTest
 */
class StorefrontMediaVariantByteCeilingTest extends TestCase
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

    private function path(string $bytes): string
    {
        $path = tempnam(sys_get_temp_dir(), 'sfbc');
        file_put_contents($path, $bytes);

        return $this->temp[] = $path;
    }

    /**
     * `$levels`-level grey blocks of `$block`×`$block` px: PNG-compressible, but JPEG/WebP-hostile. A random 64×64 tile is
     * repeated across the canvas (setTile) — the same per-pixel entropy for the lossy encoders, built in milliseconds
     * instead of tens of seconds, and the PNG stays well under the upload limit.
     */
    private function noisePng(int $w, int $h, int $block, int $levels): string
    {
        mt_srand(11);
        $tile = imagecreatetruecolor(64, 64);
        $palette = [];
        for ($i = 0; $i < $levels; $i++) {
            $v = (int) round($i * 255 / max(1, $levels - 1));
            $palette[] = imagecolorallocate($tile, $v, $v, $v);
        }
        for ($y = 0; $y < 64; $y += $block) {
            for ($x = 0; $x < 64; $x += $block) {
                imagefilledrectangle($tile, $x, $y, $x + $block - 1, $y + $block - 1, $palette[mt_rand(0, $levels - 1)]);
            }
        }
        $im = imagecreatetruecolor($w, $h);
        imagesettile($im, $tile);
        imagefilledrectangle($im, 0, 0, $w - 1, $h - 1, IMG_COLOR_TILED);
        ob_start();
        imagepng($im, null, 9);

        return (string) ob_get_clean();
    }

    private function generator(): StorefrontMediaVariantGenerator
    {
        return new StorefrontMediaVariantGenerator(app(ImageManagerInterface::class));
    }

    /**
     * @return list<array{0:string,1:int}> file ⇒ bytes, in the order handed to the store
     */
    private function generateAll(string $path): array
    {
        $stored = [];
        $this->generator()->generate($path, function (string $file, string $bytes) use (&$stored): void {
            $stored[] = [$file, strlen($bytes)];
        });

        return $stored;
    }

    /** The largest encoded file `renderTransform` hands to the store, for one nominal width. */
    private function renderLargest(string $path, int $width): int
    {
        $largest = 0;
        $this->generator()->renderTransform($path, StorefrontMediaTransform::fromInput([]), [$width], function (int $w, string $format, string $bytes) use (&$largest): void {
            $largest = max($largest, strlen($bytes));
        });

        return $largest;
    }

    /**
     * The proxy's bound lives in TypeScript (`DEFAULT_MAX_BODY_BYTES` = 8 MiB). CI copies only selected directories into the
     * Laravel app, so this test cannot read that file; the cross-language pin is `media-proxy-guard.test.ts`, which reads
     * `config/storefront_media.php` and asserts ceiling < bound. This test pins the Laravel side of the same contract.
     *
     * @test
     */
    public function the_ceiling_is_configured_below_the_proxy_bound_and_above_the_animated_limit(): void
    {
        $ceiling = config('storefront_media.variant_max_bytes');
        $this->assertIsInt($ceiling, 'storefront_media.variant_max_bytes must exist');
        $this->assertLessThan(8 * 1024 * 1024, $ceiling, 'a variant at the ceiling must still be accepted by the proxy (8 MiB)');
        $this->assertGreaterThanOrEqual((int) config('storefront_media.animated.max_bytes'), $ceiling, 'the sanitised animated file (≤ its own upload limit) must fit');
    }

    /** @test */
    public function the_documented_worst_case_upload_never_yields_a_variant_the_proxy_would_refuse(): void
    {
        // Valid under every upload limit: 3.8 MiB ≤ 5 MiB, 8192 px max edge, 15.7 MP ≤ 40 MP.
        $png = $this->noisePng(1920, 8192, 1, 2);
        $this->assertLessThanOrEqual((int) config('storefront_media.max_bytes'), strlen($png));
        $this->assertLessThanOrEqual((int) config('storefront_media.max_edge'), 8192);
        $this->assertLessThanOrEqual((int) config('storefront_media.max_pixels'), 1920 * 8192);

        // Premise of the finding: the plain re-encode of this valid upload is larger than the proxy bound (8 MiB).
        $path = $this->path($png);
        $premise = strlen((string) app(ImageManagerInterface::class)->decodePath($path)->encodeUsingMediaType('image/jpeg', 85));
        $this->assertGreaterThan(8 * 1024 * 1024, $premise, 'the fixture no longer demonstrates the mismatch');

        $ceiling = (int) config('storefront_media.variant_max_bytes', 8 * 1024 * 1024);
        $oversized = [];
        try {
            $this->generator()->generate($path, function (string $file, string $bytes) use (&$oversized, $ceiling): void {
                if (strlen($bytes) > $ceiling) {
                    $oversized[] = [$file, strlen($bytes)];
                }
            });
            $this->fail('an un-servable variant must fail the generation, not be stored');
        } catch (StorefrontMediaException $e) {
            $this->assertSame('variant_too_large', $e->errorCode);
        }
        $this->assertSame([], $oversized, 'nothing above the ceiling may reach the store');
    }

    /** @test */
    public function a_variant_over_the_ceiling_is_re_encoded_smaller_instead_of_rejected_when_that_is_enough(): void
    {
        $path = $this->path($this->noisePng(1280, 1280, 2, 16));

        config()->set('storefront_media.variant_max_bytes', PHP_INT_MAX);
        $uncapped = $this->generateAll($path);
        $largest = max(array_column($uncapped, 1));

        $ceiling = (int) floor($largest * 0.95);
        config()->set('storefront_media.variant_max_bytes', $ceiling);
        $capped = $this->generateAll($path);

        $this->assertCount(count($uncapped), $capped, 'same ladder, same file names');
        foreach ($capped as [$file, $bytes]) {
            $this->assertLessThanOrEqual($ceiling, $bytes, $file);
        }
        $this->assertLessThan($largest, max(array_column($capped, 1)));
    }

    /** @test */
    public function the_transform_path_enforces_the_same_ceiling(): void
    {
        $path = $this->path($this->noisePng(1280, 1280, 2, 16));

        config()->set('storefront_media.variant_max_bytes', PHP_INT_MAX);
        $uncapped = $this->renderLargest($path, 1280);

        // Salvageable: a smaller re-encode fits.
        $ceiling = (int) floor($uncapped * 0.95);
        config()->set('storefront_media.variant_max_bytes', $ceiling);
        $this->assertLessThanOrEqual($ceiling, $this->renderLargest($path, 1280));

        // Not salvageable: no quality fits → a stable error code, nothing oversized stored.
        config()->set('storefront_media.variant_max_bytes', (int) floor($uncapped * 0.05));
        $oversized = 0;
        try {
            $this->generator()->renderTransform($path, StorefrontMediaTransform::fromInput([]), [1280], function (int $w, string $format, string $bytes) use (&$oversized): void {
                $oversized += strlen($bytes) > (int) config('storefront_media.variant_max_bytes') ? 1 : 0;
            });
            $this->fail('expected variant_too_large');
        } catch (StorefrontMediaException $e) {
            $this->assertSame('variant_too_large', $e->errorCode);
        }
        $this->assertSame(0, $oversized);
    }

    /** @test */
    public function images_that_already_fit_are_encoded_byte_for_byte_as_before(): void
    {
        $path = $this->path($this->noisePng(1000, 700, 8, 8));

        config()->set('storefront_media.variant_max_bytes', PHP_INT_MAX);
        $withoutCeiling = $this->hashes($path);
        config()->set('storefront_media.variant_max_bytes', 6 * 1024 * 1024);

        $this->assertSame($withoutCeiling, $this->hashes($path), 'published-media compatibility: the ceiling must not touch a variant that fits');
    }

    /** @return array<string,string> */
    private function hashes(string $path): array
    {
        $out = [];
        $this->generator()->generate($path, function (string $file, string $bytes) use (&$out): void {
            $out[$file] = md5($bytes);
        });

        return $out;
    }
}
