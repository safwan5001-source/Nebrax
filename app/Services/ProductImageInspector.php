<?php

namespace App\Services;

use App\Support\InspectedProductImage;
use Illuminate\Http\UploadedFile;
use RuntimeException;

final class ProductImageInspector
{
    public const MAX_BYTES = 5 * 1024 * 1024;
    public const MAX_PIXELS = 40_000_000;

    private const MIME_EXTENSIONS = [
        'image/jpeg' => ['jpg', 'jpeg'],
        'image/png' => ['png'],
        'image/webp' => ['webp'],
    ];

    public function inspect(UploadedFile $file): InspectedProductImage
    {
        $path = $file->getRealPath();
        if ($path === false || ! is_file($path) || ! is_readable($path)) {
            throw new RuntimeException('ملف الصورة غير متاح للفحص.');
        }
        $size = filesize($path);
        if (! is_int($size) || $size < 1 || $size > self::MAX_BYTES) {
            throw new RuntimeException('حجم الصورة يجب أن يكون بين 1 بايت و5 ميغابايت.');
        }

        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = (string) $finfo->file($path);
        if (! isset(self::MIME_EXTENSIONS[$mime])) {
            throw new RuntimeException('محتوى الصورة غير مدعوم؛ المسموح JPEG وPNG وWebP فقط.');
        }
        $extension = strtolower((string) $file->getClientOriginalExtension());
        if (! in_array($extension, self::MIME_EXTENSIONS[$mime], true)) {
            throw new RuntimeException('امتداد الصورة لا يطابق محتواها الفعلي.');
        }

        $dimensions = @getimagesize($path);
        if (! is_array($dimensions) || ($dimensions[0] ?? 0) < 1 || ($dimensions[1] ?? 0) < 1) {
            throw new RuntimeException('تعذّر فك محتوى الصورة بأمان.');
        }
        $width = (int) $dimensions[0];
        $height = (int) $dimensions[1];
        if ($width * $height > self::MAX_PIXELS) {
            throw new RuntimeException('أبعاد الصورة تتجاوز حد المعالجة الآمن.');
        }
        $sha256 = hash_file('sha256', $path);
        if ($sha256 === false) {
            throw new RuntimeException('تعذّر حساب بصمة الصورة.');
        }

        return new InspectedProductImage($mime, self::MIME_EXTENSIONS[$mime][0], $size, $sha256, $width, $height);
    }
}
