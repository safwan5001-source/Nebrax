<?php

namespace Tests\Feature;

use App\Services\Commerce\StorefrontAnimatedImage;
use App\Services\Commerce\StorefrontMediaException;
use Tests\TestCase;

/**
 * AWJ-ANIMATED-MEDIA P1 — محلِّل بنية GIF / WebP المتحرك: القياس، التنقية، الإطار الأول، ورفض التالف.
 * تشغيل: php artisan test --filter=StorefrontAnimatedImageTest
 */
class StorefrontAnimatedImageTest extends TestCase
{
    use AnimatedMediaFixtures;

    private const GIF = 'image/gif';

    private const WEBP = 'image/webp';

    private function sut(): StorefrontAnimatedImage
    {
        return new StorefrontAnimatedImage;
    }

    /** @test */
    public function it_measures_an_animated_gif(): void
    {
        $m = $this->sut()->inspect($this->animatedGifBytes(), self::GIF);

        $this->assertSame('gif', $m['format']);
        $this->assertTrue($m['animated']);
        $this->assertSame([400, 400, 3], [$m['width'], $m['height'], $m['frames']]);
        $this->assertSame(600, $m['duration_ms'], '3 frames × 20 cs');
        $this->assertTrue($m['loop'], 'NETSCAPE loop count 0 = infinite');
    }

    /** @test */
    public function it_measures_an_animated_webp(): void
    {
        $m = $this->sut()->inspect($this->animatedWebpBytes(), self::WEBP);

        $this->assertSame('webp', $m['format']);
        $this->assertTrue($m['animated']);
        $this->assertSame([400, 400, 3], [$m['width'], $m['height'], $m['frames']]);
        $this->assertGreaterThanOrEqual(300, $m['duration_ms']);
    }

    /** @test */
    public function a_zero_or_tiny_frame_delay_is_counted_as_100ms_like_browsers_do(): void
    {
        $m = $this->sut()->inspect($this->gifWithFrames(4, delayCs: 0), self::GIF);

        $this->assertSame(4, $m['frames']);
        $this->assertSame(400, $m['duration_ms']);
    }

    /** @test */
    public function sanitising_a_gif_drops_comments_and_non_loop_extensions_but_keeps_animation(): void
    {
        $dirty = $this->gifWithMetadata();
        $this->assertStringContainsString('secret-note', $dirty);
        $this->assertStringContainsString('XMP DataXMP', $dirty);

        $clean = $this->sut()->sanitize($dirty, self::GIF);

        $this->assertStringNotContainsString('secret-note', $clean);
        $this->assertStringNotContainsString('XMP DataXMP', $clean);
        $this->assertStringNotContainsString('ImageMagick', $clean, 'unknown application extensions are dropped');
        $this->assertStringContainsString('NETSCAPE2.0', $clean, 'the loop extension survives');
        $this->assertStringStartsWith('GIF89a', $clean);
        $this->assertSame("\x3B", substr($clean, -1));

        $before = $this->sut()->inspect($dirty, self::GIF);
        $after = $this->sut()->inspect($clean, self::GIF);
        $this->assertSame($before, $after, 'sanitising never changes frames/duration/loop/size');
        $this->assertNotFalse(@imagecreatefromstring($clean), 'GD still decodes the sanitised file');
    }

    /** @test */
    public function sanitising_a_webp_drops_exif_and_xmp_and_clears_their_flags(): void
    {
        $dirty = $this->webpWithMetadata();
        $this->assertStringContainsString('secret', $dirty);
        $this->assertSame(3, $this->sut()->inspect($dirty, self::WEBP)['frames']);

        $clean = $this->sut()->sanitize($dirty, self::WEBP);

        $this->assertStringNotContainsString('EXIF', $clean);
        $this->assertStringNotContainsString('XMP ', $clean);
        $this->assertStringNotContainsString('secret', $clean);
        $this->assertSame(0, ord($clean[20]) & 0x0C, 'VP8X EXIF/XMP flags cleared');
        $this->assertSame(0x02, ord($clean[20]) & 0x02, 'animation flag kept');
        $this->assertSame(strlen($clean) - 8, unpack('V', substr($clean, 4, 4))[1], 'RIFF size is consistent');
        $this->assertSame(
            $this->sut()->inspect($this->animatedWebpBytes(), self::WEBP),
            $this->sut()->inspect($clean, self::WEBP),
        );
    }

    /** @test */
    public function the_poster_of_a_gif_and_of_a_webp_is_a_decodable_still_of_the_full_canvas(): void
    {
        foreach ([[$this->animatedGifBytes(), self::GIF], [$this->animatedWebpBytes(), self::WEBP]] as [$bytes, $mime]) {
            $poster = $this->sut()->posterBytes($bytes, $mime);
            $this->assertNotNull($poster, $mime);
            $image = @imagecreatefromstring($poster);
            $this->assertNotFalse($image, "$mime poster decodes");
            $this->assertSame([400, 400], [imagesx($image), imagesy($image)]);
            imagepalettetotruecolor($image);
            $rgb = imagecolorat($image, 200, 200);
            $this->assertGreaterThan(200, ($rgb >> 16) & 0xFF, "$mime first frame is the red one");
            $this->assertLessThan(60, $rgb & 0xFF);
        }
    }

    /** @test */
    public function a_webp_whose_first_frame_does_not_cover_the_canvas_has_no_safe_poster(): void
    {
        $bytes = $this->webpWithPartialFirstFrame();

        $this->assertNull($this->sut()->posterBytes($bytes, self::WEBP));
        $this->assertSame(3, $this->sut()->inspect($bytes, self::WEBP)['frames'], 'still structurally valid');
    }

    /** @test */
    public function a_static_gif_is_not_animated(): void
    {
        $static = base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');

        $m = $this->sut()->inspect($static, self::GIF);

        $this->assertFalse($m['animated']);
        $this->assertSame(1, $m['frames']);
    }

    /**
     * @test
     *
     * @dataProvider malformed
     */
    public function malformed_or_truncated_files_are_rejected_as_unreadable(string $mime, \Closure $make): void
    {
        try {
            $this->sut()->inspect($make($this), $mime);
            $this->fail('expected image_unreadable');
        } catch (StorefrontMediaException $e) {
            $this->assertSame('image_unreadable', $e->errorCode);
        }
    }

    /** @return array<string, array{string, \Closure}> */
    public static function malformed(): array
    {
        return [
            'gif cut before trailer' => [self::GIF, fn (self $t): string => substr($t->animatedGifBytes(), 0, -1)],
            'gif cut mid-frame' => [self::GIF, fn (self $t): string => substr($t->animatedGifBytes(), 0, 900)],
            'gif header only' => [self::GIF, fn (): string => 'GIF89a'.str_repeat("\0", 8)],
            'gif unknown block byte' => [self::GIF, function (self $t): string {
                $b = $t->animatedGifBytes();
                $p = strpos($b, "\x21\xF9"); // حدّ كتلة مؤكَّد (أول GCE)

                return substr($b, 0, $p)."\x77".substr($b, $p);
            }],
            'gif frame outside canvas' => [self::GIF, function (self $t): string {
                $b = $t->animatedGifBytes();
                $p = strpos($b, "\x2C");

                return substr($b, 0, $p + 1).pack('v', 390).substr($b, $p + 3); // left=390 + width 400 > 400
            }],
            'webp truncated' => [self::WEBP, fn (self $t): string => substr($t->animatedWebpBytes(), 0, -10)],
            'webp riff header only' => [self::WEBP, fn (): string => 'RIFF'.pack('V', 4).'WEBP'.str_repeat("\0", 8)],
            'webp not riff' => [self::WEBP, fn (): string => str_repeat('A', 64)],
            'webp frame outside canvas' => [self::WEBP, function (self $t): string {
                $b = $t->animatedWebpBytes();
                $p = strpos($b, 'ANMF');

                return substr($b, 0, $p + 8).substr(pack('V', 100), 0, 3).substr($b, $p + 11); // X = 200px
            }],
        ];
    }

    /** @test */
    public function the_frame_ceiling_protects_the_parser_itself(): void
    {
        $this->expectException(StorefrontMediaException::class);

        $this->sut()->inspect($this->gifWithFrames(2100), self::GIF);
    }

    /** @test */
    public function file_names_are_a_closed_set(): void
    {
        foreach (['animated.gif', 'animated.webp'] as $ok) {
            $this->assertTrue(StorefrontAnimatedImage::isValidFileName($ok));
        }
        foreach (['animated.png', 'animated.GIF', '../animated.gif', 'animated.gif/x', 'original.gif', 'animated.gif ', "animated.gif\n", '480w.webp'] as $bad) {
            $this->assertFalse(StorefrontAnimatedImage::isValidFileName($bad), $bad);
        }
    }
}
