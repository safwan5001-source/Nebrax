<?php

namespace Tests\Feature;

/**
 * AWJ-ANIMATED-MEDIA P1 — صور متحركة حقيقية صغيرة (مضمَّنة base64 كي لا يحتاج مجمِّع CI نسخ ملفات ثنائية):
 * GIF و WebP بثلاثة إطارات ملوّنة 400×400 (أحمر ← أزرق ← أخضر)، ومعدِّلات بنيوية للحالات السلبية.
 */
trait AnimatedMediaFixtures
{
    private const FIXTURE_GIF_B64 = 'R0lGODlhkAGQAfAAAP8AAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACH/C0ltYWdlTWFnaWNrDmdhbW1hPTAuNDU0NTQ1ACwAAAAAkAGQAQAC/4SPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kzX9o3n+s73/g8MCofEovGITCqXzKbzCY1Kp9Sq9YrNarfcrvcLDovH5LL5jE6r1+y2+w2Py+f0uv2Oz+v3/L7/DxgoOEhYaHiImKi4yNjo+AgZKTlJWWl5iZmpucnZ6fkJGio6SlpqeoqaqrrK2ur6ChsrO0tba3uLm6u7y9vr+wscLDxMXGx8jJysvMzc7PwMHS09TV1tfY2drb3N3e39DR4uPk5ebn6Onq6+zt7u/g4fLz9PX29/j5+vv8/f7/8PMKDAgQQLGjyIMKHChQwbOnwIMaLEiRQrWryIMaPGjf8cO3r8CDKkyJEkS5o8iTKlypUsW7p8CTOmzJk0a9q8iTOnzp08e/r8CTSo0KFEixo9ijSp0qVMmzp9CjWq1KlUq1q9ijWr1q1cu3r9Cjas2LFky5o9izat2rVs27p9Czeu3Ll069q9izev3r18+/r9Cziw4MGECxs+jDix4sWMGzt+DDmy5MmUK1u+jDmz5s2cO3v+DDq06NGkS5s+jTq16tWsW7t+DTu27Nm0a9u+jTu37t28e/v+DTy48OHEixs/jjy58uXMmzt/Dj269OnUq1u/jj279u3cu3v/Dj68+PHky5s/jz69+vXs27t/Dz++/Pn069u/jz+//v38+/tN/w9ggAIOSGCBBh6IYIIKLshggw4+CGGEEk5IYYUWXohhhhpuyGGHHn4IYogijkhiiSaeiGKKKq7IYosuvghjjDLOSGONNt6IY45tFAAAIfkEABQAAAAh/wtJbWFnZU1hZ2ljaw5nYW1tYT0wLjQ1NDU0NQAsAAAAAJABkAGAAAD/////Av+Ej6nL7Q+jnLTai7PevPsPhuJIluaJpurKtu4Lx/JM1/aN5/rO9/4PDAqHxKLxiEwql8ym8wmNSqfUqvWKzWq33K73Cw6Lx+Sy+YxOq9fstvsNj8vn9Lr9js/r9/y+/w8YKDhIWGh4iJiouMjY6PgIGSk5SVlpeYmZqbnJ2en5CRoqOkpaanqKmqq6ytrq+gobKztLW2t7i5uru8vb6/sLHCw8TFxsfIycrLzM3Oz8DB0tPU1dbX2Nna29zd3t/Q0eLj5OXm5+jp6uvs7e7v4OHy8/T19vf4+fr7/P3+//DzCgwIEECxo8iDChwoUMGzp8CDGixIkUK1q8iDGjxo3/HDt6/AgypMiRJEuaPIkypcqVLFu6fAkzpsyZNGvavIkzp86dPHv6/Ak0qNChRIsaPYo0qdKlTJs6fQo1qtSpVKtavYo1q9atXLt6/Qo2rNixZMuaPYs2rdq1bNu6fQs3rty5dOvavYs3r969fPv6/Qs4sODBhAsbPow4seLFjBs7fgw5suTJlCtbvow5s+bNnDt7/gw6tOjRpEubPo06terVrFu7fg07tuzZtGvbvo07t+7dvHv7/g08uPDhxIsbP448ufLlzJs7fw49uvTp1Ktbv449u/bt3Lt7/w4+vPjx5MubP48+vfr17Nu7fw8/vvz59Ovbv48/v/79/Pv7Tf8PYIACDkhggQYeiGCCCi7IYIMOPghhhBJOSGGFFl6IYYYabshhhx5+CGKIIo5IYokmnohiiiquyGKLLr4IY4wyzkhjjTbeiGOObRQAACH5BAAUAAAAIf8LSW1hZ2VNYWdpY2sOZ2FtbWE9MC40NTQ1NDUALAAAAACQAZABgAD/AP///wL/hI+py+0Po5y02ouz3rz7D4biSJbmiabqyrbuC8fyTNf2jef6zvf+DwwKh8Si8YhMKpfMpvMJjUqn1Kr1is1qt9yu9wsOi8fksvmMTqvX7Lb7DY/L5/S6/Y7P6/f8vv8PGCg4SFhoeIiYqLjI2Oj4CBkpOUlZaXmJmam5ydnp+QkaKjpKWmp6ipqqusra6voKGys7S1tre4ubq7vL2+v7CxwsPExcbHyMnKy8zNzs/AwdLT1NXW19jZ2tvc3d7f0NHi4+Tl5ufo6err7O3u7+Dh8vP09fb3+Pn6+/z9/v/w8woMCBBAsaPIgwocKFDBs6fAgxosSJFCtavIgxo8aN/xw7evwIMqTIkSRLmjyJMqXKlSxbunwJM6bMmTRr2ryJM6fOnTx7+vwJNKjQoUSLGj2KNKnSpUybOn0KNarUqVSrWr2KNavWrVy7ev0KNqzYsWTLmj2LNq3atWzbun0LN67cuXTr2r2LN6/evXz7+v0LOLDgwYQLGz6MOLHixYwbO34MObLkyZQrW76MObPmzZw7e/4MOrTo0aRLmz6NOrXq1axbu34NO7bs2bRr276NO7fu3bx7+/4NPLjw4cSLGz+OPLny5cybO38OPbr06dSrW7+OPbv27dy7e/8OPrz48eTLmz+PPr369ezbu38PP778+fTr27+PP7/+/fz7+03/D2CAAg5IYIEGHohgggouyGCDDj4IYYQSTkhhhRZeiGGGGm7IYYcefghiiCKOSGKJJp6IYooqrshiiy6+CGOMMs5IY4023ohjjm0UAAA7';

    private const FIXTURE_WEBP_B64 = 'UklGRtgAAABXRUJQVlA4WAoAAAACAAAAjwEAjwEAQU5JTQYAAAD/////AABBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAAJWUDhMGwAAAC+PwWMABxD9j/4HABTp/3+K6H/qf//73/8iAgBBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAABWUDhMGwAAAC+PwWMABxDR//4HABTp/3+K6H/qf//73/8iAgBBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAABWUDhMGwAAAC+PwWMAB9D/iP4HABTp/3+K6H/qf//73/8iAgA=';

    // ── Security PoCs (S0 fuzz + differential review; originals in docs/plans/store/s0-spikes/security/poc/) ──
    // F2: GIF `21 FF 00 …` hides a 3rd frame from inspect() but not from giflib/Pillow/gifsicle.
    private const POC_GIF_EXT_FF_ZERO_B64 = 'R0lGODlhQAAwAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAQAAwAAACOYSPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kzX9o3n+s73/g8MCofEovGITCqXzKbzCY0mCwAh+QQACgAAACwAAAAAQAAwAIAAAP8AAAACOYSPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kzX9o3n+s73/g8MCofEovGITCqXzKbzCY0mCwAh/wA7RkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkYAIfkEAAoAAAAsAAAAAEAAMACAAIAAAAAAAjmEj6nL7Q+jnLTai7PevPsPhuJIluaJpurKtu4Lx/JM1/aN5/rO9/4PDAqHxKLxiEwql8ym8wmNJgsAOw==';

    // F1: WebP ANMF carrying three nested ANMF — inspect() counts 2 frames, libwebp/Chromium/Pillow play 5.
    private const POC_WEBP_NESTED_ANMF_B64 = 'UklGRlABAABXRUJQVlA4WAoAAAACAAAAjwEAjwEAQU5JTQYAAAD/////AABBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAAJWUDhMGwAAAC+PwWMABxD9j/4HABTp/3+K6H/qf//73/8iAgBBTk1G6AAAAAAAAAAAAI8BAI8BAMgAAAJWUDhMGwAAAC+PwWMABxD9j/4HABTp/3+K6H/qf//73/8iAgBBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAAJWUDhMGwAAAC+PwWMABxD9j/4HABTp/3+K6H/qf//73/8iAgBBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAAJWUDhMGwAAAC+PwWMABxD9j/4HABTp/3+K6H/qf//73/8iAgBBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAAJWUDhMGwAAAC+PwWMABxD9j/4HABTp/3+K6H/qf//73/8iAgA=';

    // F4: GIF with LZW minimum code size 0xFF — passes the dimension check, GD cannot decode the poster.
    private const POC_GIF_LZW_SIZE_B64 = 'R0lGODlhQAAwAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACH/C0ltYWdlTWFnaWNrDmdhbW1hPTAuNDU0NTQ1ACwAAAAAQAAwAAD/OYSPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kzX9o3n+s73/g8MCofEovGITCqXzKbzCY0mCwAh+QQACgAAACH/C0ltYWdlTWFnaWNrDmdhbW1hPTAuNDU0NTQ1ACwAAAAAQAAwAIAAAP8AAAACOYSPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kzX9o3n+s73/g8MCofEovGITCqXzKbzCY0mCwAh+QQACgAAACH/C0ltYWdlTWFnaWNrDmdhbW1hPTAuNDU0NTQ1ACwAAAAAQAAwAIAAgAAAAAACOYSPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kzX9o3n+s73/g8MCofEovGITCqXzKbzCY0mCwA7';

    // F4/F5: WebP whose VP8L bitstream header disagrees with its ANMF/canvas dimensions.
    private const POC_WEBP_DIMS_MISMATCH_B64 = 'UklGRtgAAABXRUJQVlA4WAoAAAACAAAAkAEAjwEAQU5JTQYAAAD/////AABBTk1GNAAAAAAAAAAAAJABAI8BAMgAAAJWUDhMGwAAAC+PwWMABxD9j/4HABTp/3+K6H/qf//73/8iAgBBTk1GNAAAAAAAAAAAAJABAI8BAMgAAABWUDhMGwAAAC+PwWMABxDR//4HABTp/3+K6H/qf//73/8iAgBBTk1GNAAAAAAAAAAAAJABAI8BAMgAAABWUDhMGwAAAC+PwWMAB9D/iP4HABTp/3+K6H/qf//73/8iAgA=';

    // F5: VP8L header claims 16383×16383 inside a 400×400 frame.
    private const POC_WEBP_VP8L_HDR_B64 = 'UklGRtgAAABXRUJQVlA4WAoAAAACAAAAjwEAjwEAQU5JTQYAAAD/////AABBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAAJWUDhMGwAAAC////8PBxD9j/4HABTp/3+K6H/qf//73/8iAgBBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAABWUDhMGwAAAC////8PBxDR//4HABTp/3+K6H/qf//73/8iAgBBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAABWUDhMGwAAAC////8PB9D/iP4HABTp/3+K6H/qf//73/8iAgA=';

    protected function animatedGifBytes(): string
    {
        return (string) base64_decode(self::FIXTURE_GIF_B64, true);
    }

    protected function animatedWebpBytes(): string
    {
        return (string) base64_decode(self::FIXTURE_WEBP_B64, true);
    }

    /** يحقن تعليق GIF (0xFE) وامتداد تطبيق XMP قبل أول إطار — مواد وصفية يجب أن تسقط في النسخة المنقّاة. */
    protected function gifWithMetadata(): string
    {
        $b = $this->animatedGifBytes();
        $comment = "\x21\xFE\x0Bsecret-note\x00";
        $xmp = "\x21\xFF\x0BXMP DataXMP\x03abc\x00";
        $pos = strpos($b, "\x21\xF9"); // أول GCE
        $this->assertNotFalse($pos);

        return substr($b, 0, $pos).$comment.$xmp.substr($b, $pos);
    }

    /** يكرّر الإطار الأول $n مرة (بنية سليمة) — لاختبار حدود الإطارات والمدة. */
    protected function gifWithFrames(int $n, int $delayCs = 5): string
    {
        $b = $this->animatedGifBytes();
        $first = strpos($b, "\x21\xF9");
        $end = strrpos($b, "\x3B");
        $secondGce = strpos($b, "\x21\xF9", $first + 2);
        $frame = substr($b, $first, $secondGce - $first);
        $frame = substr($frame, 0, 4).pack('v', $delayCs).substr($frame, 6);

        return substr($b, 0, $first).str_repeat($frame, $n).substr($b, $end);
    }

    /** يضيف جزء EXIF وXMP إلى WebP المتحرك ويرفع أعلامها في VP8X. */
    protected function webpWithMetadata(): string
    {
        $b = $this->animatedWebpBytes();
        $exif = 'EXIF'.pack('V', 6).'secret';
        $xmp = 'XMP '.pack('V', 4).'<x/>';
        $body = substr($b, 8).$exif.$xmp;
        $body[12] = chr(ord($body[12]) | 0x0C); // رايات EXIF|XMP في VP8X

        return 'RIFF'.pack('V', strlen($body)).$body;
    }

    /** يضيّق الإطار الأول (يُعلن 100×100 ضمن لوحة 400×400): الإطار الأول لا يغطي اللوحة. */
    protected function webpWithPartialFirstFrame(): string
    {
        $b = $this->animatedWebpBytes();
        $pos = strpos($b, 'ANMF');
        $this->assertNotFalse($pos);
        $o = $pos + 8 + 6; // بعد X,Y
        $w = substr(pack('V', 99), 0, 3);
        $h = substr(pack('V', 99), 0, 3);
        $b = substr($b, 0, $o).$w.$h.substr($b, $o + 6);

        // the VP8L header must agree with the declared frame size (F5), so declare 100×100 there too
        $vp8l = strpos($b, 'VP8L', $pos);
        $this->assertNotFalse($vp8l);
        $bits = unpack('V', substr($b, $vp8l + 9, 4))[1];
        $bits = ($bits & ~0xFFFFFFF) | 99 | (99 << 14);

        return substr($b, 0, $vp8l + 9).pack('V', $bits).substr($b, $vp8l + 13);
    }

    /** الإطار الأول 100×100 عند (50,50) داخل لوحة 400×400: GD سيفكّه بحجم الإطار لا اللوحة. */
    protected function gifWithPartialFirstFrame(): string
    {
        $b = $this->animatedGifBytes();
        $gce = strpos($b, "\x21\xF9");
        $img = strpos($b, "\x2C", $gce);
        $this->assertNotFalse($img);

        return substr($b, 0, $img + 1).pack('v4', 50, 50, 100, 100).substr($b, $img + 9);
    }

    /** خاتمة GCE ≠ 0x00: مفكّكٌ آخر يقرؤها طول كتلة فرعية (اختلاف تفسير). */
    protected function gifWithBadGceTerminator(): string
    {
        $b = $this->animatedGifBytes();
        $gce = strpos($b, "\x21\xF9");
        $b[$gce + 7] = "\x05";

        return $b;
    }

    /** كتلة فرعية إضافية داخل امتداد NETSCAPE تحمل بايتات اعتباطية. */
    protected function gifWithNetscapeExtraData(): string
    {
        $b = $this->animatedGifBytes();
        $needle = "NETSCAPE2.0\x03\x01\x00\x00\x00";
        $this->assertNotFalse(strpos($b, $needle));

        return str_replace($needle, "NETSCAPE2.0\x03\x01\x00\x00\x0Csecret-gps-1\x00", $b);
    }

    /** يضيف جزءاً غير معروف (XMP) داخل ANMF الأول ويصحّح الأحجام. */
    protected function webpWithInnerMetadata(): string
    {
        $b = $this->animatedWebpBytes();
        $pos = strpos($b, 'ANMF');
        $size = unpack('V', substr($b, $pos + 4, 4))[1];
        $this->assertSame(0, $size % 2);
        $extra = 'XMP '.pack('V', 8).'LEAKLEAK';
        $b = substr($b, 0, $pos + 4).pack('V', $size + strlen($extra)).substr($b, $pos + 8, $size).$extra.substr($b, $pos + 8 + $size);

        return 'RIFF'.pack('V', strlen($b) - 8).substr($b, 8);
    }

    /** ANIM أكبر من 6 بايت بذيلٍ اعتباطي. */
    protected function webpWithOversizeAnim(): string
    {
        $b = $this->animatedWebpBytes();
        $pos = strpos($b, 'ANIM');
        $this->assertSame(6, unpack('V', substr($b, $pos + 4, 4))[1]);
        $b = substr($b, 0, $pos + 4).pack('V', 12).substr($b, $pos + 8, 6).'META!!'.substr($b, $pos + 14);

        return 'RIFF'.pack('V', strlen($b) - 8).substr($b, 8);
    }

    /** جزء JUNK أولاً بدل VP8X/VP8/VP8L. */
    protected function webpJunkFirst(): string
    {
        $b = $this->animatedWebpBytes();
        $body = 'WEBP'.'JUNK'.pack('V', 4).'abcd'.substr($b, 12);

        return 'RIFF'.pack('V', strlen($body)).$body;
    }
    protected function pocGifExtFfZero(): string
    {
        return (string) base64_decode(self::POC_GIF_EXT_FF_ZERO_B64, true);
    }

    protected function pocWebpNestedAnmf(): string
    {
        return (string) base64_decode(self::POC_WEBP_NESTED_ANMF_B64, true);
    }

    protected function pocGifLzwSize(): string
    {
        return (string) base64_decode(self::POC_GIF_LZW_SIZE_B64, true);
    }

    protected function pocWebpDimsMismatch(): string
    {
        return (string) base64_decode(self::POC_WEBP_DIMS_MISMATCH_B64, true);
    }

    protected function pocWebpVp8lHeader(): string
    {
        return (string) base64_decode(self::POC_WEBP_VP8L_HDR_B64, true);
    }

    /**
     * يعيد كتابة أبناء ANMF الأول (بعد ترويسته 16 بايت) عبر $edit(string $children): string ويصحّح الأحجام.
     */
    protected function webpWithFirstFrameChildren(\Closure $edit): string
    {
        $b = $this->animatedWebpBytes();
        $pos = strpos($b, 'ANMF');
        $this->assertNotFalse($pos);
        $size = unpack('V', substr($b, $pos + 4, 4))[1];
        $payload = substr($b, $pos + 8, $size);
        $new = substr($payload, 0, 16).$edit(substr($payload, 16));
        if (strlen($new) & 1) {
            $new .= "\0";
        }
        $b = substr($b, 0, $pos + 4).pack('V', strlen($new)).$new.substr($b, $pos + 8 + $size);

        return 'RIFF'.pack('V', strlen($b) - 8).substr($b, 8);
    }

    protected static function riffChunk(string $id, string $data): string
    {
        return $id.pack('V', strlen($data)).$data.(strlen($data) & 1 ? "\0" : '');
    }

    /** ANMF الأول يحمل جزءاً غير معروف/ANMF متداخلاً بعد بيانات الصورة. */
    protected function webpWithTrailingChunkInFirstFrame(string $id = 'ANMF'): string
    {
        return $this->webpWithFirstFrameChildren(fn (string $kids): string => $kids.self::riffChunk($id, str_repeat("\0", 16)));
    }

    /** ALPH أمام VP8L (تركيبة يرفضها libwebp). */
    protected function webpWithAlphBeforeVp8l(): string
    {
        return $this->webpWithFirstFrameChildren(fn (string $kids): string => self::riffChunk('ALPH', "\0\0\0\0").$kids);
    }

    /** تيارا بيانات في إطار واحد. */
    protected function webpWithTwoBitstreamsInFirstFrame(): string
    {
        return $this->webpWithFirstFrameChildren(fn (string $kids): string => $kids.$kids);
    }

    /** ترويسة VP8L تعلن أبعاداً غير أبعاد الإطار. */
    protected function webpWithVp8lHeaderOfAnotherSize(): string
    {
        return $this->webpWithFirstFrameChildren(function (string $kids): string {
            $this->assertSame('VP8L', substr($kids, 0, 4));
            $this->assertSame(0x2F, ord($kids[8]));
            $bits = unpack('V', substr($kids, 9, 4))[1];
            $bits = ($bits & ~0x3FFF) | 199; // العرض 200 بدل 400

            return substr($kids, 0, 9).pack('V', $bits).substr($kids, 13);
        });
    }

    /** GIF: امتداد نص عادي (0x01) بطول كتلة أولى ≠ 12. */
    protected function gifWithPlainTextExtensionOfWrongSize(): string
    {
        $b = $this->animatedGifBytes();
        $gce = strpos($b, "\x21\xF9");

        return substr($b, 0, $gce)."\x21\x01\x05abcde\x00".substr($b, $gce);
    }

    /** GIF: امتدادات تطبيق بحجم كتلة أولى غير 11. */
    protected function gifWithApplicationExtensionOfWrongSize(int $size): string
    {
        $b = $this->animatedGifBytes();
        $gce = strpos($b, "\x21\xF9");

        return substr($b, 0, $gce)."\x21\xFF".chr($size).str_repeat('A', $size)."\x00".substr($b, $gce);
    }

    /** GIF: حجم رمز LZW الأدنى للإطار الأول. */
    protected function gifWithLzwMinimumCodeSize(int $size): string
    {
        $b = $this->animatedGifBytes();
        $img = strpos($b, "\x2C", strpos($b, "\x21\xF9"));
        $local = ord($b[$img + 9]);
        $off = $img + 10 + (($local & 0x80) ? 3 * (1 << (($local & 7) + 1)) : 0);
        $b[$off] = chr($size);

        return $b;
    }
}
