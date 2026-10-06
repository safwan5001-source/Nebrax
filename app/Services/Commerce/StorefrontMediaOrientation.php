<?php

namespace App\Services\Commerce;

/**
 * CUST-HV V2a — قراءة اتجاه EXIF من ملف JPEG **قراءةً فقط**، بلا امتداد `exif`.
 *
 * السبب (N-1، مُثبَت في الكود): تعتمد `orient()` في Intervention Image على
 * `exif_read_data()`؛ فإن غاب امتداد `exif` عادت مجموعة فارغة ولم يُطبَّق أي
 * تدوير — بصمت. صورة الإنتاج (`Dockerfile`) وCI لا يحملان `exif`، وصور الهاتف
 * (الأكثر شيوعاً بين التجّار) تحمل غالباً الاتجاه 6/8. فبدون هذا القارئ كانت
 * متغيّرات الوسائط تُنتَج مقلوبةً جانباً دون أي خطأ.
 *
 * يفحص مقاطع JPEG حتى أول APP1 «Exif» ويقرأ وسم الاتجاه (0x0112) من IFD0 فقط.
 * كل حدٍّ يُتحقَّق منه؛ أي شذوذ ⇒ 1 (بلا تدوير). لا كتابة ولا تعديل لأي بايت.
 */
final class StorefrontMediaOrientation
{
    private const MAX_SCAN_BYTES = 262144;

    /** @return int 1..8 (1 = بلا تدوير أو غير معروف) */
    public static function read(string $path): int
    {
        $handle = @fopen($path, 'rb');
        if ($handle === false) {
            return 1;
        }

        try {
            $head = (string) fread($handle, self::MAX_SCAN_BYTES);
        } finally {
            fclose($handle);
        }

        return self::fromBytes($head);
    }

    public static function fromBytes(string $bytes): int
    {
        $length = strlen($bytes);
        if ($length < 4 || substr($bytes, 0, 2) !== "\xFF\xD8") {
            return 1;
        }

        $offset = 2;
        while ($offset + 4 <= $length) {
            if ($bytes[$offset] !== "\xFF") {
                return 1;
            }
            $marker = ord($bytes[$offset + 1]);
            if ($marker === 0xFF) { // حشو
                $offset++;

                continue;
            }
            // SOS/EOI: انتهت المقاطع الوصفية.
            if ($marker === 0xDA || $marker === 0xD9) {
                return 1;
            }
            $segmentLength = (ord($bytes[$offset + 2]) << 8) | ord($bytes[$offset + 3]);
            if ($segmentLength < 2) {
                return 1;
            }
            if ($marker === 0xE1 && substr($bytes, $offset + 4, 6) === "Exif\0\0") {
                $tiff = substr($bytes, $offset + 10, $segmentLength - 8);

                return self::fromTiff($tiff);
            }
            $offset += 2 + $segmentLength;
        }

        return 1;
    }

    private static function fromTiff(string $tiff): int
    {
        $length = strlen($tiff);
        if ($length < 14) {
            return 1;
        }

        $little = match (substr($tiff, 0, 2)) {
            'II' => true,
            'MM' => false,
            default => null,
        };
        if ($little === null) {
            return 1;
        }

        $u16 = static fn (int $at): int => $little
            ? (ord($tiff[$at]) | (ord($tiff[$at + 1]) << 8))
            : ((ord($tiff[$at]) << 8) | ord($tiff[$at + 1]));
        $u32 = static fn (int $at): int => $little
            ? (ord($tiff[$at]) | (ord($tiff[$at + 1]) << 8) | (ord($tiff[$at + 2]) << 16) | (ord($tiff[$at + 3]) << 24))
            : ((ord($tiff[$at]) << 24) | (ord($tiff[$at + 1]) << 16) | (ord($tiff[$at + 2]) << 8) | ord($tiff[$at + 3]));

        if ($u16(2) !== 42) {
            return 1;
        }
        $ifd = $u32(4);
        if ($ifd < 8 || $ifd + 2 > $length) {
            return 1;
        }

        $entries = $u16($ifd);
        for ($i = 0; $i < $entries; $i++) {
            $entry = $ifd + 2 + $i * 12;
            if ($entry + 12 > $length) {
                return 1;
            }
            if ($u16($entry) === 0x0112) {
                $type = $u16($entry + 2);
                $count = $u32($entry + 4);
                if ($type !== 3 || $count !== 1) { // SHORT × 1
                    return 1;
                }
                $value = $u16($entry + 8);

                return ($value >= 1 && $value <= 8) ? $value : 1;
            }
        }

        return 1;
    }
}
