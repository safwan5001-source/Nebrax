<?php

namespace App\Http\Controllers\Api;

use App\Models\ProductMedia;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\R2StorageService;
use Aws\Exception\AwsException;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * CUST-H4-8b — سلطة قراءة بايتات `ProductMedia` الموحّدة، مُستخرجة من
 * `CommerceMediaController`/`StorefrontMediaController` (كانا يكرّران نفس
 * الثلاث فروع — `document`/`r2`/قرص مسمّى توافقياً — حرفياً) لإضافة حدّ ثقة
 * ثالث (`CommerceWorkspaceMediaController`) بلا تكرارٍ رابع. **لا تغيير في
 * السلوك** لأي مستدعٍ قائم — نفس الترتيب والشروط والرسائل حرفياً، فقط
 * `Cache-Control` يبقى بيد كل متحكّمٍ عبر المعامل.
 */
trait ServesProductMediaBytes
{
    protected function streamProductMediaBytes(
        ProductMedia $media,
        DocumentStorageService $documentStorage,
        R2StorageService $r2,
        string $cacheControl,
    ) {
        return $this->streamProductMediaPath(
            $media,
            $media->path,
            $media->original_name,
            $media->mime_type,
            $documentStorage,
            $r2,
            $cacheControl,
        );
    }

    /**
     * Streams an already-authorized product-media path. Callers must resolve
     * publication/tenant authority before reaching this method; the optional
     * derivative path is never accepted from the client as storage input.
     */
    protected function streamProductMediaPath(
        ProductMedia $media,
        string $path,
        string $downloadName,
        ?string $mimeType,
        DocumentStorageService $documentStorage,
        R2StorageService $r2,
        string $cacheControl,
    ) {
        $headers = [
            'Content-Type' => $mimeType ?? 'application/octet-stream',
            'Cache-Control' => $cacheControl,
        ];

        if ($media->disk === 'document') {
            try {
                $stream = $documentStorage->readStream($documentStorage->profile(), $path);
            } catch (RuntimeException) {
                abort(404, 'الوسائط غير موجودة.');
            }

            return response()->streamDownload(function () use ($stream): void {
                fpassthru($stream);
                fclose($stream);
            }, $downloadName, $headers, 'inline');
        }

        if ($media->disk === 'r2') {
            try {
                $body = $r2->get(ProductMedia::R2_DOMAIN, (string) $media->product_id, basename($path));
            } catch (RuntimeException|AwsException $exception) {
                abort(404, 'الوسائط غير موجودة.');
            }

            return response()->streamDownload(function () use ($body): void {
                echo (string) $body;
            }, $downloadName, $headers, 'inline');
        }

        // توافق قراءة فقط مع سجلاتٍ قديمة محتملة كتبت مباشرةً على قرصٍ مسمّى
        // — يطابق `ProductController::downloadMedia()` حرفياً.
        $disk = Storage::disk($media->disk);
        if (! $disk->exists($path)) {
            abort(404, 'الوسائط غير موجودة.');
        }

        return $disk->response($path, $downloadName, $headers);
    }
}
