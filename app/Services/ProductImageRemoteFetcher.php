<?php

namespace App\Services;

use App\Support\WebhookUrlValidator;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use RuntimeException;

final class ProductImageRemoteFetcher
{
    public function __construct(private readonly WebhookUrlValidator $urlValidator) {}

    public function validateUrl(string $url): void
    {
        $this->urlValidator->validate($url);
    }

    public function fetch(string $url): UploadedFile
    {
        if (config('product_import_media.remote_enabled') !== true) {
            throw new RuntimeException('جلب صور المنتجات من روابط خارجية غير مفعّل على المنصة.');
        }
        // Re-resolve at the last possible moment to narrow DNS-rebinding exposure.
        $this->validateUrl($url);
        $response = Http::accept('image/jpeg,image/png,image/webp')
            ->connectTimeout(5)->timeout(10)->withoutRedirecting()
            ->withOptions(['stream' => true])
            ->get($url);
        if (! $response->successful()) {
            throw new RuntimeException('تعذّر تنزيل صورة المنتج من الرابط الخارجي.');
        }
        $length = $response->header('Content-Length');
        if ($length !== null && (int) $length > ProductImageInspector::MAX_BYTES) {
            throw new RuntimeException('الصورة الخارجية تتجاوز حد الحجم الآمن.');
        }

        $tmp = tempnam(sys_get_temp_dir(), 'product-image-url-');
        if ($tmp === false) {
            throw new RuntimeException('تعذّر إنشاء ملف مؤقت للصورة الخارجية.');
        }
        $target = fopen($tmp, 'wb');
        if (! is_resource($target)) {
            @unlink($tmp);
            throw new RuntimeException('تعذّر إنشاء ملف مؤقت للصورة الخارجية.');
        }
        $body = $response->toPsrResponse()->getBody();
        $written = 0;
        while (! $body->eof()) {
            $chunk = $body->read(8192);
            $written += strlen($chunk);
            if ($written > ProductImageInspector::MAX_BYTES) {
                fclose($target);
                @unlink($tmp);
                throw new RuntimeException('الصورة الخارجية تتجاوز حد الحجم الآمن.');
            }
            fwrite($target, $chunk);
        }
        fclose($target);

        $mime = (string) (new \finfo(FILEINFO_MIME_TYPE))->file($tmp);
        $extension = match ($mime) {
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            default => null,
        };
        if ($extension === null) {
            @unlink($tmp);
            throw new RuntimeException('محتوى الرابط ليس صورة JPEG أو PNG أو WebP صالحة.');
        }

        return new UploadedFile($tmp, "remote-image.{$extension}", $mime, null, true);
    }
}
