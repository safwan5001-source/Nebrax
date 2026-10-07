<?php

namespace App\Services\Commerce;

use Intervention\Image\Colors\Rgb\Channels\Blue;
use Intervention\Image\Colors\Rgb\Channels\Green;
use Intervention\Image\Colors\Rgb\Channels\Red;
use Intervention\Image\Interfaces\ImageInterface;
use Intervention\Image\Interfaces\ImageManagerInterface;
use RuntimeException;

/**
 * CUST-HV V2a — توليد السلّم الأساسي لمتغيّرات وسائط المُخصِّص (V0 §7.5).
 *
 * **مسار تصويرٍ واحد (N-1):** نفس `ImageManagerInterface` (Intervention Image
 * على GD) الذي تستعمله وسائط المنتج في `ProductMediaDerivativeService` — لا
 * مكتبة ثانية ولا ربط حاوية ثانٍ. الفرق الوحيد أن هنا سلّماً مُعرَّفاً بالعرض
 * بصيغتين (WebP + JPEG احتياطي) بدل مقاسين ثابتين.
 *
 * **الذاكرة:** تُفكّ الصورة مرةً واحدة وتُصغَّر تنازلياً في المكان نفسه
 * (1920→1280→…→160)؛ فلا نسخة ثانية كاملة الحجم تُبقى حيّة، وكل ناتجٍ يُسلَّم
 * فوراً إلى `$store` ثم يُتخلَّص منه — قمة الذاكرة ≈ صورةٌ مفكوكةٌ واحدة +
 * ناتج الترميز الحالي. التصغير المتسلسل من أكبر مقاسٍ يُصغّر بدقةٍ كافية
 * لمتغيّرات العرض ويحدّ كلفة الوقت.
 *
 * **لا تكبير أبداً:** لا يُنتَج عرضٌ يفوق عرض المصدر؛ وعرض المصدر نفسه (حتى
 * 1920) يدخل السلّم كأعلى درجة لتكون أعلى جودةٍ متاحةً دائماً.
 *
 * **EXIF:** الاتجاه يُطبَّق دائماً — عبر `orient()` حين يتوفر امتداد `exif`،
 * وعبر قارئ اتجاهٍ مدمج (`StorefrontMediaOrientation`) حين يغيب (صورة
 * الإنتاج وCI بلا الامتداد؛ بدونه لا تدوير بصمتاً). إعادة الترميز تُسقط كل
 * البيانات الوصفية من المتغيّرات. الأصل المحفوظ يبقى كما رُفع ولا يُقدَّم
 * للعموم أبداً.
 */
final class StorefrontMediaVariantGenerator
{
    public const FORMAT_WEBP = 'webp';
    public const FORMAT_JPG = 'jpg';

    public const KIND_WIDTH = 'w';
    public const KIND_THUMB = 'thumb';

    private const MIME = [
        self::FORMAT_WEBP => 'image/webp',
        self::FORMAT_JPG => 'image/jpeg',
    ];

    /**
     * @param  bool|null  $exifExtension  null = اكتشاف تلقائي (`exif_read_data`)؛
     *                                    تمريرها صراحةً لاختبار المسار الاحتياطي.
     */
    public function __construct(
        private readonly ImageManagerInterface $images,
        private readonly ?bool $exifExtension = null,
    ) {}

    /** اسم الملف المتّفق عليه في المسار العام (V0 §7.8). */
    public static function fileName(string $kind, int $width, string $format): string
    {
        return $kind === self::KIND_THUMB
            ? "thumb-{$width}.{$format}"
            : "{$width}w.{$format}";
    }

    /** يطابق ما يقبله المسار العام والموقَّع: `{width}w.{fmt}` أو `thumb-{160|320}.{fmt}`. */
    public static function isValidFileName(string $file): bool
    {
        return preg_match('/\A(?:\d{2,4}w|thumb-(?:160|320))\.(?:webp|jpg)\z/', $file) === 1;
    }

    public static function mimeForFormat(string $format): string
    {
        return self::MIME[$format] ?? throw new RuntimeException('Unknown storefront media format.');
    }

    /**
     * @param  callable(string $file, string $bytes, string $mime): void  $store  يخزّن الناتج فوراً
     * @return array{
     *   width:int, height:int, avg_luminance:int, dominant_colour:string, region_luminance:array<string,mixed>|null,
     *   variants:list<array{kind:string,width:int,height:int,format:string,file:string,bytes:int}>
     * }
     */
    public function generate(string $sourcePath, callable $store): array
    {
        $image = $this->images->decodePath($sourcePath);
        $image = $this->exifAvailable()
            ? $image->orient()
            : $this->applyOrientation($image, StorefrontMediaOrientation::read($sourcePath));
        $sourceWidth = $image->width();
        $sourceHeight = $image->height();

        $rungs = $this->rungs($sourceWidth);
        $variants = [];
        $evidence = null;
        $evidenceBroken = false;

        foreach ($rungs as [$kind, $width]) {
            if ($image->width() > $width) {
                $image->scaleDown(width: $width);
            }

            // CUST-HV V6b-1 — دليل البكسل على أكبر إطارٍ يمكن عرضه (الدرجة الأولى = الأعرض)، مرةً واحدة.
            $evidence ??= StorefrontMediaPixelEvidence::scan($image);

            foreach ([self::FORMAT_WEBP, self::FORMAT_JPG] as $format) {
                $quality = (int) config("storefront_media.quality.{$format}", 85);
                $encoded = $format === self::FORMAT_WEBP
                    ? $image->encodeUsingMediaType('image/webp', $quality)
                    : $image->encodeUsingMediaType('image/jpeg', $quality);
                $bytes = (string) $encoded;
                $file = self::fileName($kind, $width, $format);
                $this->foldEncodedEvidence($evidence, $evidenceBroken, $bytes, 'frame');

                $store($file, $bytes, self::MIME[$format]);

                $variants[] = [
                    'kind' => $kind,
                    'width' => $image->width(),
                    'height' => $image->height(),
                    'format' => $format,
                    'file' => $file,
                    'bytes' => strlen($bytes),
                ];
                unset($encoded, $bytes);
            }
        }

        // الإحصاءات الاستشارية من أصغر مقاسٍ (آخر درجة) — الصورة الآن ≤160px.
        [$luminance, $colour] = $this->sampleStatistics($image);

        usort($variants, static fn (array $a, array $b): int => [$a['kind'], $a['width'], $a['format']] <=> [$b['kind'], $b['width'], $b['format']]);

        return [
            'width' => $sourceWidth,
            'height' => $sourceHeight,
            'avg_luminance' => $luminance,
            'dominant_colour' => $colour,
            'region_luminance' => $evidenceBroken ? null : ($evidence ?? StorefrontMediaPixelEvidence::scan($image)),
            'variants' => $variants,
        ];
    }

    /**
     * CUST-HV V6b-1 (Codex P1 على #1277) — الدليل يشمل **الملفات المرمَّزة كما تُقدَّم**: ترميز JPEG/WebP
     * (تقليل دقة اللون chroma subsampling، رنين الحواف) يُنتج قنواتٍ لا وجود لها في بكسلات الإطار الخام
     * (مثلاً رقعة شطرنج أحمر/أصفر بقناة زرقاء 0 تُفكّ بزرقةٍ ≈ 80)، فيُفكّ كل ملفٍّ مُنتَج ويُقاس ويُوحَّد مع
     * قياس الإطار. تعذّر فكّ ملفٍ أنتجناه ⇒ لا دليل (null) = غير قابل للإثبات (fail-closed).
     *
     * @param  array<string,mixed>|null  $evidence
     */
    private function foldEncodedEvidence(?array &$evidence, bool &$broken, string $bytes, string $basis): void
    {
        if ($broken || $evidence === null) {
            return;
        }
        try {
            $measured = StorefrontMediaPixelEvidence::scan($this->images->decodeBinary($bytes), $basis);
            $evidence = StorefrontMediaPixelEvidence::union($evidence, $measured);
        } catch (\Throwable) {
            $broken = true;
        }
    }

    /**
     * CUST-HV V2b — يُصيِّر **إطاراً واحداً** (تحويل استخدامٍ) بعدة عروضٍ اسمية
     * من فكٍّ واحد للأصل (مسار التصوير الواحد N-1): اتجاه EXIF → تدوير المستخدم
     * (بعقارب الساعة) → قصّ → تكبير حول نقطة التركيز → تصغيرٌ تنازليٌّ في المكان.
     * وحدة عملٍ محدودة بالبناء: فكٌّ واحد + ترميزاتٌ بعدد (عروضٍ مميّزة × صيغتين).
     *
     * **لا تكبير:** العرض المُصيَّر = min(الاسمي، عرض الإطار)؛ فعرضان اسميّان
     * أكبر من الإطار يشتركان في ناتجٍ واحدٍ يُرمَّز مرةً ويُسلَّم لكلٍّ منهما
     * (يبقى لكلٍّ مفتاحه ولا يتغيّر ناتج المفتاح).
     *
     * @param  list<int>  $widths  العروض الاسمية (مفاتيح المشتقّات)
     * @param  callable(int $width, string $format, string $bytes, string $mime, int $renderedWidth, int $renderedHeight): void  $store
     * @return array{avg_luminance:int, dominant_colour:string, region_luminance:array<string,mixed>|null, frame:array{width:int,height:int}}
     */
    public function renderTransform(string $sourcePath, StorefrontMediaTransform $transform, array $widths, callable $store): array
    {
        $image = $this->images->decodePath($sourcePath);
        $image = $this->exifAvailable()
            ? $image->orient()
            : $this->applyOrientation($image, StorefrontMediaOrientation::read($sourcePath));

        if ($transform->rotate !== 0) {
            // Intervention 4: الزاوية الموجبة بعقارب الساعة — كدلالة CSS (وكجدول
            // الاتجاه أعلاه: EXIF 6 = `rotate(90)`).
            $image->rotate($transform->rotate);
        }

        [$x, $y, $w, $h] = self::region($image->width(), $image->height(), $transform);
        if ($w !== $image->width() || $h !== $image->height()) {
            $image->crop($w, $h, $x, $y);
        }
        $frame = ['width' => $image->width(), 'height' => $image->height()];

        $widths = array_values(array_unique(array_map('intval', $widths)));
        rsort($widths);

        /** @var array<string,string> $encoded مفتاحه "{renderedWidth}.{format}" — يُرمَّز مرةً لكل عرضٍ فعليّ */
        $encoded = [];
        $evidence = null;
        $evidenceBroken = false;
        foreach ($widths as $nominal) {
            $target = min($nominal, $image->width());
            if ($image->width() > $target) {
                $image->scaleDown(width: $target);
            }
            // CUST-HV V6b-1 (AMEND-8) — الدليل على بكسلات الإطار **المحوَّل** كما يُعرَض (أعرض عرضٍ مُصيَّر).
            $evidence ??= StorefrontMediaPixelEvidence::scan($image, 'transform');
            foreach ([self::FORMAT_WEBP, self::FORMAT_JPG] as $format) {
                $cacheKey = $image->width().'.'.$format;
                if (! isset($encoded[$cacheKey])) {
                    $quality = (int) config("storefront_media.quality.{$format}", 85);
                    $encoded[$cacheKey] = (string) ($format === self::FORMAT_WEBP
                        ? $image->encodeUsingMediaType('image/webp', $quality)
                        : $image->encodeUsingMediaType('image/jpeg', $quality));
                    $this->foldEncodedEvidence($evidence, $evidenceBroken, $encoded[$cacheKey], 'transform');
                }
                $store($nominal, $format, $encoded[$cacheKey], self::MIME[$format], $image->width(), $image->height());
            }
        }

        [$luminance, $colour] = $this->sampleStatistics($image);

        return [
            'avg_luminance' => $luminance,
            'dominant_colour' => $colour,
            'region_luminance' => $evidenceBroken ? null : ($evidence ?? StorefrontMediaPixelEvidence::scan($image, 'transform')),
            'frame' => $frame,
        ];
    }

    /**
     * مستطيل الإطار بالبكسل [x, y, w, h] على الصورة بعد الاتجاه والتدوير.
     * القصّ مستطيلٌ مُطبَّع (0–1)؛ `zoom` > 1 يضيّقه حول نقطة التركيز (كنسبةٍ
     * داخل المستطيل، المنتصف عند غيابها) مع بقاء النافذة داخله. بلا قصّ: الإطار
     * كامل ولا تكبير. نقطة التركيز/الملاءمة وحدهما لا يغيّران البكسلات إلا عبر
     * التكبير (هما `object-position`/`object-fit` عند العرض).
     *
     * @return array{0:int,1:int,2:int,3:int}
     */
    public static function region(int $imageWidth, int $imageHeight, StorefrontMediaTransform $transform): array
    {
        if ($transform->crop === null) {
            return [0, 0, $imageWidth, $imageHeight];
        }

        $crop = $transform->crop;
        $x0 = (int) round($crop['x'] * $imageWidth);
        $y0 = (int) round($crop['y'] * $imageHeight);
        $cw = max(1, min($imageWidth - $x0, (int) round($crop['w'] * $imageWidth)));
        $ch = max(1, min($imageHeight - $y0, (int) round($crop['h'] * $imageHeight)));

        if ($transform->zoom > 1.0) {
            $zw = max(1, (int) round($cw / $transform->zoom));
            $zh = max(1, (int) round($ch / $transform->zoom));
            $fx = ($transform->focal['x'] ?? 50) / 100;
            $fy = ($transform->focal['y'] ?? 50) / 100;
            $cx = $x0 + $fx * $cw;
            $cy = $y0 + $fy * $ch;
            $x0 = (int) max($x0, min($x0 + $cw - $zw, (int) round($cx - $zw / 2)));
            $y0 = (int) max($y0, min($y0 + $ch - $zh, (int) round($cy - $zh / 2)));
            $cw = $zw;
            $ch = $zh;
        }

        return [$x0, $y0, $cw, $ch];
    }

    private function exifAvailable(): bool
    {
        return $this->exifExtension ?? function_exists('exif_read_data');
    }

    /**
     * نفس جدول `Intervention\Image\Drivers\Gd\Modifiers\OrientModifier`
     * حرفياً، يُستعمل فقط حين يغيب امتداد `exif` (فلا يُطبَّق التدوير مرتين).
     */
    private function applyOrientation(ImageInterface $image, int $orientation): ImageInterface
    {
        return match ($orientation) {
            2 => $image->flip(),
            3 => $image->rotate(180),
            4 => $image->rotate(180)->flip(),
            5 => $image->rotate(90)->flip(),
            6 => $image->rotate(90),
            7 => $image->rotate(270)->flip(),
            8 => $image->rotate(270),
            default => $image,
        };
    }

    /**
     * درجات السلّم تنازلياً: عروض السلّم الأصغر من المصدر + عرض المصدر نفسه
     * (حتى 1920) + المصغّرات. المصدر ≥ 320px على الضلع الأقصر (التحقق قبل هنا)
     * فلا تكبير ولا مصغّر مفقود.
     *
     * @return list<array{0:string,1:int}>
     */
    private function rungs(int $sourceWidth): array
    {
        /** @var list<int> $ladder */
        $ladder = array_map('intval', (array) config('storefront_media.ladder_widths', [480, 768, 1280, 1920]));
        /** @var list<int> $thumbs */
        $thumbs = array_map('intval', (array) config('storefront_media.thumbnail_widths', [160, 320]));

        $widths = array_filter($ladder, static fn (int $w): bool => $w < $sourceWidth);
        $widths[] = min($sourceWidth, max($ladder));
        $widths = array_values(array_unique($widths));

        $rungs = [];
        foreach ($widths as $w) {
            $rungs[] = [self::KIND_WIDTH, $w];
        }
        foreach ($thumbs as $w) {
            if ($w <= $sourceWidth) {
                $rungs[] = [self::KIND_THUMB, $w];
            }
        }

        usort($rungs, static fn (array $a, array $b): int => $b[1] <=> $a[1]);

        return $rungs;
    }

    /**
     * متوسط إضاءة Rec.709 على قيم sRGB + متوسط اللون، من عيّنة 16×16.
     * **استشاري فقط** (V0 §4.5.7) — لا يصلح دليل تباين.
     *
     * @return array{0:int,1:string}
     */
    private function sampleStatistics(ImageInterface $image): array
    {
        $image->resize(16, 16);

        $r = $g = $b = 0;
        $count = 0;
        for ($y = 0; $y < 16; $y++) {
            for ($x = 0; $x < 16; $x++) {
                $color = $image->colorAt($x, $y);
                $alpha = (float) $color->alpha()->normalized();
                // الشفافية تُسطَّح على الأبيض كما يفعل ترميز JPEG لدينا.
                $r += (int) round((int) $color->channel(Red::class)->value() * $alpha + 255 * (1 - $alpha));
                $g += (int) round((int) $color->channel(Green::class)->value() * $alpha + 255 * (1 - $alpha));
                $b += (int) round((int) $color->channel(Blue::class)->value() * $alpha + 255 * (1 - $alpha));
                $count++;
            }
        }

        $r = intdiv($r, $count);
        $g = intdiv($g, $count);
        $b = intdiv($b, $count);

        return [
            (int) round(0.2126 * $r + 0.7152 * $g + 0.0722 * $b),
            sprintf('#%02x%02x%02x', $r, $g, $b),
        ];
    }
}
