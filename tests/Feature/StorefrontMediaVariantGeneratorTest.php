<?php

namespace Tests\Feature;

use App\Services\Commerce\StorefrontMediaOrientation;
use App\Services\Commerce\StorefrontMediaVariantGenerator;
use Intervention\Image\Drivers\Gd\Driver as GdDriver;
use Intervention\Image\ImageManager;
use Intervention\Image\Interfaces\ImageManagerInterface;
use Tests\TestCase;

/**
 * CUST-HV V2a — مسار التصوير (N-1): اتجاه EXIF بلا امتداد `exif`، وسلّم
 * المتغيّرات. يثبت أن القارئ المدمج يطابق ما يفعله `orient()` حين يتوفر الامتداد،
 * فلا يُنتَج مقلوبٌ جانباً بصمتاً في صورة الإنتاج وCI (كلاهما بلا الامتداد).
 *
 * تشغيل: php artisan test --filter=StorefrontMediaVariantGeneratorTest
 */
class StorefrontMediaVariantGeneratorTest extends TestCase
{
    use StorefrontMediaTestSupport;

    /** @var list<string> */
    private array $temp = [];

    protected function tearDown(): void
    {
        foreach ($this->temp as $path) {
            @unlink($path);
        }
        parent::tearDown();
    }

    /** أربعة أرباع مميّزة: TL أحمر · TR أخضر · BL أزرق · BR أصفر. */
    private function quadrantJpeg(int $w, int $h, ?int $orientation): string
    {
        $image = imagecreatetruecolor($w, $h);
        $half = [intdiv($w, 2), intdiv($h, 2)];
        foreach ([
            [0, 0, $half[0] - 1, $half[1] - 1, [230, 20, 20]],
            [$half[0], 0, $w - 1, $half[1] - 1, [20, 230, 20]],
            [0, $half[1], $half[0] - 1, $h - 1, [20, 20, 230]],
            [$half[0], $half[1], $w - 1, $h - 1, [230, 230, 20]],
        ] as [$x1, $y1, $x2, $y2, $rgb]) {
            imagefilledrectangle($image, $x1, $y1, $x2, $y2, imagecolorallocate($image, ...$rgb));
        }
        ob_start();
        imagejpeg($image, null, 95);
        $jpeg = (string) ob_get_clean();

        return $orientation === null ? $jpeg : $this->withExifOrientation($jpeg, $orientation);
    }

    private function path(string $bytes): string
    {
        $path = tempnam(sys_get_temp_dir(), 'sfmg');
        file_put_contents($path, $bytes);

        return $this->temp[] = $path;
    }

    /**
     * `false` يحاكي صورة الإنتاج/CI (بلا امتداد `exif`): نعطّل أيضاً التدوير
     * التلقائي عند فكّ Intervention، وإلا — في بيئةٍ فيها الامتداد — لدارت
     * الصورة عند الفكّ ثم مرةً ثانية عبر القارئ المدمج.
     */
    private function generator(?bool $exifExtension): StorefrontMediaVariantGenerator
    {
        $manager = $exifExtension === false
            ? new ImageManager(GdDriver::class, autoOrientation: false)
            : app(ImageManagerInterface::class);

        return new StorefrontMediaVariantGenerator($manager, $exifExtension);
    }

    /** @return array{w:int,h:int,corners:array{tl:string,tr:string,bl:string,br:string}} */
    private function largestWebp(StorefrontMediaVariantGenerator $generator, string $path): array
    {
        $files = [];
        $result = $generator->generate($path, function (string $file, string $bytes) use (&$files): void {
            $files[$file] = $bytes;
        });
        $largest = collect($result['variants'])->where('format', 'webp')->where('kind', 'w')->sortByDesc('width')->first();
        $image = imagecreatefromstring($files[$largest['file']]);
        [$w, $h] = [imagesx($image), imagesy($image)];
        $name = static function (int $rgb): string {
            [$r, $g, $b] = [($rgb >> 16) & 255, ($rgb >> 8) & 255, $rgb & 255];

            return match (true) {
                $r > 150 && $g > 150 && $b < 100 => 'yellow',
                $r > 150 && $g < 100 && $b < 100 => 'red',
                $g > 150 && $r < 100 && $b < 100 => 'green',
                $b > 150 && $r < 100 && $g < 100 => 'blue',
                default => 'other',
            };
        };
        $at = fn (float $fx, float $fy): string => $name(imagecolorat($image, (int) ($w * $fx), (int) ($h * $fy)));

        return ['w' => $w, 'h' => $h, 'corners' => [
            'tl' => $at(0.25, 0.25), 'tr' => $at(0.75, 0.25), 'bl' => $at(0.25, 0.75), 'br' => $at(0.75, 0.75),
        ]];
    }

    /** @return array<string, array{int,string,bool}> orientation ⇒ [value, expected TL colour, swapsAxes] */
    public static function orientations(): array
    {
        return [
            '1 normal' => [1, 'red', false],
            '2 mirror horizontal' => [2, 'green', false],
            '3 rotate 180' => [3, 'yellow', false],
            '4 mirror vertical' => [4, 'blue', false],
            '5 transpose' => [5, 'red', true],
            '6 rotate 90 cw' => [6, 'blue', true],
            '7 transverse' => [7, 'yellow', true],
            '8 rotate 270 cw' => [8, 'green', true],
        ];
    }

    /**
     * @test
     *
     * @dataProvider orientations
     */
    public function the_builtin_reader_orients_every_exif_value_correctly_without_the_exif_extension(int $orientation, string $topLeft, bool $swaps): void
    {
        $path = $this->path($this->quadrantJpeg(1200, 800, $orientation));
        $this->assertSame($orientation, StorefrontMediaOrientation::read($path));

        $out = $this->largestWebp($this->generator(exifExtension: false), $path);

        $this->assertSame($swaps, $out['h'] > $out['w'], 'axes swap exactly for orientations 5–8');
        $this->assertSame($topLeft, $out['corners']['tl'], "orientation {$orientation}");
    }

    /**
     * @test
     *
     * @dataProvider orientations
     */
    public function the_builtin_reader_and_the_exif_extension_path_agree(int $orientation, string $topLeft, bool $swaps): void
    {
        if (! function_exists('exif_read_data')) {
            $this->markTestSkipped('exif extension not available in this runtime — the builtin path above is what runs here.');
        }
        $path = $this->path($this->quadrantJpeg(1200, 800, $orientation));

        $viaExtension = $this->largestWebp($this->generator(exifExtension: true), $path);
        $viaBuiltin = $this->largestWebp($this->generator(exifExtension: false), $path);

        $this->assertSame($viaExtension, $viaBuiltin);
        $this->assertSame($topLeft, $viaBuiltin['corners']['tl']);
    }

    /** @test */
    public function the_orientation_reader_handles_both_byte_orders_and_fails_safe_on_bad_input(): void
    {
        $jpeg = $this->quadrantJpeg(64, 64, null);

        foreach ([false, true] as $bigEndian) {
            foreach ([1, 3, 6, 8] as $value) {
                $this->assertSame($value, StorefrontMediaOrientation::fromBytes($this->withExifOrientation($jpeg, $value, $bigEndian)));
            }
        }

        $this->assertSame(1, StorefrontMediaOrientation::fromBytes($jpeg), 'no EXIF');
        $this->assertSame(1, StorefrontMediaOrientation::fromBytes(''), 'empty');
        $this->assertSame(1, StorefrontMediaOrientation::fromBytes('not a jpeg at all'));
        $this->assertSame(1, StorefrontMediaOrientation::fromBytes($this->withExifOrientation($jpeg, 9)), 'out-of-range value');
        $this->assertSame(1, StorefrontMediaOrientation::fromBytes($this->withExifOrientation($jpeg, 0)));

        // مقطع APP1 مبتور في منتصف IFD — لا قراءة خارج الحدود ولا استثناء.
        $withExif = $this->withExifOrientation($jpeg, 6);
        foreach ([8, 14, 20, 24, 30] as $cut) {
            $this->assertSame(1, StorefrontMediaOrientation::fromBytes(substr($withExif, 0, $cut)), "cut at {$cut}");
        }
        // طول مقطعٍ كاذب (أصغر من 2) لا يُسبّب حلقة لا نهائية.
        $this->assertSame(1, StorefrontMediaOrientation::fromBytes("\xFF\xD8\xFF\xE1\x00\x00junk"));
        $this->assertSame(1, StorefrontMediaOrientation::read('/nonexistent/path.jpg'));
    }

    /** @test */
    public function the_ladder_is_deterministic_bounded_and_described_per_file(): void
    {
        $path = $this->path($this->quadrantJpeg(3000, 2000, null));
        $stored = [];
        $result = $this->generator(false)->generate($path, function (string $file, string $bytes, string $mime) use (&$stored): void {
            $stored[$file] = [strlen($bytes), $mime];
        });

        $widths = collect($result['variants'])->where('kind', 'w')->pluck('width')->unique()->sort()->values()->all();
        $this->assertSame([480, 768, 1280, 1920], $widths, 'a 3000px source tops out at the 1920 rung');
        $this->assertSame(
            [160, 320],
            collect($result['variants'])->where('kind', 'thumb')->pluck('width')->unique()->sort()->values()->all(),
        );
        $this->assertCount(12, $result['variants']);
        $this->assertSame(3000, $result['width']);
        $this->assertSame(2000, $result['height']);

        foreach ($result['variants'] as $variant) {
            $this->assertSame($variant['file'], StorefrontMediaVariantGenerator::fileName($variant['kind'], $variant['width'], $variant['format']));
            $this->assertTrue(StorefrontMediaVariantGenerator::isValidFileName($variant['file']));
            $this->assertSame($stored[$variant['file']][0], $variant['bytes']);
            $this->assertSame($variant['format'] === 'webp' ? 'image/webp' : 'image/jpeg', $stored[$variant['file']][1]);
        }
    }

    /** @test */
    public function the_public_file_name_grammar_rejects_anything_outside_the_ladder_shape(): void
    {
        foreach (['480w.webp', '1920w.jpg', 'thumb-160.webp', 'thumb-320.jpg', '99w.jpg'] as $ok) {
            $this->assertTrue(StorefrontMediaVariantGenerator::isValidFileName($ok), $ok);
        }
        foreach (['original.jpg', '../480w.webp', '480w.png', '480w.webp/', 'thumb-200.webp', '480.webp', 'THUMB-160.webp', '480w.webp ', "480w.webp\n", '12345w.jpg', '480w.avif'] as $bad) {
            $this->assertFalse(StorefrontMediaVariantGenerator::isValidFileName($bad), json_encode($bad));
        }
    }
}
