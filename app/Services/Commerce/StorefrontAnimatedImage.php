<?php

namespace App\Services\Commerce;

/**
 * AWJ-ANIMATED-MEDIA P1 — فحص وتنقية وإطار-أول لصور GIF وWebP المتحركة (بايتات في الذاكرة، ≤ حدّ الرفع).
 *
 * **لماذا محلِّل بايتات لا مكتبة:** صورة الإنتاج مبنية على GD بلا Imagick ولا ffmpeg ولا AVIF
 * (`Dockerfile`)، وGD لا يفكّ WebP متحركاً ولا يكتب صوراً متحركة. فنقرأ **بنية الحاوية** نفسها
 * (كتل GIF / أجزاء RIFF) — خطيّ في الحجم، بلا فكّ بكسلات، بلا تبعية جديدة.
 *
 * ثلاث وظائف، كلها على البنية لا على الامتداد ولا نوع العميل:
 *  - {@see inspect()}  يتحقق أن الملف بنيةً سليمةٌ كاملة (تُرفض المبتورة/المشوَّهة) ويقيس الإطارات والمدة والحلقة والأبعاد.
 *  - {@see sanitize()} يعيد بناء الملف **بلا** تعليقات GIF وامتدادات التطبيق غير الحلقة وبلا EXIF/XMP لـWebP
 *    (الأصل المحفوظ يبقى كما رُفع ولا يُقدَّم للعموم؛ ما يُقدَّم هو النسخة المنقّاة).
 *  - {@see posterBytes()} يعيد صورةً ثابتة (الإطار الأول) يفكّها GD: GIF كما هو (GD يقرأ الإطار الأول)،
 *    وWebP بإعادة تغليف أجزاء بيانات الإطار الأول في ملف WebP ثابت. إطارٌ أول جزئي (لا يغطي اللوحة)
 *    لا يمكن تركيبه بلا فكٍّ كامل ⇒ `null` (يُرفض الرفع بدل نشر صورة بديلة خاطئة).
 *
 * الحدود (إطارات/مدة/أبعاد) تُفرض في {@see StorefrontMediaService}؛ هنا حدّ إطارات صلب فقط لتحصين المحلّل نفسه.
 */
final class StorefrontAnimatedImage
{
    public const FORMAT_GIF = 'gif';
    public const FORMAT_WEBP = 'webp';

    public const MIME = [
        self::FORMAT_GIF => 'image/gif',
        self::FORMAT_WEBP => 'image/webp',
    ];

    /** سقف صلب لمحلِّل البنية مهما كان الإعداد (تحصين ضد ملفات مصمَّمة). */
    private const HARD_FRAME_CEILING = 2000;

    /** مدة إطارٍ ≤ 10ms تُعرَض 100ms في المتصفحات؛ نحسبها كذلك (تقدير متحفّظ للمدة). */
    private const MIN_FRAME_MS = 10;

    public static function formatForMime(string $mime): ?string
    {
        return array_search($mime, self::MIME, true) ?: null;
    }

    public static function fileName(string $format): string
    {
        return 'animated.'.$format;
    }

    public static function isValidFileName(string $file): bool
    {
        return preg_match('/\Aanimated\.(?:gif|webp)\z/', $file) === 1;
    }

    /**
     * @return array{format:string, animated:bool, width:int, height:int, frames:int, duration_ms:int, loop:bool}
     *
     * @throws StorefrontMediaException image_unreadable
     */
    public function inspect(string $bytes, string $mime): array
    {
        return match ($mime) {
            self::MIME[self::FORMAT_GIF] => $this->gif($bytes)['meta'],
            self::MIME[self::FORMAT_WEBP] => $this->webp($bytes)['meta'],
            default => throw $this->unreadable(),
        };
    }

    /**
     * نسخة منقّاة للتقديم العام. تفترض أن {@see inspect()} نجح على البايتات نفسها.
     *
     * @throws StorefrontMediaException
     */
    public function sanitize(string $bytes, string $mime): string
    {
        return match ($mime) {
            self::MIME[self::FORMAT_GIF] => $this->gif($bytes)['clean'],
            self::MIME[self::FORMAT_WEBP] => $this->webp($bytes)['clean'],
            default => throw $this->unreadable(),
        };
    }

    /**
     * بايتات الإطار الأول كصورة ثابتة يفكّها GD، أو `null` إن تعذّر تركيبها بأمان.
     *
     * @throws StorefrontMediaException
     */
    public function posterBytes(string $bytes, string $mime): ?string
    {
        if ($mime === self::MIME[self::FORMAT_GIF]) {
            return $bytes; // GD يفكّ الإطار الأول من GIF متحرك.
        }
        if ($mime === self::MIME[self::FORMAT_WEBP]) {
            return $this->webp($bytes)['poster'];
        }

        throw $this->unreadable();
    }

    // ───────────────────────────── GIF ─────────────────────────────

    /**
     * @return array{meta:array{format:string,animated:bool,width:int,height:int,frames:int,duration_ms:int,loop:bool}, clean:string}
     */
    private function gif(string $b): array
    {
        $len = strlen($b);
        if ($len < 14 || ! in_array(substr($b, 0, 6), ['GIF87a', 'GIF89a'], true)) {
            throw $this->unreadable();
        }

        $w = $this->u16($b, 6);
        $h = $this->u16($b, 8);
        $packed = ord($b[10]);
        if ($w < 1 || $h < 1) {
            throw $this->unreadable();
        }
        $pos = 13;
        $head = substr($b, 0, 13);
        $head[4] = '9'; // 89a: الإطارات المتحركة تعتمد GCE
        if (($packed & 0x80) !== 0) {
            $size = 3 * (1 << (($packed & 7) + 1));
            if ($pos + $size > $len) {
                throw $this->unreadable();
            }
            $head .= substr($b, $pos, $size);
            $pos += $size;
        }

        $clean = $head;
        $frames = 0;
        $durationMs = 0;
        $loop = false;
        $pendingDelayMs = 0;
        $closed = false;

        while ($pos < $len) {
            $block = ord($b[$pos]);

            if ($block === 0x3B) { // trailer
                $closed = true;
                $pos++;
                break;
            }

            if ($block === 0x21) { // extension
                if ($pos + 2 > $len) {
                    throw $this->unreadable();
                }
                $label = ord($b[$pos + 1]);
                $start = $pos;
                if ($label === 0xF9) { // graphic control: [size=4][packed][delay u16][transp][0]
                    if ($pos + 8 > $len || ord($b[$pos + 2]) !== 4) {
                        throw $this->unreadable();
                    }
                    $delay = $this->u16($b, $pos + 4) * 10;
                    $pendingDelayMs = $delay <= self::MIN_FRAME_MS ? 100 : $delay;
                    $end = $pos + 8;
                    $clean .= substr($b, $start, $end - $start);
                    $pos = $end;

                    continue;
                }
                // الباقي: كتل فرعية.
                $pos += 2;
                $app = null;
                if ($label === 0xFF) {
                    if ($pos >= $len) {
                        throw $this->unreadable();
                    }
                    $size = ord($b[$pos]);
                    $app = substr($b, $pos + 1, $size);
                }
                $subStart = $pos;
                $pos = $this->skipSubBlocks($b, $pos, $len);
                if ($label === 0xFF && $app === 'NETSCAPE2.0') {
                    $sub = substr($b, $subStart, $pos - $subStart);
                    // [11]["NETSCAPE2.0"][3][1][loops u16][0]
                    if (strlen($sub) >= 17 && ord($sub[12]) === 3 && ord($sub[13]) === 1) {
                        $loop = ($this->u16($sub, 14) === 0);
                    }
                    $clean .= substr($b, $start, $pos - $start);
                }

                // التعليقات (0xFE) والنص العادي (0x01) وامتدادات التطبيق الأخرى (XMP…) تُسقَط.
                continue;
            }

            if ($block === 0x2C) { // image descriptor
                if ($pos + 10 > $len) {
                    throw $this->unreadable();
                }
                $left = $this->u16($b, $pos + 1);
                $top = $this->u16($b, $pos + 3);
                $fw = $this->u16($b, $pos + 5);
                $fh = $this->u16($b, $pos + 7);
                if ($fw < 1 || $fh < 1 || $left + $fw > $w || $top + $fh > $h) {
                    throw $this->unreadable();
                }
                $start = $pos;
                $local = ord($b[$pos + 9]);
                $pos += 10;
                if (($local & 0x80) !== 0) {
                    $pos += 3 * (1 << (($local & 7) + 1));
                }
                if ($pos + 1 > $len) {
                    throw $this->unreadable();
                }
                $pos++; // LZW minimum code size
                $pos = $this->skipSubBlocks($b, $pos, $len);

                $frames++;
                if ($frames > self::HARD_FRAME_CEILING) {
                    throw new StorefrontMediaException('animated_too_many_frames', 'عدد إطارات الصورة المتحركة يتجاوز الحد المسموح.');
                }
                $durationMs += $pendingDelayMs > 0 ? $pendingDelayMs : 100;
                $pendingDelayMs = 0;
                $clean .= substr($b, $start, $pos - $start);

                continue;
            }

            throw $this->unreadable(); // بايت كتلة غير معروف
        }

        if (! $closed || $frames < 1) {
            throw $this->unreadable(); // مبتور أو بلا صور
        }

        return [
            'meta' => [
                'format' => self::FORMAT_GIF,
                'animated' => $frames >= 2,
                'width' => $w,
                'height' => $h,
                'frames' => $frames,
                'duration_ms' => $durationMs,
                'loop' => $loop,
            ],
            'clean' => $clean."\x3B",
        ];
    }

    /** يتخطى سلسلة الكتل الفرعية حتى المنهي 0x00؛ يرمي إن بُترت. */
    private function skipSubBlocks(string $b, int $pos, int $len): int
    {
        while (true) {
            if ($pos >= $len) {
                throw $this->unreadable();
            }
            $size = ord($b[$pos]);
            $pos += 1 + $size;
            if ($size === 0) {
                return $pos;
            }
        }
    }

    // ───────────────────────────── WebP ─────────────────────────────

    /**
     * @return array{
     *   meta:array{format:string,animated:bool,width:int,height:int,frames:int,duration_ms:int,loop:bool},
     *   clean:string, poster:?string
     * }
     */
    private function webp(string $b): array
    {
        $len = strlen($b);
        if ($len < 20 || substr($b, 0, 4) !== 'RIFF' || substr($b, 8, 4) !== 'WEBP') {
            throw $this->unreadable();
        }
        $riffEnd = $this->u32($b, 4) + 8;
        if ($riffEnd > $len || $riffEnd < 20) {
            throw $this->unreadable(); // مبتور
        }

        $chunks = $this->riffChunks($b, 12, $riffEnd);
        $first = $chunks[0] ?? null;

        // ثابت (VP8 / VP8L بلا VP8X): ليس متحركاً؛ الأبعاد يقرأها GD.
        if ($first !== null && $first['id'] !== 'VP8X') {
            return [
                'meta' => ['format' => self::FORMAT_WEBP, 'animated' => false, 'width' => 0, 'height' => 0, 'frames' => 1, 'duration_ms' => 0, 'loop' => false],
                'clean' => $b,
                'poster' => $b,
            ];
        }
        if ($first === null || $first['size'] !== 10) {
            throw $this->unreadable();
        }

        $flags = ord($b[$first['data']]);
        $cw = $this->u24($b, $first['data'] + 4) + 1;
        $ch = $this->u24($b, $first['data'] + 7) + 1;

        $isAnimated = ($flags & 0x02) !== 0;
        if (! $isAnimated) {
            return [
                'meta' => ['format' => self::FORMAT_WEBP, 'animated' => false, 'width' => $cw, 'height' => $ch, 'frames' => 1, 'duration_ms' => 0, 'loop' => false],
                'clean' => $b,
                'poster' => $b,
            ];
        }

        $anim = null;
        $icc = null;
        $frames = [];
        $duration = 0;
        $poster = null;
        foreach (array_slice($chunks, 1) as $c) {
            if ($c['id'] === 'ANIM') {
                if ($c['size'] < 6 || $anim !== null) {
                    throw $this->unreadable();
                }
                $anim = ['loops' => $this->u16($b, $c['data'] + 4)];
            } elseif ($c['id'] === 'ICCP') {
                $icc = substr($b, $c['hdr'], 8 + $c['size'] + ($c['size'] & 1));
            } elseif ($c['id'] === 'ANMF') {
                if ($anim === null || $c['size'] < 16 + 8) {
                    throw $this->unreadable();
                }
                $fx = $this->u24($b, $c['data']) * 2;
                $fy = $this->u24($b, $c['data'] + 3) * 2;
                $fw = $this->u24($b, $c['data'] + 6) + 1;
                $fh = $this->u24($b, $c['data'] + 9) + 1;
                $ms = $this->u24($b, $c['data'] + 12);
                if ($fx + $fw > $cw || $fy + $fh > $ch) {
                    throw $this->unreadable();
                }
                $inner = $this->riffChunks($b, $c['data'] + 16, $c['data'] + $c['size']);
                $bitstream = array_values(array_filter($inner, static fn (array $i): bool => in_array($i['id'], ['VP8 ', 'VP8L'], true)));
                if (count($bitstream) !== 1) {
                    throw $this->unreadable();
                }
                $frames[] = substr($b, $c['hdr'], 8 + $c['size'] + ($c['size'] & 1));
                if (count($frames) > self::HARD_FRAME_CEILING) {
                    throw new StorefrontMediaException('animated_too_many_frames', 'عدد إطارات الصورة المتحركة يتجاوز الحد المسموح.');
                }
                $duration += $ms <= self::MIN_FRAME_MS ? 100 : $ms;

                if (count($frames) === 1 && $fx === 0 && $fy === 0 && $fw === $cw && $fh === $ch) {
                    $poster = $this->stillWebp($b, $inner, $cw, $ch, $flags);
                }
            }
            // EXIF / XMP / مجهول: يُسقَط من النسخة المنقّاة.
        }

        if ($anim === null || $frames === []) {
            throw $this->unreadable();
        }

        // VP8X: نُبقي الحركة والألفا وICC ونمسح EXIF/XMP.
        $vp8x = chr($flags & ~0x0C).substr($b, $first['data'] + 1, 9);
        $body = 'WEBP'.$this->chunk('VP8X', $vp8x).($icc ?? '');
        $body .= $this->chunk('ANIM', $this->animBody($b, $chunks));
        $body .= implode('', $frames);
        $clean = 'RIFF'.pack('V', strlen($body)).$body;

        return [
            'meta' => [
                'format' => self::FORMAT_WEBP,
                'animated' => true, // علم الحركة مرفوع: الخدمة ترفض الإطار الواحد صراحةً
                'width' => $cw,
                'height' => $ch,
                'frames' => count($frames),
                'duration_ms' => $duration,
                'loop' => $anim['loops'] === 0,
            ],
            'clean' => $clean,
            'poster' => $poster,
        ];
    }

    /** @param list<array{id:string,size:int,hdr:int,data:int}> $chunks */
    private function animBody(string $b, array $chunks): string
    {
        foreach ($chunks as $c) {
            if ($c['id'] === 'ANIM') {
                return substr($b, $c['data'], $c['size']);
            }
        }

        throw $this->unreadable();
    }

    /**
     * يعيد تغليف بيانات الإطار الأول (ALPH؟ + VP8/VP8L) كملف WebP ثابت VP8X.
     *
     * @param  list<array{id:string,size:int,hdr:int,data:int}>  $inner
     */
    private function stillWebp(string $b, array $inner, int $cw, int $ch, int $canvasFlags): string
    {
        $parts = '';
        $alpha = false;
        foreach ($inner as $i) {
            if (in_array($i['id'], ['ALPH', 'VP8 ', 'VP8L'], true)) {
                $parts .= substr($b, $i['hdr'], 8 + $i['size'] + ($i['size'] & 1));
                $alpha = $alpha || $i['id'] === 'ALPH' || $i['id'] === 'VP8L';
            }
        }
        $flags = $alpha ? 0x10 : 0x00;
        $dims = substr(pack('V', $cw - 1), 0, 3).substr(pack('V', $ch - 1), 0, 3);
        $body = 'WEBP'.$this->chunk('VP8X', chr($flags)."\0\0\0".$dims).$parts;

        return 'RIFF'.pack('V', strlen($body)).$body;
    }

    /**
     * أجزاء RIFF ضمن [$from, $to) — يرمي إن تجاوز جزءٌ نهايته.
     *
     * @return list<array{id:string,size:int,hdr:int,data:int}>
     */
    private function riffChunks(string $b, int $from, int $to): array
    {
        $out = [];
        $pos = $from;
        while ($pos < $to) {
            if ($pos + 8 > $to) {
                throw $this->unreadable();
            }
            $size = $this->u32($b, $pos + 4);
            $end = $pos + 8 + $size + ($size & 1);
            if ($end > $to) {
                throw $this->unreadable();
            }
            $out[] = ['id' => substr($b, $pos, 4), 'size' => $size, 'hdr' => $pos, 'data' => $pos + 8];
            $pos = $end;
            if (count($out) > self::HARD_FRAME_CEILING * 4) {
                throw $this->unreadable();
            }
        }

        return $out;
    }

    private function chunk(string $id, string $data): string
    {
        return $id.pack('V', strlen($data)).$data.(strlen($data) & 1 ? "\0" : '');
    }

    // ───────────────────────────── helpers ─────────────────────────────

    private function u16(string $b, int $o): int
    {
        return ord($b[$o]) | (ord($b[$o + 1]) << 8);
    }

    private function u24(string $b, int $o): int
    {
        return ord($b[$o]) | (ord($b[$o + 1]) << 8) | (ord($b[$o + 2]) << 16);
    }

    private function u32(string $b, int $o): int
    {
        return (int) unpack('V', substr($b, $o, 4))[1];
    }

    private function unreadable(): StorefrontMediaException
    {
        return new StorefrontMediaException('image_unreadable', 'الصورة المتحركة تالفة أو غير مكتملة. أعد تصديرها ثم ارفعها.');
    }
}
