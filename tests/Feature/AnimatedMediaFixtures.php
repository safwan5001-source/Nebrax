<?php

namespace Tests\Feature;

/**
 * AWJ-ANIMATED-MEDIA P1 — صور متحركة حقيقية صغيرة (مضمَّنة base64 كي لا يحتاج مجمِّع CI نسخ ملفات ثنائية):
 * GIF و WebP بثلاثة إطارات ملوّنة 400×400 (أحمر ← أزرق ← أخضر)، ومعدِّلات بنيوية للحالات السلبية.
 */
trait AnimatedMediaFixtures
{
    private const FIXTURE_GIF_B64 = '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';

    private const FIXTURE_WEBP_B64 = 'UklGRtgAAABXRUJQVlA4WAoAAAACAAAAjwEAjwEAQU5JTQYAAAD/////AABBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAAJWUDhMGwAAAC+PwWMABxD9j/4HABTp/3+K6H/qf//73/8iAgBBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAABWUDhMGwAAAC+PwWMABxDR//4HABTp/3+K6H/qf//73/8iAgBBTk1GNAAAAAAAAAAAAI8BAI8BAMgAAABWUDhMGwAAAC+PwWMAB9D/iP4HABTp/3+K6H/qf//73/8iAgA=';

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

        return substr($b, 0, $o).$w.$h.substr($b, $o + 6);
    }
}
